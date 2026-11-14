// Prüft Xenios gegen eine echte Xenia: derselbe Code wie im Server, Werte gegen die Rohantworten der Maschine.
//
//   node tools/xenia-pruefen.mjs 192.168.178.55                 nur lesen (Standard)
//   node tools/xenia-pruefen.mjs 192.168.178.55 --schreibtest   zusätzlich: Bezugszeit um 1 s ändern, prüfen, zurückstellen
//
// Der Bericht wird angezeigt und als xenia-pruefung-<Datum>.txt gespeichert (ohne Seriennummer/MAC).

import fs from 'node:fs';
import { Machine } from '../web/shared/machine-core.js';
import { normalizeLive } from '../web/shared/machine-api.js';
import { MemoryStore } from '../web/shared/emitter.js';
import { DEFAULTS } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');
const host = (process.argv[2] || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const write = process.argv.includes('--schreibtest');
if (!host || host.startsWith('--')) {
  console.error('Aufruf: node tools/xenia-pruefen.mjs <IP-Adresse der Xenia> [--schreibtest]');
  process.exit(1);
}

const lines = [];
let ok = 0;
let bad = 0;
const out = (s = '') => { lines.push(s); console.log(s); };
const check = (label, cond, detail = '') => {
  if (cond) ok++; else bad++;
  out(`${cond ? '  OK    ' : '  FEHLER'} ${label}${detail ? ` – ${detail}` : ''}`);
};
const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined : Number(a) === Number(b));
const section = (t) => out(`\n== ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const m = new Machine({ machine: { ...DEFAULTS.machine, url: `http://${host}`, api: 'classic' }, features: { ...DEFAULTS.features, settings: true } }, { history: new MemoryStore({ shots: [] }) });
m._stopped = true;
const raw = (p) => m.client.get(p);

out(`Xenios-Prüfung gegen http://${host} am ${new Date().toLocaleString('de-DE')}${write ? ' (mit Schreibtest)' : ' (nur lesen)'}`);

try {
  section('Verbindung und Firmware');
  const caps = await m.classicCaps();
  check('Seiten-API erkannt (DBL ab Firmware 4.1xx)', caps.pages === true);
  check('Paddle freigeschaltet', m.hasPaddle === true);
  await m.refreshSlow();
  const info = m.state.info || {};
  out(`         Modell: ${info.typeName} · Firmware ${info.firmware} / ESP ${info.esp}`);
  check('Modellname aus MA_TYPE', /Dual Boiler|2K|303/.test(info.typeName || ''), info.typeName);

  section('Live-Werte (wie Startseite/Manometer)');
  const ov = await raw('/api/v2/overview');
  m._applyLive(normalizeLive(ov));
  const st = m.state;
  out(`         Status ${st.statusLabel} · Brühgruppe ${st.temp.group} °C · Brühkessel ${st.temp.boiler} °C · Pumpe ${st.pressure.pump} bar · Dampf ${st.pressure.steam} bar`);
  check('Status erkannt', st.statusKey && st.statusKey !== 'unknown', `MA_STATUS ${ov.MA_STATUS} → ${st.statusKey}`);
  check('Pumpendruck = PU_SENS_PRESS', same(st.pressure.pump, ov.PU_SENS_PRESS), `${st.pressure.pump} / ${ov.PU_SENS_PRESS}`);
  check('Dampfdruck = SB_SENS_PRESS', same(st.pressure.steam, ov.SB_SENS_PRESS), `${st.pressure.steam} / ${ov.SB_SENS_PRESS}`);
  check('Temperaturen vorhanden', Number.isFinite(st.temp.group) && Number.isFinite(st.temp.boiler));
  check('Solltemperatur Brühgruppe gelesen', Number.isFinite(st.temp.groupSet), String(st.temp.groupSet));

  section('Einstellungen (Tab „Einstellungen“)');
  const s = await m.readSettings();
  const bbg = await raw('/api/v2/boilerandbrewgroup');
  const pu = await raw('/api/v2/pump');
  const ma = await raw('/api/v2/machine');
  const want = { ...bbg, ...pu, ...ma };
  for (const k of ['BG_SET_TEMP', 'BG_SET_ECO_TEMP', 'BG_SET_TEMP_HYST', 'BB_SET_TEMP', 'BB_SET_ECO_TEMP', 'BB_SET_TEMP_HYST',
    'SB_SET_PRESS', 'SB_SET_ECO_PRESS', 'SB_SET_PRESS_HYST', 'PU_SET_BREW_TIMER_1', 'PU_SET_MAX_TIMER',
    'MA_BOILER_START_MODE', 'MA_HEATUP_FLUSH_DURATION', 'MA_FIX_WATER_SUPPLY', 'MA_EXTENDED_THERMAL_STABILITY',
    'MA_SET_TIMER_ECO_MA', 'MA_SET_TIMER_POWERDOWN']) {
    check(k, same(s[k], want[k]), `Xenios ${s[k]} · Maschine ${want[k]}`);
  }
  for (const k of ['BG_SET_POWER', 'BB_MODE', 'BB_SET_POWER', 'SB_SET_POWER', 'PU_MODE', 'MA_MAX_AMPERE']) {
    check(`${k} vorhanden (wird beim Speichern unverändert mitgesendet)`, k in want, String(want[k]));
  }

  section('Wochentimer (Tab „Timer“)');
  const t = await m.timers();
  const tr = await raw('/api/v2/timer');
  check('Format der DBL erkannt (zwei Einschaltzeiten je Tag)', t.weekly === 'starts');
  for (const d of t.days) {
    const desc = d.starts.map((x, i) => (x.enabled ? `${i + 1}: ${String(Math.floor(x.on / 60)).padStart(2, '0')}:${String(x.on % 60).padStart(2, '0')} ${x.brew ? 'Brüh' : ''}${x.steam ? '+Dampf' : ''}` : `${i + 1}: –`)).join('  ');
    const rawOk = [1, 2].every((n) => (Number(tr[`TI_${d.day}_ON${n}_BOILER`]) !== 0) === d.starts[n - 1].enabled || Number(tr[`TI_${d.day}_ON${n}`]) === 0);
    check(`${d.day.padEnd(9)} ${desc}`, rawOk);
  }
  out(`         Eco nach ${t.ecoAfterMin} min · Aus nach ${t.offAfterMin} min`);

  section('Schalter (Tab „Schalter“)');
  const sw = await m.switches();
  const swr = await raw('/api/v2/switches');
  const names = m.builtinScripts();
  const scripts = await m.scripts().catch(() => []);
  const nm = (id) => names[id] ?? scripts.find((x) => x.id === id)?.title ?? `Skript ${id}`;
  for (const [key, no] of [['LEFT_LEFT', '①'], ['RIGHT_LEFT', '③'], ['RIGHT_RIGHT', '④']]) {
    const b = sw.buttons[key];
    check(`${no} ${key}: kurz „${nm(b.short)}“, lang „${nm(b.long)}“`, same(b.short, swr[`SWITCH_SET_${key}_0`]) && same(b.long, swr[`SWITCH_SET_${key}_1`]));
  }
  out(`         Single ${sw.singleDoseG} g/ml · Double ${sw.doubleDoseG} g/ml · eigene Skripte: ${scripts.filter((x) => x.id > 9).map((x) => x.title).join(', ') || 'keine'}`);

  if (write) {
    section('Schreibtest: Bezugszeit Espresso um 1 s ändern und zurückstellen');
    const before = { ...(await raw('/api/v2/pump')) };
    const otherBefore = await raw('/api/v2/boilerandbrewgroup');
    const v = Number(before.PU_SET_BREW_TIMER_1);
    const test = v >= 60 ? v - 1 : v + 1;
    await m.updateSettings({ PU_SET_BREW_TIMER_1: test });
    await sleep(800);
    const mid = await raw('/api/v2/pump');
    check(`Bezugszeit auf ${test} s gesetzt`, Number(mid.PU_SET_BREW_TIMER_1) === test, `Maschine meldet ${mid.PU_SET_BREW_TIMER_1}`);
    check('Max. Bezugszeit und Pumpenmodus unverändert', same(mid.PU_SET_MAX_TIMER, before.PU_SET_MAX_TIMER) && same(mid.PU_MODE, before.PU_MODE));
    await m.updateSettings({ PU_SET_BREW_TIMER_1: v });
    await sleep(800);
    const after = await raw('/api/v2/pump');
    check(`Bezugszeit wieder auf ${v} s`, Number(after.PU_SET_BREW_TIMER_1) === v, `Maschine meldet ${after.PU_SET_BREW_TIMER_1}`);
    const otherAfter = await raw('/api/v2/boilerandbrewgroup');
    check('Kessel- und Brühgruppenwerte unberührt', JSON.stringify(otherBefore) === JSON.stringify(otherAfter));
  }
} catch (e) {
  bad++;
  out(`\n  FEHLER  Abbruch: ${e.message}`);
}

out(`\nErgebnis: ${ok} OK, ${bad} Fehler`);
const file = `xenia-pruefung-${new Date().toISOString().slice(0, 10)}.txt`;
fs.writeFileSync(file, lines.join('\n') + '\n');
console.log(`Bericht gespeichert: ${process.cwd()}${process.platform === 'win32' ? '\\' : '/'}${file}`);
process.exit(bad ? 1 : 0);
