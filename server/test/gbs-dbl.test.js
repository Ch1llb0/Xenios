// Grind-by-Sync mit der alten Xenia (DBL): Xenios spielt der Mühle die neue Xenia vor und stoppt am Gewicht.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createMockXenia } from '../mock/mock-devices.js';
import { createApp, Listeners } from '../src/index.js';
import { DEFAULTS, deepMerge } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { generateVapidKeys } from '../src/push.js';
import { setLogLevel } from '../src/log.js';
import { DblBrew, FINISH_HOLD_MS } from '../src/gbs-dbl.js';
import { Emitter } from '../web/shared/emitter.js';

setLogLevel('error');

// --- Gewichtsstopp mit nachgestellter Maschine und eigener Uhr ---------------------------------------------------
class FakeMachine extends Emitter {
  constructor() {
    super();
    this.state = { online: true, status: 1, scale: { weight: 0 }, shot: { running: false }, temp: { group: 93, groupSet: 93 }, tankOk: true, scaleLink: { connected: true } };
    this.calls = [];
    this.client = { get: async (p) => { this.calls.push(`GET ${p}`); return { MA_TYPE: 3, MA_SN: 'DBL123', FW_VERSION_MAJOR: 4, FW_VERSION_MINOR: 159 }; } };
  }

  async runScript(id) { this.calls.push(`run ${id}`); }
  noteScript(id, o) { this.noted = { id, ...o }; }
  async stopScript() { this.calls.push('stop'); return { ok: true, stopped: true }; }
  feed(patch) { Object.assign(this.state, patch); this.emit('state'); }
}

function rig() {
  const m = new FakeMachine();
  let t = 1_000_000;
  const clock = { now: () => t, set: (v) => { t = v; } };
  return { m, clock, brew: new DblBrew(m, { now: clock.now }) };
}

test('DBL-GbS: Start, Tarieren übergehen, Stopp vor dem Zielgewicht, danach Status 4 mit Bezugszeit', async () => {
  const { m, clock, brew } = rig();
  await brew.start({ scriptId: 2, weight: 36, title: 'Espresso endlos' });
  assert.deepEqual(m.calls, ['run 2']);
  assert.equal(m.noted.title, 'GbS: Espresso endlos');
  assert.equal(brew.mako().MA_STATUS, 3, 'gleich nach dem Knopf „Bezug läuft“, sonst sendet die Mühle erneut');
  assert.deepEqual(await brew.start({ scriptId: 2, weight: 36, title: 'x' }), { repeat: true });
  assert.equal(m.calls.filter((c) => c.startsWith('run')).length, 1);

  const t0 = clock.now();
  // Bookoo an der DBL: erst der alte Wert, dann tariert, dann 2 g/s
  m.feed({ status: 3, shot: { running: true }, scale: { weight: 290 } });
  clock.set(t0 + 300); m.feed({ scale: { weight: 0 } });
  for (let ms = 600; ms <= 30000; ms += 300) {
    clock.set(t0 + ms);
    const w = ms < 6000 ? 0 : ((ms - 6000) / 1000) * 2;
    m.feed({ scale: { weight: w } });
    if (m.calls.includes('stop')) break;
  }
  assert.ok(m.calls.includes('stop'), 'am Gewicht gestoppt');
  const stopAt = clock.now() - t0;
  // 36 g bei 2 g/s ab 6 s = 24 s; mit 1 s Nachlauf ~1 s früher
  assert.ok(stopAt >= 22500 && stopAt <= 24000, `Stopp nach ${stopAt} ms`);
  assert.equal(brew.view().brewing.phase, 'stopping');

  clock.set(t0 + stopAt + 400);
  m.feed({ status: 4, shot: { running: false }, scale: { weight: 36.4 } });
  const k = brew.mako();
  assert.equal(k.MA_STATUS, 4);
  assert.equal(k.MA_EXTRACTION_STATUS, 1);
  assert.equal(k.REAL_EXTRACTION_TIME_MS, stopAt, 'Bezugszeit bis zum Stopp');
  assert.equal(brew.last.stoppedBy, 'weight');
  assert.ok(brew.last.weightG >= 34 && brew.last.weightG <= 36, `${brew.last.weightG} g`);

  // Die Mühle fragt alle 2 s: Status 4 bleibt lange genug stehen, danach wieder der echte Status
  clock.set(t0 + stopAt + FINISH_HOLD_MS - 100);
  assert.equal(brew.mako().MA_STATUS, 4);
  clock.set(t0 + stopAt + FINISH_HOLD_MS + 500);
  m.feed({ status: 1 });
  assert.equal(brew.mako().MA_STATUS, 1);
  assert.equal(brew.mako().REAL_EXTRACTION_TIME_MS, stopAt, 'letzte Bezugszeit bleibt stehen');
});

