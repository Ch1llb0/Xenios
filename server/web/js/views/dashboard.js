// Home (Dashboard): anpassbare Übersicht (Handy, Tablet hochkant und quer). Bedienen lassen sich die Kacheln „Schalter“
// (Ein/Eco/Aus, Dampf, Skript stoppen) und „Sollwerte“. Am Handy (eine Spalte) sind die Kacheln so hoch wie ihr Inhalt. Auswahl, Reihenfolge, Breite und Höhe der Kacheln speichert jedes Gerät für sich (localStorage).
// Raster wie bei Android-Widgets: Breite in Spalten (oder ganze Breite), Höhe in Zellen; Kacheln einer Zeile sind gleich hoch.
import { h, icon, fmt, fmtInt, ago, sheet, switchEl, snackbar, promptNumber } from '../ui.js';
import { api, store, subscribe, hasGrinder, machineOn, scriptActive } from '../api.js';
import { isHidden, noSteamOn, setNoSteamOn, powerOnBody, onPrefs } from '../prefs.js';
import { createGauge, ring, shotChart, barChart, targetBar, liveChart } from '../gauge.js';
import { navigate, setTopActions, localStorageGet, localStorageSet } from '../app.js';
import { liveHistory, SERIES } from '../live.js';
import { TYPE_DE, TRIGGER_DE } from './grinder.js';
import { ALERT_TEXT } from '../../shared/grinder-core.js';
import { shotMetrics, scriptDuration } from '../../shared/shot-analysis.js';

// w: Spalten (0 = ganze Breite), h: Höhe in Zellen
// Reihenfolge = Standardanordnung. Bei vier Spalten: Status | Instrumente (3 Spalten), darunter Schalter,
// Letzter Bezug, Bezüge pro Tag, Bezugszeiten, dann der Verlauf über die ganze Breite.
const TILES = {
  shot: { title: 'Live-Bezug', icon: 'coffee', w: 0, h: 2, note: 'Erscheint nur während eines Bezugs, dann ganz oben', build: shotTile },
  status: { title: 'Status', icon: 'power', w: 1, h: 2, build: statusTile },
  gauges: { title: 'Instrumente', icon: 'thermo', w: 3, h: 2, note: 'Druck, Brühgruppe, Brühkessel, Dampf', build: gaugesTile },
  control: { title: 'Schalter', icon: 'power', w: 1, h: 1, note: 'Ein, Eco, Aus und Dampf direkt bedienen', build: controlTile },
  lastShot: { title: 'Letzter Bezug', icon: 'coffee', w: 1, h: 1, build: lastShotTile, link: '/bezuege' },
  lastGrind: { title: 'Letzter Mahlvorgang', icon: 'grinder', w: 1, h: 1, build: lastGrindTile, link: '/muehle' },
  week: { title: 'Bezüge pro Tag', icon: 'event', w: 1, h: 1, build: weekTile, link: '/bezuege' },
  shotTimes: { title: 'Bezugszeiten', icon: 'timer', w: 1, h: 1, build: shotTimesTile, link: '/bezuege' },
  grinds: { title: 'Mahlgewichte', icon: 'scale', w: 1, h: 1, build: grindsTile, link: '/muehle' },
  grinder: { title: 'Mühle heute', icon: 'grinder', w: 1, h: 1, build: grinderTile, link: '/muehle' },
  targets: { title: 'Sollwerte', icon: 'thermo', w: 1, h: 1, note: 'Brühgruppe, Brühkessel und Dampfdruck einstellen', build: targetsTile },
  care: { title: 'Pflege', icon: 'check', w: 1, h: 1, build: careTile, link: '/bezuege' },
  live: { title: 'Verlauf (10 min)', icon: 'history', w: 0, h: 2, build: liveTile },
};
const GRINDER_TILES = new Set(['lastGrind', 'grinds', 'grinder']);
const KEY = 'dashboard';
const LAYOUT_VERSION = 5; // 3: Breite/Höhe in Zellen; 4: Instrumente oben; 5: neue Standardanordnung (Status | Instrumente, Schalter unter Status)
const FINISHED_MS = 20e3;   // so lange bleibt der Live-Bezug nach dem Ende stehen
const MIN_COL = 280;        // Mindestbreite einer Spalte (px); daraus ergibt sich die Spaltenzahl
const GAP = 12;
const WIDTHS = [[1, '1 Spalte'], [2, '2 Spalten'], [3, '3 Spalten'], [0, 'Ganze Breite']];
const HEIGHTS = [[1, 'Höhe 1'], [2, 'Höhe 2'], [3, 'Höhe 3'], [4, 'Höhe 4']];
const CELL = 180;           // Höhe einer Zelle (px), wie --cell in app.css
// Mindesthöhe je Kachel in Zellen: wird bei jeder Anordnung für die aktuelle Breite gemessen (Inhalt bei 1 Zelle).
// Bis dahin (oder für gerade ausgeblendete Kacheln wie den Live-Bezug) gelten diese Werte.
const MIN_ROWS = { shot: 2, status: 2, live: 2 };
const minRows = {};
const minH = (id) => minRows[id] ?? MIN_ROWS[id] ?? 1;
const clampW = (v, d) => ([0, 1, 2, 3].includes(Number(v)) ? Number(v) : d);
const clampH = (v, d) => ([1, 2, 3, 4].includes(Number(v)) ? Number(v) : d);

function tileVisible(id) {
  if (GRINDER_TILES.has(id) && !hasGrinder()) return false;
  if (id === 'care' && isHidden('care')) return false;
  // Sollwerte nur, wenn „Maschinen-Einstellungen ändern“ erlaubt ist
  if (id === 'targets' && store.server?.features?.settings === false) return false;
  return true;
}

