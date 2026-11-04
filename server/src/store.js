// Kleiner JSON-Dateispeicher mit atomarem Schreiben (tmp + rename) und Entprellung.
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './log.js';

const log = logger('speicher');
const RETRY_MS = 30000;

// Inhalt der Datei; null, wenn es sie nicht gibt. Beschädigtes wird zur Seite gelegt, damit das nächste Speichern es nicht überschreibt.
// Andere Lesefehler brechen den Start ab: Mit leerem Stand weiterzumachen könnte vorhandene Daten überschreiben.
function readStore(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${file} nicht lesbar: ${e.message}`);
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* unten zur Seite legen */ }
  const kept = `${file}.defekt-${Date.now()}`;
  fs.renameSync(file, kept);
  log.error(`${path.basename(file)} ist beschädigt: verschoben nach ${path.basename(kept)}, weiter mit leerem Stand`);
  return null;
}

export class JsonStore {
  constructor(file, initial) {
    this.file = file;
    this.timer = null;
    this.data = readStore(file) ?? (typeof initial === 'function' ? initial() : structuredClone(initial));
  }

  save(delayMs = 500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // Im Timer fängt niemand den Fehler auf: Volle Platte oder gesperrte Datei dürfen den Server nicht beenden.
      try {
        this.flush();
      } catch (e) {
        log.error(`${path.basename(this.file)} nicht gespeichert, neuer Versuch in ${RETRY_MS / 1000} s: ${e.message}`);
        this.save(RETRY_MS);
      }
    }, delayMs);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    // flush: Inhalt liegt vor dem Umbenennen auf der Platte, ein Stromausfall hinterlässt keine leere Datei
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600, flush: true });
    fs.renameSync(tmp, this.file);
  }

  reload() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch { /* Datei fehlt oder ist ungültig: bisherigen Stand behalten */ }
  }
}
