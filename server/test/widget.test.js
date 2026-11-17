import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveHistory, widgetExtras } from '../src/widget.js';

test('Widget-Daten: Verlauf, letzter Bezug, Tage, Zeiten, Pflege, laufender Bezug', () => {
  const now = Date.parse('2026-11-17T12:00:00');
  const h = new LiveHistory();
  for (let i = 0; i < 180; i++) h.add({ online: true, temp: { group: 90, boiler: 91 }, pressure: { pump: 0, steam: 1.5 } }, now - 15 * 60e3 + i * 5000);
  const curve = [[0, 2, 0], [6, 9, 0.2], [8, 9, 1.4], [30, 9, 36]];
  const shots = [
    { endedAt: new Date(now - 3600e3).toISOString(), timeMs: 30000, weight: 36, curve, doseDefaultG: 18, maxPressure: 9 },
    { endedAt: new Date(now - 86400e3).toISOString(), timeMs: 25000, weight: 40 },
  ];
  const m = { online: true, pressure: { pump: 9, pumpSet: 9 }, scale: { weight: 12.3, rate: 1.5 }, shot: { running: true, timeMs: 14000, curve: [[0, 2, 0], [14, 9, 12.3]], script: { title: 'Einfach' } } };
  const w = widgetExtras({ m, shots, maintenance: { backflush: { due: false, daysSince: 3, intervalDays: 7, lastAt: null } }, history: h, now });
  assert.equal(w.pump, 9);
  assert.equal(w.live.timeS, 14);
  assert.equal(w.live.title, 'Einfach');
  assert.equal(w.lastShot.timeS, 24, 'Bezugszeit ohne Vorbrühen');
  assert.equal(w.lastShot.ratio, 2);
  assert.equal(w.days.length, 7);
  assert.equal(w.days[6].count, 1, 'heute ein Bezug');
  assert.equal(w.days[5].count, 1, 'gestern ein Bezug');
  assert.deepEqual(w.times.map((t) => t.s), [25, 24]);
  assert.equal(w.care.daysSince, 3);
  assert.ok(w.history.length >= 119 && w.history.length <= 121, `10 min à 5 s: ${w.history.length}`);
  assert.ok(w.history.every((s) => s[0] <= 0 && s[0] >= -600));
});