function loadLayout() {
  let saved = null;
  try { saved = JSON.parse(localStorageGet(KEY) || 'null'); } catch { /* kaputt → Standard */ }
  const v3 = Number(saved?.v) >= 3;
  const tiles = (Array.isArray(saved?.tiles) ? saved.tiles : []).filter((t) => TILES[t?.id]).map((t) => {
    const def = TILES[t.id];
    // Ältere Layouts: „breit“ wird zur ganzen Breite, die Höhe kommt aus dem Standard
    const w = v3 ? clampW(t.w, def.w) : t.wide ? 0 : def.w;
    return { id: t.id, on: t.on !== false, w, h: v3 ? clampH(t.h, def.h) : def.h, ...(t.arr === 4 ? { arr: 4 } : {}) };
  });
  for (const id of Object.keys(TILES)) if (!tiles.some((t) => t.id === id)) tiles.push({ id, on: true, w: TILES[id].w, h: TILES[id].h });
  // Ältere Layouts (vor Version 5): einmalig die neue Standardanordnung, ein-/ausgeblendete Kacheln bleiben
  if (saved && Number(saved.v || 0) < 5) {
    const on = Object.fromEntries(tiles.map((t) => [t.id, t.on]));
    tiles.splice(0, tiles.length, ...Object.keys(TILES).map((id) => ({ id, on: on[id] !== false, w: TILES[id].w, h: TILES[id].h })));
  }
  return { tiles: pinControl(tiles), keepAwake: Boolean(saved?.keepAwake) };
}
const saveLayout = (l) => localStorageSet(KEY, JSON.stringify({ ...l, v: LAYOUT_VERSION }));

// „Schalter“ gehört immer direkt unter „Status“: in der Reihenfolge gleich dahinter (beim Anordnen dieselbe Spalte)
function pinControl(tiles) {
  const ci = tiles.findIndex((t) => t.id === 'control');
  if (ci < 0 || !tiles.some((t) => t.id === 'status')) return tiles;
  const [ct] = tiles.splice(ci, 1);
  tiles.splice(tiles.findIndex((t) => t.id === 'status') + 1, 0, ct);
  return tiles;
}