test('DBL-GbS: Tasse während des Bezugs aufgestellt → kein sofortiger Stopp; ohne Gewicht Abbruch', async () => {
  const { m, clock, brew } = rig();
  await brew.start({ scriptId: 2, weight: 30, title: 'E' });
  const t0 = clock.now();
  m.feed({ status: 3, shot: { running: true }, scale: { weight: 0 } });
  clock.set(t0 + 4000); m.feed({ scale: { weight: 180 } }); // Tasse
  clock.set(t0 + 4300); m.feed({ scale: { weight: 180.5 } });
  assert.ok(!m.calls.includes('stop'), 'Sprung um 180 g ist kein Durchfluss');
  m.feed({ shot: { running: false }, status: 1 });
  assert.equal(brew.last.stoppedBy, 'machine');

  // zweiter Bezug: Waage meldet nichts → nach 15 s gestoppt, für die Mühle abgebrochen
  await brew.start({ scriptId: 2, weight: 30, title: 'E' });
  const t1 = clock.now();
  m.feed({ status: 3, shot: { running: true }, scale: { weight: 0 } });
  clock.set(t1 + 15100); m.feed({ scale: { weight: 0 } });
  assert.equal(brew.view().brewing.phase, 'stopping');
  clock.set(t1 + 15500); m.feed({ status: 4, shot: { running: false } });
  assert.equal(brew.last.stoppedBy, 'noweight');
  assert.equal(brew.mako().MA_EXTRACTION_STATUS, 2);
});

test('DBL-GbS: ohne Zielgewicht oder ohne Waage kein Start; Identität mit Firmware der neuen Xenia', async () => {
  const { m, brew } = rig();
  await assert.rejects(brew.start({ scriptId: 2, weight: NaN, title: 'E' }), /Zielgewicht/);
  m.state.scaleLink = { connected: false };
  await assert.rejects(brew.start({ scriptId: 2, weight: 36, title: 'E' }), /Waage/);
  assert.ok(!m.calls.some((c) => c.startsWith('run')));
  assert.equal(brew.brew, null);
  const id = await brew.identity();
  assert.equal(id.MA_TYPE, 3);
  assert.equal(id.MA_SN, 'DBL123');
  assert.equal(id.FW_VERSION_MINOR, 226);
  await brew.identity();
  assert.equal(m.calls.filter((c) => c === 'GET /api/v2/machine').length, 1, 'höchstens einmal pro Minute gelesen');
});

