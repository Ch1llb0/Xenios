// Liest die eingebaute Web-Oberfläche einer Xenia aus (nur lesend) und packt alles in eine ZIP-Datei.
// Damit lässt sich nachvollziehen, welche Einstellungen und Aufrufe die Firmware einer Maschine kennt.
//
//   node tools/xenia-lesen.mjs 192.168.178.55
//
// Es werden nur statische Dateien (HTML, JS, CSS, JSON) und eine feste Liste bekannter
// Nur-Lese-Endpunkte abgefragt. Nichts wird an der Maschine verändert. Seriennummer, MAC-Adresse
// und WLAN-Daten werden vor dem Speichern entfernt.

import fs from 'node:fs';
import { makeZip } from '../src/backup.js';

const host = (process.argv[2] || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (!host) {
  console.error('Aufruf: node tools/xenia-lesen.mjs <IP-Adresse der Xenia>');
  process.exit(1);
}
const base = `http://${host}`;

// Bekannte Endpunkte ohne Nebenwirkungen (siehe docs/API-Xenia.md). Keine Paddle-, Stop-, Tara- oder WLAN-Aufrufe.
const READ_ONLY = [
  'status', 'overview', 'overview_single', 'diagram/get', 'machine', 'info', 'general', 'switches', 'timer2',
  'language', 'scripts/list', 'scriptslist', 'scripts/edit', 'brewgroup/pid', 'brewboiler/pid', 'pump/pid',
  'steamboiler/pid', 'mahlkonig/get', 'upload/status',
].map((p) => `/api/v2/${p}`);
const SECRET = /^(MA_SN|MSN|MA_MAC|WIFI_.*|.*PASS.*|BT_SCALE_NAME)$/i;

const files = {};
const log = [];
const seen = new Set();

async function get(path) {
  const res = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') || '', body };
}

function redact(text) {
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      for (const k of Object.keys(j)) if (SECRET.test(k)) j[k] = '<entfernt>';
    }
    return JSON.stringify(j, null, 1);
  } catch {
    return text;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. Statische Seiten und Skripte ---
const queue = ['/', '/index.html'];
let indexBody = null;
while (queue.length && seen.size < 250) {
  const p = queue.shift();
  if (seen.has(p)) continue;
  seen.add(p);
  try {
    const r = await get(p);
    log.push(`${r.status} ${p} (${r.type}, ${r.body.length} B)`);
    if (r.status !== 200) continue;
    const text = r.body.toString('utf8');
    // Unbekannte Pfade liefern die Startseite: diese nur einmal speichern
    if (/html/.test(r.type) && p !== '/' && text === indexBody) continue;
    if (p === '/') indexBody = text;
    if (!/javascript|html|css|json|text/.test(r.type)) continue;
    files[`web${p === '/' ? '/index.html' : p}`] = text;
    for (const m of text.matchAll(/["'(]\/?([\w\-./]+\.(?:js|html|css|json))(?:\?[^"')]*)?["')]/g)) {
      const q = '/' + m[1].replace(/^\.?\//, '');
      if (!q.includes('..') && !/\/api\//.test(q)) queue.push(q);
    }
  } catch (e) {
    log.push(`ERR ${p} ${e.message}`);
  }
  await sleep(150); // der ESP32 mag keine Hast
}

// --- 2. Nur-Lese-Endpunkte ---
for (const p of READ_ONLY) {
  try {
    const r = await get(p);
    const json = /json/.test(r.type);
    log.push(`${r.status} ${p} (${r.type})${json ? '' : ' – keine JSON-Antwort, gibt es wohl nicht'}`);
    if (r.status === 200 && json) files[`api${p.replace('/api/v2', '')}.json`] = redact(r.body.toString('utf8'));
  } catch (e) {
    log.push(`ERR ${p} ${e.message}`);
  }
  await sleep(250);
}

files['protokoll.txt'] = `Xenia ${host}, gelesen am ${new Date().toISOString()}\n\n${log.join('\n')}\n`;
const name = `xenia-oberflaeche-${new Date().toISOString().slice(0, 10)}.zip`;
fs.writeFileSync(name, makeZip(files));
console.log(log.join('\n'));
console.log(`\n${Object.keys(files).length} Dateien gespeichert in: ${process.cwd()}${process.platform === 'win32' ? '\\' : '/'}${name}`);