export function dashboardView(root) {
  let layout = loadLayout();
  let shots = [];
  let built = [];
  const grid = h('div', { class: 'dash stagger' });
  // Spaltenzahl aus der verfügbaren Breite; Kacheln spannen über w Spalten (höchstens alle) und h Zellen
  let cols = 1;
  // Erst alle Kacheln auf 1 Zelle setzen und ihren Platzbedarf lesen (ein Layoutdurchgang, kein Zwischenbild),
  // dann jede über max(gewählte Höhe, Mindesthöhe) Zellen spannen. Zellen sind fest CELL px hoch.
  const place = () => {
    // Eine Spalte (Handy): alle Kacheln untereinander, jede so hoch wie ihr Inhalt; Breite/Höhe sind dann ohne Wirkung
    grid.classList.toggle('single', cols === 1);
    if (cols === 1) {
      for (const b of built) {
        b.el.style.setProperty('grid-column', '1 / -1');
        b.el.style.setProperty('grid-row', 'auto');
        b.el.style.order = b.id === 'gauges' ? '-1' : '';
      }
      return;
    }
    const spanOf = (b) => (b.w === 0 ? cols : Math.min(b.w, cols));
    // Passen Status und Instrumente nicht nebeneinander (weniger Spalten), kommen die Instrumente nach oben
    const stB = built.find((b) => b.id === 'status' && !b.el.hidden);
    const gaB = built.find((b) => b.id === 'gauges');
    if (gaB) gaB.el.style.order = stB && spanOf(stB) + spanOf(gaB) > cols ? '-1' : '';
    for (const b of built) {
      const span = spanOf(b);
      b.el.style.setProperty('grid-column', span >= cols ? '1 / -1' : `span ${span}`);
      b.el.style.setProperty('grid-row', 'span 1');
    }
    for (const b of built) {
      if (b.el.hidden) continue;
      minRows[b.id] = Math.min(4, Math.max(1, Math.ceil((b.el.scrollHeight + GAP) / (CELL + GAP))));
    }
    for (const b of built) b.el.style.setProperty('grid-row', `span ${Math.max(b.h, minH(b.id))}`);
    // Schalter unter den Status: dieselbe Spalte und Breite (die Zeile ergibt sich, weil sie direkt dahinter folgen)
    const st = built.find((b) => b.id === 'status' && !b.el.hidden);
    const ctl = built.find((b) => b.id === 'control');
    if (ctl && st) {
      const span = spanOf(st);
      if (span >= cols) ctl.el.style.setProperty('grid-column', '1 / -1');
      else {
        const g = grid.getBoundingClientRect();
        const colW = (g.width - (cols - 1) * GAP) / cols;
        const col = Math.round((st.el.getBoundingClientRect().left - g.left) / (colW + GAP)) + 1;
        ctl.el.style.setProperty('grid-column', `${col} / span ${span}`);
      }
    }
  };
  // Wächst ein Inhalt nachträglich (z. B. Zeile „Zieldruck“ beim Einschalten des Dampfkessels), neu anordnen
  const refit = () => {
    if (cols > 1 && built.some((b) => !b.el.hidden && b.el.scrollHeight > b.el.clientHeight + 1)) place();
  };
  const relayout = () => place(); // Kachel hat ihren Inhalt verkleinert (z. B. Werte im Verlauf eingeklappt)
  const sizes = new ResizeObserver(() => {
    const width = grid.getBoundingClientRect().width;
    const n = Math.max(1, Math.min(4, Math.floor((width + GAP) / (MIN_COL + GAP))));
    if (n !== cols) {
      cols = n;
      grid.style.setProperty('--cols', String(cols));
      place();
    }
  });
  root.append(grid);
  setTopActions(h('button', { class: 'icon-btn', 'aria-label': 'Home anpassen', title: 'Home anpassen', onclick: customize }, icon('tune')));

  function build() {
    built = layout.tiles.filter((t) => t.on && tileVisible(t.id)).map((t) => {
      const def = TILES[t.id];
      const t0 = def.build({ wide: t.w !== 1, h: t.h, arr: t.arr, relayout: () => relayout() });
      const extra = h('span', { class: 'extra' });
      const open = def.link ? () => navigate(def.link) : null;
      const el = h('section', {
        class: `tile${t.w !== 1 ? ' wide' : ''}${def.link ? ' clickable' : ''} t-${t.id}`,
        dataset: { h: String(t.h) },
        role: def.link ? 'link' : null,
        tabindex: def.link ? '0' : null,
        'aria-label': def.title,
        onclick: open,
        onkeydown: open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : null,
      },
        h('header', { class: 'tile-head' }, icon(def.icon), h('span', {}, def.title), extra), h('div', { class: 'tile-body' }, t0.body));
      return { id: t.id, el, extra, update: t0.update, w: t.w, h: t.h };
    });
    grid.replaceChildren(built.length ? built.map((b) => b.el) : h('div', { class: 'empty' }, 'Keine Kachel ausgewählt. Oben rechts lässt sich das Dashboard anpassen.'));
    place();
    update();
  }

  function update() {
    const ctx = { m: store.machine, g: store.grinder?.enabled && hasGrinder() ? store.grinder : null, shots, maint };
    for (const b of built) {
      try {
        const r = b.update(ctx) || {};
        b.el.hidden = r.hidden === true;
        b.extra.replaceChildren(r.extra ?? '');
      } catch (e) { console.error(b.id, e); }
    }
    refit();
  }

  let maint = null;
  async function loadShots() {
    try { shots = (await api('/api/shots')).shots || []; } catch { /* nächster Versuch beim nächsten Bezug */ }
    try { maint = (await api('/api/maintenance')).backflush; } catch { maint = null; }
    update();
  }

  // Bildschirm anlassen (Tablet an der Wand): in der Android-App über die Brücke, im Browser per Wake Lock
  let wake = null;
  let disposed = false;
  async function setAwake(on) {
    if (on && disposed) return;
    if (typeof window.XeniaApp?.keepScreenOn === 'function') return window.XeniaApp.keepScreenOn(on);
    if (!navigator.wakeLock) return;
    if (on && !wake && document.visibilityState === 'visible') {
      const lock = await navigator.wakeLock.request('screen').catch(() => null);
      if (!lock) return;
      // Seite inzwischen verlassen oder ausgeschaltet: Sperre gleich wieder freigeben
      if (disposed || !layout.keepAwake || wake) return lock.release().catch(() => {});
      wake = lock;
      wake.addEventListener('release', () => { if (wake === lock) wake = null; });
    } else if (!on && wake) {
      wake.release().catch(() => {});
      wake = null;
    }
  }
  const onVisible = () => { if (layout.keepAwake && document.visibilityState === 'visible') setAwake(true); };
  document.addEventListener('visibilitychange', onVisible);

  function customize() {
    const list = h('div', { class: 'list dash-cfg' });
    const visible = () => layout.tiles.filter((t) => tileVisible(t.id));
    const paint = () => list.replaceChildren(visible().map((t, i, vis) => {
      const def = TILES[t.id];
      const move = (d) => {
        // Schalter überspringen: sie hängen fest unter dem Status und wandern mit ihm
        let j = i + d;
        while (vis[j]?.id === 'control') j += d;
        const next = vis[j];
        if (!next) return;
        const a = layout.tiles.indexOf(t);
        const b = layout.tiles.indexOf(next);
        [layout.tiles[a], layout.tiles[b]] = [layout.tiles[b], layout.tiles[a]];
        pinControl(layout.tiles);
        changed();
      };
      const pinned = t.id === 'control' && layout.tiles.some((x) => x.id === 'status');
      return h('div', { class: 'list-item dash-cfg-row' },
        switchEl({ checked: t.on, label: def.title, onChange: (on) => { t.on = on; changed(); } }),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, def.title), pinned ? h('div', { class: 'sub' }, 'Immer unter „Status“, gleiche Breite') : def.note ? h('div', { class: 'sub' }, def.note) : null),
        h('div', { class: 'dash-cfg-ctl' },
          pinned || cols === 1 ? null : sizeSelect(WIDTHS, t.w, `${def.title}: Breite`, (v) => { t.w = v; changed(); }),
          // Nur Höhen anbieten, in die der Inhalt bei der aktuellen Breite passt
          cols === 1 ? null : sizeSelect(HEIGHTS.filter(([v]) => v >= minH(t.id)), Math.max(t.h, minH(t.id)), `${def.title}: Höhe`, (v) => { t.h = v; changed(); }),
          // Handy: Instrumente 2 × 2 (größer) oder 1 × 4 (klein)
          cols === 1 && t.id === 'gauges' ? sizeSelect([[2, '2 × 2'], [4, '1 × 4']], t.arr === 4 ? 4 : 2, `${def.title}: Anordnung`, (v) => { if (v === 4) t.arr = 4; else delete t.arr; changed(); }) : null,
          t.id === 'shot' || pinned ? null : [
            h('button', { class: 'icon-btn', 'aria-label': `${def.title} nach oben`, disabled: i === 0, onclick: () => move(-1) }, icon('less')),
            h('button', { class: 'icon-btn', 'aria-label': `${def.title} nach unten`, disabled: i === vis.length - 1, onclick: () => move(1) }, icon('more'))]));
    }));
    const changed = () => {
      saveLayout(layout);
      if (!disposed) build(); // zuerst anordnen: misst die Mindesthöhen für die neue Breite
      paint();
    };
    paint();
    // Wake Lock gibt es im Browser nur über HTTPS (bzw. localhost); in der Android-App immer
    const canWake = typeof window.XeniaApp?.keepScreenOn === 'function' || ('wakeLock' in navigator && window.isSecureContext);
    sheet('Home anpassen', h('div', {},
      h('p', { class: 'muted small' }, cols === 1
        ? 'Kacheln ein- und ausblenden und ihre Reihenfolge ändern. Auf diesem schmalen Bildschirm stehen alle Kacheln untereinander, jede so hoch wie ihr Inhalt; Breite und Höhe lassen sich ab Tablet-Breite einstellen. Die Auswahl gilt für dieses Gerät.'
        : 'Breite in Spalten, Höhe in Zellen (wie Android-Widgets); Kacheln einer Zeile sind gleich hoch. Die Auswahl gilt für dieses Gerät.'),
      list,
      h('div', { class: 'section-title' }, 'Dieses Gerät'),
      h('div', { class: 'list' },
        canWake ? h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon('screen')), h('div', { class: 'grow' }, h('div', { class: 'title' }, 'Bildschirm anlassen'), h('div', { class: 'sub' }, 'Solange Home offen ist')),
          switchEl({ checked: layout.keepAwake, label: 'Bildschirm anlassen', onChange: (on) => { layout.keepAwake = on; saveLayout(layout); setAwake(on); } })) : null),
      h('button', { class: 'btn text wide', onclick: () => { const keep = layout.keepAwake; layout = loadLayoutDefaults(keep); changed(); } }, icon('refresh', 's18'), 'Standard wiederherstellen')));
  }

  let lastEnded = store.machine?.lastShot?.endedAt;
  let wasRunning = Boolean(store.machine?.shot?.running);
  // Neue Bezüge erkennt die Seite am Ende-Zeitpunkt des letzten Bezugs (auch nachträglich erkannte)
  const un = subscribe((part) => {
    if (part === 'event') return;
    if (part === 'server') { build(); return; }
    const m = store.machine;
    if (m?.lastShot?.endedAt && m.lastShot.endedAt !== lastEnded) {
      lastEnded = m.lastShot.endedAt;
      loadShots();
    }
    // Neuer Bezug: nach oben scrollen, damit die Live-Kurve sichtbar ist
    if (m?.shot?.running && !wasRunning) window.scrollTo({ top: 0, behavior: 'smooth' });
    wasRunning = Boolean(m?.shot?.running);
    update();
  });
  // Uhrzeit-Angaben („vor 3 min“) und das Ausblenden des fertigen Bezugs auch ohne neue Daten
  const tick = setInterval(update, 5000);
  const unPrefs = onPrefs((k) => { if (k === 'hiddenComponents') build(); else update(); });

  build();
  sizes.observe(grid);
  loadShots();
  if (layout.keepAwake) setAwake(true);
  return () => {
    disposed = true;
    sizes.disconnect();
    un();
    unPrefs();
    clearInterval(tick);
    document.removeEventListener('visibilitychange', onVisible);
    setAwake(false);
  };
}

