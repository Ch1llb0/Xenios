// Abfrage der Maschine: ein einzelner Aussetzer gilt noch nicht als offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../web/shared/machine-core.js';
import { MemoryStore } from '../web/shared/emitter.js';
import { DEFAULTS } from '../src/config.js';
import { setLogLevel } from '../src/log.js';

setLogLevel('error');

test('Erst der zweite Fehlschlag in Folge meldet die Maschine offline', async () => {
  const m = new Machine({ machine: { ...DEFAULTS.machine, url: 'http://127.0.0.1:9' }, features: DEFAULTS.features }, { history: new MemoryStore({ shots: [] }) });
  m._stopped = true; // _loop nur von Hand, nichts neu einplanen
  m._slowAt = Infinity;
  let fail = false;
  m.client = { get: async () => { if (fail) throw new Error('Zeitüberschreitung'); return { MA_STATUS: 0 }; } };
  const poll = async (f) => { fail = f; await m._loop(); return m.state.online; };

  assert.equal(await poll(false), true);
  assert.equal(await poll(true), true, 'ein Aussetzer: noch online');
  assert.equal(await poll(true), false, 'zweiter in Folge: offline');
  assert.match(m.state.error, /Zeitüberschreitung/);
  assert.equal(await poll(true), false, 'bleibt offline');
  assert.equal(await poll(false), true);
  assert.equal(await poll(true), true, 'nach Erfolg wieder ein Aussetzer frei');
  assert.equal(await poll(false), true);
  assert.equal(await poll(true), true);
});
