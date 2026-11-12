// Xenia DBL mit Firmware 4.1xx: alte API, aber Einstellungen über die Seiten-API der Original-Oberfläche.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMockXenia } from '../mock/mock-devices.js';
import { Machine } from '../web/shared/machine-core.js';
import { MemoryStore } from '../web/shared/emitter.js';
import { DEFAULTS } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
let xenia, m;
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  xenia = createMockXenia({ api: 'classic', pages: true });
  const port = await listen(xenia.server);
  m = new Machine({ machine: { ...DEFAULTS.machine, url: `http://127.0.0.1:${port}`, api: 'classic' }, features: { ...DEFAULTS.features, settings: true, paddle: true } }, { history: new MemoryStore({ shots: [] }) });
  m._stopped = true;
});
after(() => xenia.server.close());

test('Seiten-API wird erkannt, Paddle freigeschaltet', async () => {
  const caps = await m.classicCaps();
  assert.equal(caps.pages, true);
  assert.equal(m.hasPaddle, true);
});

test('Einstellungen lesen: Werte aller Original-Seiten', async () => {
  const s = await m.readSettings();
  assert.equal(s._pages, true);
  assert.equal(s.PU_SET_BREW_TIMER_1, 44);
  assert.equal(s.BG_SET_ECO_TEMP, 70);
  assert.equal(s.MA_SET_TIMER_ECO_MA, 5);
  assert.equal(s.BB_MODE, 1);
});

test('Speichern sendet je Seite alle Felder, Heizleistung bleibt unverändert', async () => {
  const before = xenia.state.log.length;
  await m.updateSettings({ BG_SET_TEMP: 93.5, PU_SET_BREW_TIMER_1: 30, MA_SET_TIMER_POWERDOWN: 60 });
  const g = xenia.state.general;
  assert.equal(g.BG_SET_TEMP, 93.5);
  assert.equal(g.BG_SET_POWER, 300, 'Heizleistung unverändert mitgesendet');
  assert.equal(g.PU_SET_BREW_TIMER_1, 30);
  assert.equal(g.PU_SET_MAX_TIMER, 90);
  assert.equal(g.MA_SET_TIMER_POWERDOWN, 60);
  const posts = xenia.state.log.slice(before).filter((l) => l.startsWith('POST'));
  assert.deepEqual(posts.map((l) => l.split(' ')[1]), ['/api/v2/brewgroup', '/api/v2/pump', '/api/v2/machine']);
  const bg = JSON.parse(posts[0].slice(posts[0].indexOf('{')));
  assert.deepEqual(Object.keys(bg).sort(), ['BG_SET_ECO_TEMP', 'BG_SET_POWER', 'BG_SET_TEMP', 'BG_SET_TEMP_HYST']);
  assert.equal(typeof bg.BG_SET_TEMP, 'string');
});

test('Ungültige Werte werden abgelehnt, ohne etwas zu senden', async () => {
  const before = xenia.state.log.length;
  await assert.rejects(m.updateSettings({ PU_SET_BREW_TIMER_1: 70 }), /zwischen 15 und 60/);
  await assert.rejects(m.updateSettings({ BG_SET_TEMP: 65, BG_SET_ECO_TEMP: 80 }), /nicht über/);
  await assert.rejects(m.updateSettings({ BG_SET_POWER: 100 }), /Unbekannte Einstellung/);
  assert.equal(xenia.state.log.slice(before).filter((l) => l.startsWith('POST')).length, 0);
});