function loadLayoutDefaults(keepAwake) {
  return { tiles: Object.keys(TILES).map((id) => ({ id, on: true, w: TILES[id].w, h: TILES[id].h })), keepAwake };
}

function sizeSelect(options, value, label, onChange) {
  const el = h('select', { class: 'text small-select', 'aria-label': label, title: label },
    options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  el.addEventListener('change', () => onChange(Number(el.value)));
  return el;
}

// --- Kacheln -----------------------------------------------------------------------
// Jede Kachel: build({wide, h}) → { body, update(ctx) → {hidden?, extra?} }; ctx = { m: Maschine, g: Mühle|null, shots }

// Zusätzliche Höhe für Diagramme in höheren Kacheln (eine Zelle = CELL px)
const extraH = (h) => (Math.max(1, h || 1) - 1) * CELL;

function shotTile({ wide, h: rows }) {
  const chart = h('div', { class: 'chart-box' });
  const side = h('div', { class: 'live-side' });
  const body = h('div', { class: 'live-shot-grid' }, chart, side);
  return {
    body,
    update({ m }) {
      if (!m) return { hidden: true };
      const running = m.shot?.running;
      const ls = m.lastShot;
      const recent = !running && ls?.endedAt && !ls.estimated && Date.now() - Date.parse(ls.endedAt) < FINISHED_MS;
      if (!running && !recent) return { hidden: true };
      const curve = running ? m.shot.curve : ls.curve;
      const secs = running ? (m.shot.timeMs || 0) / 1000 : (ls.timeMs || 0) / 1000;
      chart.replaceChildren(shotChart(curve, { live: running, width: wide ? 560 : 320, height: Math.max(140, (wide ? 220 : 160) + extraH(rows) - CELL) }));
      const p = running ? m.pressure.pump : ls.maxPressure;
      const w = running ? m.scale.weight : ls.weight;
      const flow = running ? (m.scale.rate || m.flow.rate) : null;
      side.replaceChildren(
        ring(secs / 30, `${fmt(secs, 0)} s`),
        h('div', { class: 'dash-kpis' },
          kpi(running ? 'Druck' : 'Max. Druck', fmt(p), 'bar', 'pu'),
          kpi('Gewicht', w ? fmt(w) : running ? fmt(0) : '–', 'g', 'w'),
          running ? kpi('Fluss', fmt(flow), 'g/s') : kpi('Menge', ls.volumeMl ? fmt(ls.volumeMl, 0) : '–', 'ml')));
      return { extra: running ? h('span', { class: 'badge ok pulse' }, 'Bezug läuft') : h('span', { class: 'badge' }, 'Fertig') };
    },
  };
}

// Schalter: Ein/Eco/Aus als Segmente, Dampfkessel und „Ohne Dampf einschalten“ (gilt geräteweit, wie auf der Startseite)
function controlTile() {
  let busy = false;
  const seg = (mode, label, ic) => h('button', { class: 'seg-btn', type: 'button', dataset: { mode }, onclick: (e) => { e.stopPropagation(); setMode(mode); } }, icon(ic, 's18'), label);
  const btnOn = seg('on', 'Ein', 'power');
  const btnEco = seg('eco', 'Eco', 'eco');
  const btnOff = seg('off', 'Aus', 'close');
  const steamSw = switchEl({ label: 'Dampfkessel', onChange: (on, input) => setSteam(on, input) });
  const steamState = h('span', { class: 'muted small' });
  const noSteamSw = switchEl({ checked: noSteamOn(), label: 'Ohne Dampf einschalten', onChange: (on) => setNoSteamOn(on) });
  // „Skript stoppen“: erscheint nur, solange ein Skript, Bezug oder Backflush läuft
  const stopBtn = h('button', { class: 'btn danger wide', type: 'button', hidden: true, onclick: () => run(async () => {
    const r = await api('/api/machine/scripts/stop', { method: 'POST' });
    if (!r.stopped && !r.backflush) throw new Error('Kein Skript aktiv – nichts gestoppt');
  }, 'Wird gestoppt') }, icon('stop', 's18'), 'Skript stoppen');
  const body = h('div', { class: 'dash-control' },
    stopBtn,
    h('div', { class: 'seg' }, btnOn, btnEco, btnOff),
    h('div', { class: 'ctl-row' }, icon('cloud', 's20'), h('span', { class: 'grow' }, 'Dampfkessel ', steamState), steamSw),
    h('div', { class: 'ctl-row' }, icon('power', 's20'), h('span', { class: 'grow' }, 'Ohne Dampf einschalten'), noSteamSw));

  async function run(fn, msg) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      snackbar(msg);
    } catch (e) {
      snackbar(e.message);
    } finally {
      busy = false;
    }
  }
  function setMode(mode) {
    const m = store.machine;
    if (!m?.online) return snackbar('Maschine nicht erreichbar');
    if (mode === 'on') {
      const b = powerOnBody();
      return run(() => api('/api/machine/power', { method: 'POST', body: b }), b.steam === false ? 'Xenia wird ohne Dampf eingeschaltet' : 'Xenia wird eingeschaltet');
    }
    if (mode === 'eco') return run(() => api('/api/machine/power', { method: 'POST', body: { mode: 'eco' } }), 'Eco-Modus an');
    return run(() => api('/api/machine/power', { method: 'POST', body: { mode: 'off' } }), 'Xenia ausgeschaltet');
  }
  function setSteam(on, input) {
    run(async () => {
      try { await api('/api/machine/steam', { method: 'POST', body: { on } }); } catch (e) { input.checked = !on; throw e; }
    }, on ? 'Dampfkessel an' : 'Dampfkessel aus');
  }
  // Schalter selbst lösen keine Navigation aus
  body.addEventListener('click', (e) => e.stopPropagation());
  return {
    body,
    update({ m }) {
      const online = Boolean(m?.online);
      const key = m?.statusKey;
      const on = ['on', 'brewing', 'draining', 'paddle'].includes(key);
      const eco = key === 'eco';
      const off = key === 'off';
      const brewing = key === 'brewing';
      for (const [b, active] of [[btnOn, on], [btnEco, eco], [btnOff, off]]) {
        b.setAttribute('aria-pressed', String(Boolean(online && active)));
        b.disabled = !online || brewing || (active && online);
      }
      btnEco.disabled ||= off;
      const sIn = steamSw.querySelector('input');
      sIn.checked = Boolean(m?.steamOn);
      sIn.disabled = !online || !(on || eco) || !machineOn(m);
      steamState.textContent = !online ? '' : m.steamOn ? (m.steamReady ? `bereit · ${fmt(m.pressure.steam, 1)} bar` : `heizt · ${fmt(m.pressure.steam, 1)} bar`) : 'aus';
      noSteamSw.querySelector('input').checked = noSteamOn();
      stopBtn.hidden = !scriptActive(m);
      stopBtn.lastChild.textContent = m?.backflush ? 'Backflush stoppen' : m?.shot?.script?.title ? `„${m.shot.script.title}“ stoppen` : 'Bezug stoppen';
      return { extra: !online ? h('span', { class: 'badge bad' }, 'Offline') : null };
    },
  };
}

