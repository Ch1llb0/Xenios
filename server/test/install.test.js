// install.sh gegen ein nachgebautes docker: Ausführungsrecht, Dienst und die Statusdatei, die die App liest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUpdate } from '../src/update.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'install.sh');
const NO_SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? false : 'kein sh vorhanden';
const posix = (p) => p.split(path.sep).join('/');

// Befehle „im Container“ laufen gegen einen Ordner statt /data; compose scheitert auf Wunsch.
const FAKE_DOCKER = `#!/bin/sh
case "$1" in
  compose) exit "$FAKE_COMPOSE_EXIT" ;;
  inspect) echo healthy; exit 0 ;;
  exec) ;;
  *) exit 0 ;;
esac
shift 2
case "$1" in
  sh) exec sh -c "$(printf '%s' "$3" | sed "s#/data#$FAKE_DATA#g")" ;;
  test) [ -f "$FAKE_DATA/\${3##*/}" ]; exit ;;
  rm) rm -f "$FAKE_DATA/\${3##*/}"; exit ;;
  cat) cat "$FAKE_DATA/\${2##*/}"; exit ;;
  node) echo 9.9.9; exit 0 ;;
esac
`;

function applyRequested(composeExit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xenios-install-'));
  try {
    const bin = path.join(dir, 'bin');
    const data = path.join(dir, 'data');
    const install = path.join(dir, 'xenios');
    for (const d of [bin, data, path.join(install, 'docker')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(install, 'docker', 'compose.yaml'), '');
    fs.writeFileSync(path.join(bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
    fs.writeFileSync(path.join(data, 'update.request'), '{}');
    // Unter Windows heißt die Variable „Path“; eine zweite daneben würde übersehen
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
    const r = spawnSync('sh', [posix(SCRIPT), '--apply-requested'], {
      encoding: 'utf8',
      env: { ...env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? process.env.Path}`, XENIOS_DIR: posix(install), FAKE_DATA: posix(data), FAKE_COMPOSE_EXIT: String(composeExit) },
    });
    return { status: r.status, output: r.stdout + r.stderr, update: readUpdate(data) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Fehlgeschlagene Aktualisierung kommt in der App als Fehler an', { skip: NO_SH }, () => {
  const { status, output, update } = applyRequested(1);
  assert.equal(status, 1, output);
  assert.equal(update.requested, false, 'Anforderung ist abgearbeitet');
  assert.equal(update.job?.state, 'error', output);
  assert.match(update.job.error, /fehlgeschlagen/);
});

test('Erfolgreiche Aktualisierung meldet die neue Version', { skip: NO_SH }, () => {
  const { status, output, update } = applyRequested(0);
  assert.equal(status, 0, output);
  assert.equal(update.job?.state, 'ok', output);
  assert.equal(update.job.version, '9.9.9');
  assert.equal(update.helperAlive, true);
});

test('install.sh ist im Git ausführbar, der Dienst startet es über sh', (t) => {
  assert.match(fs.readFileSync(SCRIPT, 'utf8'), /^ExecStart=\/bin\/sh \$DIR\/install\.sh --apply-requested$/m);
  const r = spawnSync('git', ['ls-files', '-s', 'install.sh'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return t.skip('kein Git-Checkout');
  assert.match(r.stdout, /^100755 /);
});