// --- Ende zu Ende: Mühle (HTTP) → Xenios → simulierte DBL ------------------------------------------------------
let xenia, app, cfg, listeners, gbsPort, dataDir;
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(50);
  }
  return false;
}
function grinder(method, p, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: gbsPort, method, path: p, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

before(async () => {
  xenia = createMockXenia({ api: 'classic', pages: true, speed: 4 });
  xenia.state.ble = 1;
  const xp = await listen(xenia.server);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenia-gbs-dbl-'));
  cfg = deepMerge(DEFAULTS, {
    auth: { passwordHash: hashPassword('test-passwort-123') },
    machine: { url: `http://127.0.0.1:${xp}`, api: 'classic', pollActiveMs: 150, pollIdleMs: 300, pollBackgroundMs: 300, slowPollMs: 2000 },
    grinder: { enabled: false, url: 'https://127.0.0.1:1' },
    push: { ...generateVapidKeys(), subject: 'mailto:test@example.com' },
    http: { enabled: false }, https: { enabled: false }, lan: { enabled: false },
    gbs: { enabled: true, host: '127.0.0.1', port: 0, grinderIp: '127.0.0.1' },
    dataDir,
  });
  app = createApp(cfg);
  listeners = new Listeners(cfg, () => {}, app.gbs);
  listeners.apply();
  const entry = listeners.servers.get('gbs');
  if (!entry.server.listening) await once(entry.server, 'listening');
  gbsPort = entry.server.address().port;
  xenia.state.MA_STATUS = 1;
  app.machine.setViewers(1); // wie bei offener App: schnell abfragen
});

after(() => {
  listeners.close();
  xenia.server.close();
  xenia.stop();
  app.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('DBL ende zu ende: Mühle sieht eine neue Xenia, Drehknopf → Bezug an der DBL, Stopp am Gewicht', async () => {
  assert.ok(await until(() => app.machine.state.online && app.machine.state.status === 1 && app.machine.state.scaleLink?.connected));
  const id = await grinder('GET', '/api/v2/machine');
  assert.equal(id.status, 200);
  assert.equal(id.json.FW_VERSION_MINOR, 226);
  let k = (await grinder('GET', '/api/v2/mako')).json;
  assert.equal(k.MA_STATUS, 1);
  assert.equal(k.TANK_LEVEL, 1);
  assert.equal(app.gbs.view().mode, 'dbl');

  assert.equal((await grinder('POST', '/api/v2/brewratio', { SYNC_BEVERAGE_WEIGHT: 20, SYNC_FILTER: '2' })).status, 200);
  assert.equal(xenia.state.lastBrewRatio, undefined, 'die DBL kennt brewratio nicht, nichts weitergereicht');
  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 9 })).status, 200);
  assert.equal(xenia.state.brewing?.id, 2, '„Espresso endlos“ an der DBL');
  assert.equal((await grinder('GET', '/api/v2/mako')).json.MA_STATUS, 3);
  assert.equal((await grinder('POST', '/api/v2/scripts/execute', { ID: 9 })).status, 200, 'erneuter Knopfdruck wird übergangen');

  assert.ok(await until(() => xenia.state.MA_STATUS !== 3), 'Bezug endet');
  // Simulation: ~7 g/s, Stopp 1 s Durchfluss vor 20 g; ohne Stopp liefe „Espresso endlos“ 60 s
  assert.ok(xenia.state.scale >= 10 && xenia.state.scale < 25, `bei ${xenia.state.scale} g gestoppt`);
  assert.ok(xenia.state.log.some((l) => l.startsWith('GET /api/v2/scripts/stop')));
  assert.ok(await until(() => app.gbs.view().dbl.last));
  assert.equal(app.gbs.view().dbl.last.stoppedBy, 'weight');
  k = (await grinder('GET', '/api/v2/mako')).json;
  assert.equal(k.MA_STATUS, 4);
  assert.ok(k.REAL_EXTRACTION_TIME_MS > 1000);
  assert.ok(!xenia.state.log.some((l) => l.startsWith('POST /api/v2/scripts/create')), 'nichts auf die DBL geschrieben');
  assert.equal(app.gbs.view().lastStart.ok, true);
});

test('DBL ende zu ende: Waage getrennt → Knopf startet nichts, Fehler sichtbar', async () => {
  assert.ok(await until(() => xenia.state.MA_STATUS === 1 && !app.gbs.dbl.brew));
  xenia.state.ble = 0;
  xenia.state.scale = 0; // ein Gewicht ungleich 0 zählt sonst als verbunden
  app.machine._scaleLinkAt = 0;
  assert.ok(await until(() => app.machine.state.scaleLink?.connected === false));
  const r = await grinder('POST', '/api/v2/scripts/execute', { ID: 9 });
  assert.equal(r.status, 409);
  assert.equal(xenia.state.MA_STATUS, 1);
  assert.match(app.gbs.view().lastError, /Waage/);
});