function statusTile() {
  const head = h('div', { class: 'dash-status' });
  const meters = h('div', { class: 'dash-meters' });
  const chips = h('div', { class: 'chips' });
  const running = h('div', { class: 'dash-running', hidden: true });
  return {
    body: [head, running, meters, chips],
    update({ m, shots }) {
      if (!m) {
        head.replaceChildren(orb('info', ''), h('div', {}, h('div', { class: 'label' }, 'Keine Daten')));
        return {};
      }
      const [text, cls, ic] = !m.online ? ['Offline', 'bad', 'warn']
        : m.statusKey === 'off' ? ['Aus', 'off', 'power']
        : m.statusKey === 'eco' ? ['Eco', 'off', 'eco']
        : m.statusKey === 'brewing' ? ['Bezug läuft', 'ok', 'coffee']
        : m.statusKey === 'fault' ? ['Störung', 'bad', 'warn']
        : m.heated ? ['Bereit', 'ok', 'check'] : ['Heizt auf', 'warn', 'thermo'];
      head.className = `dash-status ${cls}`;
      head.replaceChildren(orb(ic), h('div', {}, h('div', { class: 'label' }, text),
        h('div', { class: 'muted small' }, m.online ? `Brühgruppe ${fmt(m.temp.group)} °C` : `Letzter Kontakt ${ago(m.lastSeen)}`)));
      // Laufendes Skript (Name, Zeit, Restzeit soweit bekannt), Backflush-Runde oder die letzte Störung
      const sh = m.shot || {};
      if (m.online && m.backflush) {
        running.hidden = false;
        running.className = 'dash-running';
        running.replaceChildren(h('div', { class: 'run-title' }, icon('play', 's18'), 'Backflush'),
          h('div', { class: 'muted small' }, `Runde ${fmtInt(m.backflush.cycle)} von ${fmtInt(m.backflush.cycles)}`),
          targetBar(m.backflush.cycle, m.backflush.cycles, { max: m.backflush.cycles }));
      } else if (m.online && sh.running) {
        const secs = (sh.timeMs || 0) / 1000;
        const total = scriptDuration(sh.script?.steps);
        const left = total ? Math.max(0, total - secs) : null;
        running.hidden = false;
        running.className = 'dash-running';
        running.replaceChildren(h('div', { class: 'run-title' }, icon('play', 's18'), sh.script?.title || 'Bezug (an der Maschine gestartet)'),
          h('div', { class: 'muted small' }, left !== null ? `${fmt(secs, 0)} s · noch etwa ${fmt(left, 0)} s` : `${fmt(secs, 0)} s`),
          total ? targetBar(Math.min(secs, total), total, { max: total }) : null);
      } else if (m.lastFault) {
        running.hidden = false;
        running.className = 'dash-running fault';
        running.replaceChildren(h('div', { class: 'run-title' }, icon('warn', 's18'), m.lastFault.text), h('div', { class: 'muted small' }, ago(m.lastFault.at)));
      } else {
        running.hidden = true;
      }
      const on = m.online && m.statusKey !== 'off';
      meters.replaceChildren(
        on && m.temp.groupSet ? meter('Brühgruppe', `${fmt(m.temp.group)} / ${fmt(m.temp.groupSet)} °C`, targetBar(m.temp.group, m.temp.groupSet, { max: m.temp.groupSet + 5, heating: true })) : null,
        on && m.temp.boilerSet ? meter('Brühkessel', `${fmt(m.temp.boiler)} / ${fmt(m.temp.boilerSet)} °C`, targetBar(m.temp.boiler, m.temp.boilerSet, { max: m.temp.boilerSet + 5, heating: true })) : null,
        on && m.steamOn ? meter('Dampfkessel', `${fmt(m.pressure.steam, 2)} / ${fmt(m.pressure.steamSet, 1)} bar`, targetBar(m.pressure.steam, m.pressure.steamSet, { max: (m.pressure.steamSet || 1.5) * 1.3, heating: true })) : null);
      const today = new Date().toDateString();
      const n = shots.filter((s) => new Date(s.endedAt).toDateString() === today).length;
      chips.replaceChildren(
        m.tankOk === false ? h('span', { class: 'badge bad' }, 'Tank leer') : m.tankOk ? h('span', { class: 'badge ok' }, 'Tank ok') : null,
        h('span', { class: 'badge' }, m.steamOn ? (m.steamReady ? 'Dampf bereit' : 'Dampf heizt') : 'Dampf aus'),
        h('span', { class: 'badge' }, `${fmtInt(n)} ${n === 1 ? 'Bezug' : 'Bezüge'} heute`));
      return {};
    },
  };
}

function gaugesTile({ arr } = {}) {
  const pressure = createGauge({ title: 'Druck', min: 0, max: 12, majorStep: 2, minorStep: 0.5, redFrom: 11, digits: 1, unit: 'bar', mano: { max: 16, majorStep: 2, minorStep: 1, labelEvery: 2, label: 'POMPA' } });
  const temp = createGauge({ title: 'Brühgruppe', min: 20, max: 110, majorStep: 10, minorStep: 2.5, redFrom: 100, digits: 1, labelEvery: 20, unit: '°C', mano: { min: 0, max: 120, majorStep: 20, minorStep: 5, labelEvery: 20, label: 'GRUPPO' } });
  const boiler = createGauge({ title: 'Brühkessel', min: 20, max: 110, majorStep: 10, minorStep: 2.5, redFrom: 100, digits: 1, labelEvery: 20, unit: '°C', mano: { min: 0, max: 120, majorStep: 20, minorStep: 5, labelEvery: 20, label: 'CAFFÈ' } });
  const steam = createGauge({ title: 'Dampfkessel', min: 0, max: 2.5, majorStep: 0.5, minorStep: 0.1, redFrom: 2, digits: 2, labelEvery: 1, unit: 'bar', mano: { max: 3, majorStep: 0.5, minorStep: 0.1, labelEvery: 0.5, label: 'CALDAIA' } });
  // Die Manometer füllen die Fläche der Kachel: je nach Breite und Höhe in einer Reihe (4 × 1) oder als 2 × 2,
  // je nachdem, was größere Instrumente ergibt. So geht die Kachel bis auf Höhe 1 (flachste Version: kleine Reihe).
  const grid = h('div', { class: 'gauges dash-gauges' }, pressure, temp, boiler, steam);
  const fit = h('div', { class: 'gauge-fit' }, grid);
  const OVER = 54; // Titel über und Messwert unter jedem Manometer (px)
  const GAPX = 6;
  const GAPY = 8;
  const arrange = () => {
    const W = fit.clientWidth;
    const H = fit.clientHeight;
    if (!W) return;
    if (fit.closest('.dash.single')) {
      // Handy: Höhe nach Inhalt; Anordnung in „Home anpassen“ wählbar (Standard 2 × 2, sonst 1 × 4)
      const c = arr === 4 ? 4 : 2;
      const size = Math.floor(Math.min((W - GAPX * (c - 1)) / c - 8, 200));
      grid.style.setProperty('grid-template-columns', `repeat(${c}, minmax(0, 1fr))`);
      grid.style.setProperty('--gsize', `${size}px`);
      grid.classList.toggle('tiny', size < 90);
      return;
    }
    if (!H) return;
    let best = null;
    for (const [c, r] of [[4, 1], [2, 2]]) {
      const size = Math.min((W - GAPX * (c - 1)) / c, (H - r * OVER - GAPY * (r - 1)) / r, 220);
      if (!best || size > best.size) best = { c, size };
    }
    const size = Math.max(36, Math.floor(best.size));
    grid.style.setProperty('grid-template-columns', `repeat(${best.c}, minmax(0, 1fr))`);
    grid.style.setProperty('--gsize', `${size}px`);
    grid.classList.toggle('tiny', size < 90);
  };
  new ResizeObserver(arrange).observe(fit);
  return {
    body: fit,
    update({ m }) {
      if (!m) return {};
      pressure.update(m.pressure.pump, 'bar');
      temp.update(m.temp.group, m.temp.groupSet ? `Ziel ${fmt(m.temp.groupSet)} °C` : '°C');
      boiler.update(m.temp.boiler, m.temp.boilerSet ? `Ziel ${fmt(m.temp.boilerSet)} °C` : '°C');
      steam.update(m.pressure.steam, m.steamOn ? `Ziel ${fmt(m.pressure.steamSet, 1)} bar` : 'aus');
      return {};
    },
  };
}

function lastShotTile({ wide, h: rows }) {
  const box = h('div', {});
  return {
    body: box,
    update({ m }) {
      const ls = m?.lastShot;
      if (!ls) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Noch kein Bezug'));
        return {};
      }
      const met = shotMetrics(ls);
      const ratio = met.ratio;
      const amount = met.yieldG ? [fmt(met.yieldG), 'g'] : ls.volumeMl ? [fmt(ls.volumeMl, 0), 'ml'] : ['–', ''];
      box.replaceChildren(
        h('div', { class: 'dash-kpis' }, kpi('Zeit', fmt(ls.timeMs / 1000), 's'), kpi('Menge', amount[0], amount[1], 'w'),
          ratio ? kpi('Verhältnis', `1:${fmt(ratio)}`, '') : kpi('Max. Druck', fmt(ls.maxPressure), 'bar', 'pu')),
        ls.curve?.length > 1 ? shotChart(ls.curve, { width: wide ? 560 : 320, height: (wide ? 160 : 130) + extraH(rows), minSeconds: 20 }) : h('p', { class: 'muted small' }, 'Keine Kurve (Bezug nachträglich erkannt)'));
      return { extra: `${ls.notes?.rating ? `${'★'.repeat(ls.notes.rating)} · ` : ''}${ago(ls.endedAt)}${ls.estimated ? ' · nachträglich' : ''}` };
    },
  };
}

function lastGrindTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Mühle nicht eingerichtet'));
        return {};
      }
      const last = g.grinds?.[0] || g.stats?.lastGrind;
      if (!last) {
        box.replaceChildren(h('div', { class: 'empty' }, g.online ? 'Noch keine Mahlvorgänge' : 'Mühle offline'));
        return {};
      }
      const recipe = g.recipes?.find((r) => r.index === last.recipe);
      box.replaceChildren(
        h('div', { class: 'big-row' },
          h('div', { class: 'big' }, last.success && last.weightG ? fmt(last.weightG) : '–', h('span', { class: 'unit' }, ' g')),
          h('div', { class: 'muted' }, last.targetG ? `Ziel ${fmt(last.targetG)} g` : last.mode === 'ByTime' ? 'nach Zeit' : '')),
        last.success && last.weightG ? targetBar(last.weightG, last.targetG) : h('span', { class: 'badge bad' }, 'Abgebrochen'),
        h('div', { class: 'chips' },
          h('span', { class: 'badge' }, `${fmt(last.durationMs / 1000)} s`),
          last.recipe ? h('span', { class: 'badge' }, `Rezept ${last.recipe}${recipe?.type ? ` · ${TYPE_DE[recipe.type] || recipe.type}` : ''}`) : null,
          TRIGGER_DE[last.trigger] ? h('span', { class: 'badge' }, TRIGGER_DE[last.trigger]) : null,
          last.ddd != null ? h('span', { class: 'badge' }, `${fmtInt(last.ddd)} µm`) : null,
          last.gbs ? h('span', { class: 'badge ok' }, 'Grind-by-Sync') : null,
          !g.online ? h('span', { class: 'badge bad' }, 'offline') : null));
      return { extra: ago(last.at) };
    },
  };
}

function weekTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ shots }) {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        days.push({ key: d.toDateString(), label: i === 0 ? 'heute' : d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''), value: 0, cls: i === 0 ? 'now' : '' });
      }
      for (const s of shots) {
        const day = days.find((d) => d.key === new Date(s.endedAt).toDateString());
        if (day) day.value++;
      }
      const sum = days.reduce((a, d) => a + d.value, 0);
      box.replaceChildren(sum ? barChart(days) : h('div', { class: 'empty' }, 'Keine Bezüge in den letzten 7 Tagen'));
      return { extra: `${fmtInt(sum)} in 7 Tagen` };
    },
  };
}

function shotTimesTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ shots }) {
      const list = shots.filter((s) => !s.estimated && s.timeMs > 0).slice(0, 12).reverse();
      if (!list.length) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Bezüge mit Zeit'));
        return {};
      }
      const avg = list.reduce((a, s) => a + s.timeMs, 0) / list.length / 1000;
      box.replaceChildren(barChart(list.map((s, i) => ({
        value: s.timeMs / 1000,
        label: new Date(s.endedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        cls: i === list.length - 1 ? 'now' : '',
      })), { unit: 's' }));
      return { extra: `Ø ${fmt(avg, 0)} s` };
    },
  };
}

function grindsTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Mühle nicht eingerichtet'));
        return {};
      }
      // Spülen/abgebrochene Mahlvorgänge (unter halbem Ziel) verzerren die Skala und sagen über die Genauigkeit nichts
      const list = (g.grinds || []).filter((x) => x.success && x.weightG >= 1 && (!x.targetG || x.weightG >= x.targetG / 2)).slice(0, 12).reverse();
      if (!list.length) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Noch keine Mahlvorgänge'));
        return {};
      }
      box.replaceChildren(barChart(list.map((x) => {
        const off = x.targetG ? Math.abs(x.weightG - x.targetG) / x.targetG : null;
        return { value: x.weightG, mark: x.targetG, label: x.recipe ? `R${x.recipe}` : '', cls: off === null ? '' : off <= 0.03 ? 'ok' : off <= 0.08 ? 'warn' : 'bad' };
      }), { unit: 'g', digits: 1 }), h('div', { class: 'legend muted small' }, h('span', { class: 'mark-key' }), 'Ziel', h('span', { class: 'sw ok' }), '±3 %', h('span', { class: 'sw warn' }), '±8 %'));
      const dev = g.stats?.avgDeviationG;
      return { extra: dev !== null && dev !== undefined ? `Ø Abw. ${fmt(dev, 2)} g` : '' };
    },
  };
}

function grinderTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ g }) {
      if (!g) {
        box.replaceChildren(h('div', { class: 'empty' }, 'Mühle nicht eingerichtet'));
        return {};
      }
      const st = g.stats || {};
      const alerts = (g.alerts || []).filter((a) => a.active);
      const recipe = g.recipes?.find((r) => r.selected);
      box.replaceChildren(
        h('div', { class: 'dash-kpis' },
          kpi('Mahlvorgänge', fmtInt(st.today ?? 0), ''),
          kpi('Kaffee', fmt(st.todayCoffeeG ?? 0), 'g'),
          kpi('Gesamt', fmtInt(st.totalGrinds ?? 0), '')),
        h('div', { class: 'chips' },
          h('span', { class: `badge ${g.online ? 'ok' : 'bad'}` }, g.online ? 'online' : 'offline'),
          recipe ? h('span', { class: 'badge' }, `Rezept ${recipe.index} gewählt`) : null,
          ...alerts.slice(0, 3).map((a) => h('span', { class: 'badge warn' }, ALERT_TEXT[a.type] || a.type))));
      return { extra: g.lastSync ? `Stand ${ago(g.lastSync)}` : '' };
    },
  };
}

// Verlauf der letzten 10 Minuten; darunter lassen sich alle Sensorwerte aufklappen (die Kachel wächst dann mit)
function liveTile({ wide, h: rows, relayout }) {
  const box = h('div', { class: 'chart-fit' }); // füllt die Kachel; Höhe kommt aus der gewählten Zellenzahl
  const legend = h('div', { class: 'legend muted small' }, SERIES.map((s) => [h('span', { class: `sw ${s.cls}` }), s.label]));
  const values = h('dl', { class: 'kv live-values', hidden: true });
  const toggle = h('button', { class: 'tab-mini', type: 'button', 'aria-expanded': 'false', onclick: (e) => {
    e.stopPropagation();
    // Diagramm behält seine Höhe; die Kachel bekommt für die Werte zusätzliche Zellen
    if (values.hidden) box.style.minHeight = `${box.clientHeight}px`;
    else box.style.minHeight = '';
    values.hidden = !values.hidden;
    if (!values.hidden) fill(store.machine); // sofort füllen, nicht erst mit der nächsten Statusmeldung
    toggle.setAttribute('aria-expanded', String(!values.hidden));
    toggle.lastChild.textContent = values.hidden ? 'Alle Werte' : 'Werte ausblenden';
    relayout?.();
    // Nach dem Auf- und Zuklappen die Kachel so in den sichtbaren Bereich holen, dass sie ihn möglichst füllt
    const tile = toggle.closest('.tile');
    requestAnimationFrame(() => fitIntoView(tile));
    setTimeout(() => fitIntoView(tile), 400); // nach dem Nachladen der Werte und dem Neuanordnen
  } }, icon('more', 's18'), h('span', {}, 'Alle Werte'));
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
  return {
    body: [box, h('div', { class: 'live-foot' }, legend, toggle), values],
    update({ m }) {
      // Diagramm im Seitenverhältnis der Kachel zeichnen (Faktor 0,6 → Schrift und Linien etwa 1,7-fach), damit
      // es die Fläche füllt, ohne die Beschriftung zu verkleinern
      const bw = box.clientWidth, bh = box.clientHeight;
      const size = bw > 50 && bh > 30 ? { width: Math.round(bw * 0.6), height: Math.round(bh * 0.6) } : { width: wide ? 640 : 320, height: (wide ? 200 : 150) + extraH(rows) };
      box.replaceChildren(liveChart(liveHistory, SERIES, { ...size, spanMs: 10 * 60e3 }));
      if (!values.hidden) fill(m);
      return {};
    },
  };
  function fill(m) {
      if (m) {
        values.replaceChildren(
          ...row('Brühgruppe', `${fmt(m.temp.group)} °C (Ziel ${fmt(m.temp.groupSet)})`),
          ...row('Brühkessel', `${fmt(m.temp.boiler)} °C (Ziel ${fmt(m.temp.boilerSet)})`),
          ...row('Pumpendruck', `${fmt(m.pressure.pump)} bar`),
          ...row('Dampfkessel', m.steamOn ? `${fmt(m.pressure.steam, 2)} bar (Ziel ${fmt(m.pressure.steamSet)})` : `aus (Ziel ${fmt(m.pressure.steamSet)} bar)`),
          ...row('Heizleistung Gruppe / Kessel', `${fmt(m.power?.group, 0)} % / ${fmt(m.power?.boiler, 0)} %`),
          ...row('Pumpenleistung', `${fmt(m.power?.pump, 0)} %`),
          ...(isHidden('scale') ? [] : row('Waage', `${fmt(m.scale?.weight)} g · ${fmt(m.scale?.rate)} g/s`)),
          ...row('Durchfluss', `${fmt(m.flow?.ml ?? m.flow?.volume, 0)} ml · ${fmt(m.flow?.rate)} ml/s`),
          ...row('Wassertank', m.tankOk === false ? 'leer' : m.tankOk ? 'ok' : '–'));
      }
  }
}

// Element so scrollen, dass es zwischen Kopfleiste und unterer Leiste ganz sichtbar ist; ist es höher als der
// verfügbare Platz, steht sein Kopf direkt unter der Kopfleiste
function fitIntoView(el) {
  if (!el) return;
  const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 64) + 8;
  const nav = document.getElementById('navbar')?.getBoundingClientRect();
  const bottom = (nav && nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight) - 8;
  const r = el.getBoundingClientRect();
  let dy = 0;
  if (r.height > bottom - top || r.top < top) dy = r.top - top;
  else if (r.bottom > bottom) dy = r.bottom - bottom;
  if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: 'smooth' });
}

// Sollwerte: Brühgruppe, Brühkessel, Dampfdruck mit − / +; gespeichert wird 1,5 s nach dem letzten Tipp.
// Ein gespeicherter Wert bleibt stehen, bis die Maschine ihn meldet (höchstens 8 s).
function targetsTile() {
  const rows = [
    { key: 'BG_SET_TEMP', label: 'Brühgruppe', min: 60, max: 96, step: 0.5, unit: '°C', read: (m) => m.temp.groupSet },
    { key: 'BB_SET_TEMP', label: 'Brühkessel', min: 60, max: 96, step: 0.5, unit: '°C', read: (m) => m.temp.boilerSet },
    { key: 'SB_SET_PRESS', label: 'Dampfdruck', min: 0, max: 1.8, step: 0.1, unit: 'bar', read: (m) => m.pressure?.steamSet },
  ].map((r) => {
    const st = { ...r, value: null, timer: null, hold: null };
    const val = h('button', { class: 'tgt-val num', type: 'button', title: 'Wert eingeben', onclick: async (e) => {
      e.stopPropagation();
      const n = await promptNumber(r.label, { value: st.value, min: r.min, max: r.max, step: 0.1, unit: r.unit });
      if (n === null || Number.isNaN(n)) return;
      set(Math.round(n * 10) / 10, 0);
    } }, '–');
    const set = (v, delay = 1500) => {
      st.value = Math.round(Math.min(r.max, Math.max(r.min, v)) * 10) / 10;
      val.textContent = `${fmt(st.value)} ${r.unit}`;
      clearTimeout(st.timer);
      st.timer = setTimeout(async () => {
        st.timer = null;
        try {
          await api('/api/machine/settings', { method: 'POST', body: { changes: { [r.key]: st.value } } });
          st.hold = { value: st.value, until: Date.now() + 8000 };
          snackbar(`${r.label}: ${fmt(st.value)} ${r.unit} gespeichert`);
        } catch (e) { snackbar(e.message); }
      }, delay);
    };
    st.el = h('div', { class: 'tgt-row' }, h('span', { class: 'grow' }, r.label),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${r.label} verringern`, onclick: (e) => { e.stopPropagation(); if (st.value !== null) set(st.value - r.step); } }, icon('more', 's20')),
      val,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `${r.label} erhöhen`, onclick: (e) => { e.stopPropagation(); if (st.value !== null) set(st.value + r.step); } }, icon('less', 's20')));
    st.val = val;
    return st;
  });
  return {
    body: h('div', { class: 'tgt-list' }, rows.map((r) => r.el)),
    update({ m }) {
      if (!m) return {};
      for (const r of rows) {
        const v = r.read(m);
        if (r.hold && (v === r.hold.value || Date.now() > r.hold.until)) r.hold = null;
        if (!r.timer && !r.hold && v !== null && v !== undefined) {
          r.value = v;
          r.val.textContent = `${fmt(v)} ${r.unit}`;
        }
      }
      return { extra: m.online ? null : h('span', { class: 'badge bad' }, 'Offline') };
    },
  };
}

// Pflege: Tage seit dem letzten Backflush als Ring (voll = fällig)
function careTile() {
  const box = h('div', {});
  return {
    body: box,
    update({ maint: b }) {
      if (!b) return { hidden: true };
      const pct = b.daysSince === null ? 1 : Math.min(1, b.daysSince / b.intervalDays);
      box.replaceChildren(h('div', { class: `care-row ${b.due ? 'due' : ''}` },
        ring(pct, b.daysSince === null ? '–' : `${b.daysSince} d`),
        h('div', {},
          h('div', { class: 'label' }, b.due ? 'Backflush fällig' : 'Backflush ok'),
          h('div', { class: 'muted small' }, b.lastAt ? `${fmtInt(b.shotsSince)} Bezüge seit dem letzten · alle ${b.intervalDays} Tage` : 'Noch nie eingetragen'))));
      return { extra: b.due ? h('span', { class: 'badge warn' }, 'fällig') : '' };
    },
  };
}

function kpi(k, v, unit, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, unit ? h('span', { class: 'muted small' }, ' ' + unit) : null));
}
function meter(label, value, bar) {
  return h('div', { class: 'dash-meter' }, h('div', { class: 'row between small' }, h('span', { class: 'muted' }, label), h('span', { class: 'num' }, value)), bar);
}
function orb(ic) {
  return h('span', { class: 'orb' }, icon(ic));
}
