// Schalter: Tastenbelegung an der Maschine (mit Frontansicht). Paddle (Pumpe direkt) als eigener Tab.
import { h, icon, fmt, snackbar, confirmDialog, switchEl } from '../ui.js';
import { api, store, subscribe, machineOn, isClassic, hasPaddle, directMode } from '../api.js';
import { contrastOn, navigate } from '../app.js';

export function controlsView(root) {
  return switchesTab(root);
}

// Eigener Tab „Paddle“: Pumpe direkt steuern
export function paddleView(root) {
  if (!hasPaddle()) {
    root.append(h('div', { class: 'card low' }, h('h3', {}, 'Paddle'),
      h('p', { class: 'muted' }, store.machine?.info ? 'Diese Xenia bietet die Paddle-Steuerung nicht über die API an (ältere Firmware).' : 'Maschine noch nicht erreicht – Paddle ist verfügbar, sobald die Firmware erkannt ist.')));
    return () => {};
  }
  return paddleTab(root);
}

// --- Schalter ------------------------------------------------------------------------
// Taster an der Front (vgl. Original-UI „Button Assignments“). Oben links ist fest Ein/Aus;
// die übrigen drei Taster tragen je ein Skript für kurz/lang drücken (SWITCH_SET_<Taster>_<0|1>).
const BUTTONS = [
  { key: 'POWER', label: 'Oben links', cx: 110, cy: 52, glyph: 'power', fixed: { short: 'Ein/Aus', long: 'Ein ohne Dampfkessel' } },
  { key: 'RIGHT_RIGHT', label: 'Oben rechts', cx: 210, cy: 52, glyph: 'cup1' },
  { key: 'LEFT_LEFT', label: 'Unten links', cx: 110, cy: 78, glyph: 'crown' },
  { key: 'RIGHT_LEFT', label: 'Unten rechts', cx: 210, cy: 78, glyph: 'cup2' },
];

// Alte Xenia (DBL): zwei kleine Kippschalter, jeder lässt sich nach links und nach rechts drücken (kurz/lang).
// Nummern wie auf dem Foto der Maschine: ① links◀, ② links▶ (am Ein/Aus-Symbol, fest Ein/Aus, gesperrt),
// ③ rechts◀ (am Tassen-Symbol), ④ rechts▶. Die API kennt die drei belegbaren Positionen
// SWITCH_SET_LEFT_LEFT/RIGHT_LEFT/RIGHT_RIGHT; LEFT_RIGHT fehlt dort, weil fest Ein/Aus.
const DBL_BUTTONS = [
  { key: 'LEFT_LEFT', no: 1, label: 'Links ◀', lever: 'left', dir: -1 },
  { key: 'POWER', no: 2, label: 'Links ▶', lever: 'left', dir: 1, fixed: { short: 'Ein/Aus', long: 'Ein ohne Dampfkessel' } },
  { key: 'RIGHT_LEFT', no: 3, label: 'Rechts ◀', lever: 'right', dir: -1 },
  { key: 'RIGHT_RIGHT', no: 4, label: 'Rechts ▶', lever: 'right', dir: 1 },
];

const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}

// --- Frontansicht der Xenia (Render) -------------------------------------------------------
// Ganze Maschine von vorn: Tassenablage, Gehäuse in der eingestellten Farbe, Brühgruppe mit Siebträger, Drehknöpfe aus
// Holz, Heißwasser- und Dampflanze (Seite einstellbar), Manometer, Abtropfschale. Neue Xenia: vier Taster und Display;
// alte Xenia (DBL, nach Foto): zwei Kippschalter oben, vier Leuchten rechts der Brühgruppe. Nur die Taster bzw. die
// Schalterseiten sind antippbar. Farbe und Seite der Dampflanze: Einstellungen → Modell & Aussehen.
export const LOOK_DEFAULTS = { color: '#26272b', steamSide: 'left' };
export function machineLook() {
  const l = store.server?.machine?.look || {};
  return {
    color: /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color.toLowerCase() : LOOK_DEFAULTS.color,
    steamSide: l.steamSide === 'right' ? 'right' : 'left',
    editButton: l.editButton !== false,
  };
}

// Farbe heller (f > 0) oder dunkler (f < 0)
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255]
    .map((c) => Math.max(0, Math.min(255, Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)))).toString(16).padStart(2, '0')).join('');
}

const GLYPHS = {
  power: 'M-3.2 -3.6 A4.6 4.6 0 1 0 3.2 -3.6 M0 -5.4 V-0.6',
  cup1: 'M-4 -3 H3 V1 A3 3 0 0 1 0 4 H-1 A3 3 0 0 1 -4 1 Z M3 -1.6 H4.4 A1.4 1.4 0 0 1 4.4 1.2 H3',
  cup2: 'M-5.5 -1 H0.5 V2 A2.4 2.4 0 0 1 -1.9 4.4 H-3.1 A2.4 2.4 0 0 1 -5.5 2 Z M-2 -4.4 H4 V-1.4 A2.4 2.4 0 0 1 1.6 1 M4 -3 H5.2 A1.2 1.2 0 0 1 5.2 -0.6 H4',
  crown: 'M-5 3 H5 M-5 3 L-5.5 -3 L-2.5 0 L0 -4 L2.5 0 L5.5 -3 L5 3',
};

function pickable(g, key, onPick) {
  g.addEventListener('click', () => onPick(key));
  g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(key); } });
  return g;
}

function xeniaSvg({ classic, look, onPick }) {
  const body = look.color;
  const light = contrastOn(body) !== '#ffffff'; // helles Gehäuse → dunkle Schrift und Symbole
  const ink = light ? '#45474c' : '#d3d5d9';
  const grad = (id, stops, horizontal = false) => s('linearGradient', { id, x1: 0, y1: 0, x2: horizontal ? 1 : 0, y2: horizontal ? 0 : 1 },
    stops.map(([o, c, op]) => s('stop', { offset: o, 'stop-color': c, 'stop-opacity': op })));
  const defs = s('defs', {},
    grad('mChrome', [['0', '#7d8186'], ['.45', '#f4f6f8'], ['1', '#8a8e93']], true),
    grad('mChromeV', [['0', '#f4f6f8'], ['.55', '#b9bdc2'], ['1', '#7d8186']]),
    grad('mBody', [['0', shade(body, 0.1)], ['1', shade(body, -0.2)]]),
    grad('mSide', [['0', '#000', 0.22], ['.12', '#000', 0], ['.88', '#000', 0], ['1', '#000', 0.22]], true),
    grad('mWood', [['0', '#7a4320'], ['.45', '#c98a4f'], ['1', '#7a4320']], true));

  // Tassenablage und Gehäuse
  const rail = [s('rect', { x: 44, y: 21, width: 232, height: 10, rx: 2, fill: 'url(#mChrome)' })];
  for (let x = 52; x < 272; x += 8) rail.push(s('line', { x1: x, y1: 23, x2: x, y2: 29, stroke: '#7d8186', 'stroke-width': 1.2 }));
  const shell = [
    s('rect', { class: 'body', x: 40, y: 30, width: 240, height: 232, rx: 7 }),
    s('rect', { x: 40, y: 30, width: 240, height: 232, rx: 7, fill: 'url(#mSide)' }),
    s('rect', { x: 44, y: 31, width: 232, height: 2, fill: '#fff', opacity: light ? 0.5 : 0.08 }),
  ];

  // Abtropfschale mit versetzten Schlitzen
  const slots = [];
  for (let r = 0; r < 3; r++) {
    for (let x = 48 + (r % 2) * 9; x + 13 <= 274; x += 18) slots.push(s('rect', { x, y: 271 + r * 10, width: 13, height: 6, rx: 3, fill: '#0c0d0f' }));
  }
  const tray = [
    s('rect', { class: 'body', x: 28, y: 262, width: 264, height: 74, rx: 6 }),
    s('rect', { x: 40, y: 267, width: 240, height: 33, rx: 4, fill: shade(body, -0.45) }),
    ...slots,
    s('line', { x1: 34, y1: 306, x2: 286, y2: 306, stroke: '#000', opacity: 0.25 }),
  ];

  // Brühgruppe mit Siebträger (Holzgriff zum Betrachter)
  const group = [
    s('path', { d: 'M134 50 H186 L182 118 H138 Z', fill: '#111214' }),
    s('path', { d: 'M142 56 H178 V92 Q160 101 142 92 Z', fill: 'url(#mChrome)' }),
    s('rect', { x: 147, y: 100, width: 26, height: 12, rx: 3, fill: '#fff2d2', opacity: 0.55 }),
    s('rect', { x: 122, y: 118, width: 76, height: 22, rx: 10, fill: 'url(#mChrome)', stroke: '#6f7378', 'stroke-width': 0.8 }),
    s('rect', { x: 132, y: 138, width: 56, height: 8, rx: 3, fill: 'url(#mChromeV)' }),
    s('path', { d: 'M138 146 H182 L175 162 H145 Z', fill: 'url(#mChrome)' }),
    s('rect', { x: 154, y: 161, width: 12, height: 9, rx: 2, fill: 'url(#mChrome)' }),
    s('path', { class: 'kn-wood', d: 'M150 175 Q160 170 170 175 L175 292 Q160 306 145 292 Z' }),
    s('path', { class: 'kn-grain', d: 'M155 182 Q151 230 156 290 M163 180 Q168 236 162 296 M158 200 Q162 214 158 228' }),
    s('rect', { x: 149, y: 168, width: 22, height: 9, rx: 3, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
  ];

  // Drehknöpfe aus Holz an den Ventilen; darunter Heißwasser und Dampflanze (Grundzeichnung: Dampf rechts)
  const knob = (vx, dir) => [
    s('line', { x1: vx, y1: 104, x2: vx + dir * 20, y2: 96, stroke: '#c3c7cc', 'stroke-width': 7, 'stroke-linecap': 'round' }),
    s('ellipse', { class: 'kn-wood', cx: vx + dir * 30, cy: 92, rx: 17, ry: 11, transform: `rotate(${dir * -18} ${vx + dir * 30} 92)` }),
    s('path', { class: 'kn-grain', d: `M${vx + dir * 20} 90 Q${vx + dir * 30} 86 ${vx + dir * 42} 90`, transform: `rotate(${dir * -18} ${vx + dir * 30} 92)` }),
    s('rect', { x: vx - 7, y: 96, width: 14, height: 24, rx: 4, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
  ];
  const water = [
    s('rect', { x: 80.5, y: 118, width: 7, height: 92, rx: 3, fill: 'url(#mChrome)' }),
    s('rect', { x: 78, y: 206, width: 12, height: 14, rx: 5, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
    s('rect', { x: 81, y: 219, width: 6, height: 6, rx: 2, fill: '#8a8e93' }),
  ];
  const steam = [
    s('rect', { x: 232.5, y: 118, width: 7, height: 52, rx: 3, fill: 'url(#mChrome)' }),
    s('circle', { cx: 236, cy: 172, r: 6, fill: 'url(#mChrome)', stroke: '#7d8186', 'stroke-width': 0.6 }),
    s('line', { x1: 236, y1: 172, x2: 262, y2: 254, stroke: '#c3c7cc', 'stroke-width': 6, 'stroke-linecap': 'round' }),
    s('line', { x1: 234.6, y1: 173, x2: 260.6, y2: 254, stroke: '#f2f4f6', 'stroke-width': 1.6, 'stroke-linecap': 'round', opacity: 0.8 }),
    s('line', { x1: 241, y1: 188, x2: 254, y2: 228, stroke: '#1b1c1f', 'stroke-width': 10, 'stroke-linecap': 'round' }),
    s('rect', { x: 259, y: 252, width: 7, height: 10, rx: 2, fill: '#8a8e93' }),
  ];
  const wands = s('g', look.steamSide === 'left' ? { transform: 'translate(320 0) scale(-1 1)' } : {}, ...water, ...steam);

  // Manometer und Schriftzug
  const gauge = (cx) => {
    const g = s('g', {}, s('circle', { cx, cy: 228, r: 14.5, fill: 'url(#mChrome)' }), s('circle', { cx, cy: 228, r: 11.8, fill: '#141518' }));
    for (let i = 0; i <= 8; i++) {
      const a = (Math.PI * (225 - i * 33.75)) / 180;
      g.append(s('line', { x1: cx + Math.cos(a) * 8.8, y1: 228 - Math.sin(a) * 8.8, x2: cx + Math.cos(a) * 11, y2: 228 - Math.sin(a) * 11, stroke: '#e8e8e8', 'stroke-width': 0.9 }));
    }
    g.append(s('line', { x1: cx, y1: 228, x2: cx - 5, y2: 222, stroke: '#e8e8e8', 'stroke-width': 1.3, 'stroke-linecap': 'round' }),
      s('circle', { cx, cy: 228, r: 1.6, fill: '#d0342c' }));
    return g;
  };
  // Schriftzug wie an der Maschine halb hinter dem Siebträgergriff („NIA“ rechts davon sichtbar)
  const front = [gauge(106), gauge(214),
    s('text', { x: 175, y: 232, 'text-anchor': 'middle', fill: ink, 'font-size': 10, 'letter-spacing': 3.5, 'font-weight': 300 }, 'XENIA')];

  // Bedienelemente je Modell
  const controls = [];
  if (classic) {
    // DBL: Leuchten rechts der Brühgruppe, Symbole neben den Kippschaltern
    for (let i = 0; i < 4; i++) controls.push(s('circle', { cx: 206, cy: 128 + i * 15, r: 5.2, fill: 'url(#mChrome)' }), s('circle', { cx: 206, cy: 128 + i * 15, r: 3.6, fill: '#2a2c31' }));
    controls.push(s('path', { d: 'M119.5 63 A6 6 0 1 0 126.5 63 M123 59 V66', fill: 'none', stroke: ink, 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      s('path', { d: 'M192 61 H202 V67 A3.5 3.5 0 0 1 198.5 70.5 H195.5 A3.5 3.5 0 0 1 192 67 Z M202 63 H204 A2 2 0 0 1 204 67 H202', fill: 'none', stroke: ink, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }));
  } else {
    controls.push(s('rect', { x: 200, y: 128, width: 12, height: 40, rx: 2, fill: '#0b1020', stroke: '#2c3a66' }),
      s('rect', { x: 202, y: 134, width: 8, height: 4, fill: '#9fd3ff', opacity: 0.9 }), s('rect', { x: 202, y: 148, width: 8, height: 10, fill: '#9fd3ff', opacity: 0.9 }));
  }

  const svg = s('svg', { class: `machine-svg render${classic ? ' dbl' : ''}`, viewBox: '20 14 280 326', role: 'img',
    'aria-label': classic ? 'Xenia DBL von vorn mit den zwei Kippschaltern' : 'Xenia von vorn mit den vier Tastern' },
  defs, ...rail, ...shell, ...tray, ...front, ...controls, ...knob(84, -1), ...knob(236, 1), wands, ...group);

  if (!classic) {
    for (const b of BUTTONS) {
      svg.append(pickable(s('g', { class: 'mbtn', 'data-key': b.key, role: 'button', tabindex: 0, 'aria-label': `Taster ${b.label}` },
        s('circle', { class: 'halo', cx: b.cx, cy: b.cy, r: 15 }),
        s('circle', { class: 'cap', cx: b.cx, cy: b.cy, r: 10 }),
        s('circle', { class: 'cap-in', cx: b.cx, cy: b.cy, r: 7.6 }),
        s('g', { class: 'glyph', transform: `translate(${b.cx} ${b.cy})` }, s('path', { d: GLYPHS[b.glyph] }))), b.key, onPick));
    }
    return svg;
  }

  // DBL: zwei Kippschalter; jede Seite antippbar, die gewählte kippt den Hebel sichtbar. ② ist fest Ein/Aus.
  const tips = {};
  const toggle = (cx, cy, side) => {
    const tip = s('g', { class: 'tg-tip' },
      s('line', { class: 'tg-stem', x1: cx, y1: cy, x2: cx, y2: cy }),
      s('circle', { class: 'tg-head', cx, cy, r: 4.6 }));
    tips[side] = { tip, cx };
    const halves = DBL_BUTTONS.filter((b) => b.lever === side).map((b) => {
      const nx = cx + b.dir * 15;
      return pickable(s('g', { class: `mbtn lever-side${b.fixed ? ' fixed' : ''}`, 'data-key': b.key, role: 'button', tabindex: 0, 'aria-label': `Schalter ${b.no} ${b.label}` },
        s('rect', { class: 'halo', x: b.dir < 0 ? cx - 19 : cx + 1, y: cy - 13, width: 18, height: 26, rx: 8 }),
        s('circle', { class: 'pos-ring', cx: nx, cy: cy - 22, r: 7.5 }),
        s('text', { class: 'pos-no', x: nx, y: cy - 18.6, 'text-anchor': 'middle' }, String(b.no)),
        s('rect', { class: 'hit', x: b.dir < 0 ? cx - 30 : cx, y: cy - 32, width: 30, height: 48 })), b.key, onPick);
    });
    return s('g', { class: 'toggle' },
      s('polygon', { class: 'tg-nut', points: hexPoints(cx, cy, 10.5) }),
      s('circle', { class: 'tg-ring', cx, cy, r: 7.4 }),
      s('circle', { class: 'tg-hole', cx, cy, r: 5.2 }),
      tip, ...halves);
  };
  svg.append(toggle(105, 63, 'left'), toggle(215, 63, 'right'));
  svg.tilt = (key) => {
    const b = DBL_BUTTONS.find((x) => x.key === key);
    for (const [side, t] of Object.entries(tips)) {
      const dx = b && b.lever === side ? b.dir * 8 : 0;
      t.tip.querySelector('.tg-head').setAttribute('cx', String(t.cx + dx));
      t.tip.querySelector('.tg-stem').setAttribute('x2', String(t.cx + dx));
      t.tip.classList.toggle('tilted', Boolean(dx));
    }
  };
  return svg;
}

function hexPoints(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

function switchesTab(root) {
  const features = store.server?.features || {};
  const classic = isClassic();
  const BTNS = classic ? DBL_BUTTONS : BUTTONS;
  const box = h('div', {}, h('div', { class: 'empty' }, 'Lade Belegung …'));
  root.append(box);
  (async () => {
    try {
      const [sw, sc] = await Promise.all([api('/api/machine/switches'), api('/api/machine/scripts')]);
      const options = [
        ...Object.entries(sc.builtin).map(([id, title]) => ({ id: Number(id), title: classic && id === '7' && sw.singleDoseG ? `${title} ${sw.singleDoseG} g/ml` : classic && id === '8' && sw.doubleDoseG ? `${title} ${sw.doubleDoseG} g/ml` : title })),
        ...sc.scripts.filter((x) => x.id > 9).map((x) => ({ id: x.id, title: x.title })),
      ];
      const nm = (id) => options.find((o) => o.id === id)?.title || (id ? `Skript ${id}` : 'Keine');
      const assign = {};
      for (const b of BTNS) if (!b.fixed) assign[b.key] = { short: sw.buttons[b.key]?.short ?? 0, long: sw.buttons[b.key]?.long ?? 0 };
      const changed = {};
      const editable = Boolean(features.settings);

      const saveBtn = h('button', { class: 'btn filled wide', disabled: true, onclick: async () => {
        saveBtn.disabled = true;
        try {
          await api('/api/machine/switches', { method: 'PUT', body: { buttons: changed } });
          for (const k of Object.keys(changed)) delete changed[k];
          snackbar('Tastenbelegung gespeichert');
        } catch (e) {
          snackbar(e.message);
          saveBtn.disabled = false;
        }
      } }, icon('check', 's18'), 'Belegung speichern');

      const cards = {};
      let selected = null;
      const look = machineLook();
      const svg = xeniaSvg({ classic, look, onPick: (key) => pick(key) });
      function pick(key) {
        selected = selected === key ? null : key;
        for (const g of svg.querySelectorAll('.mbtn')) g.classList.toggle('sel', g.dataset.key === selected);
        svg.tilt?.(selected);
        for (const [k, c] of Object.entries(cards)) c.classList.toggle('sel', k === selected);
        if (selected) cards[selected].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      const select = (b, press) => {
        const el = h('select', { class: 'text', 'aria-label': `${b.label} ${press === 'short' ? 'kurz' : 'lang'}`, disabled: !editable },
          options.map((o) => h('option', { value: o.id, selected: o.id === assign[b.key][press] }, o.title)));
        if (!options.some((o) => o.id === assign[b.key][press])) el.append(h('option', { value: assign[b.key][press], selected: true }, nm(assign[b.key][press])));
        el.addEventListener('change', () => {
          assign[b.key][press] = Number(el.value);
          changed[b.key] = { ...(changed[b.key] || {}), [press]: Number(el.value) };
          saveBtn.disabled = false;
        });
        el.addEventListener('focus', () => { if (selected !== b.key) pick(b.key); });
        return el;
      };
      const grid = h('div', { class: 'btn-assign' }, BTNS.map((b) => {
        const c = h('div', { class: 'assign-card', onclick: (e) => { if (e.target.tagName !== 'SELECT') pick(b.key); } },
          h('div', { class: 'ttl' }, classic ? `${'①②③④'[b.no - 1]} Schalter ${b.label}` : b.label, b.fixed ? h('span', { class: 'badge' }, 'gesperrt') : null),
          b.fixed
            ? [h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Kurz'), h('span', { class: 'v' }, b.fixed.short)),
              h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Lang'), h('span', { class: 'v' }, b.fixed.long))]
            : [h('label', { class: 'kv' }, h('span', { class: 'k' }, 'Kurz'), select(b, 'short')),
              h('label', { class: 'kv' }, h('span', { class: 'k' }, 'Lang'), select(b, 'long'))]);
        cards[b.key] = c;
        return c;
      }));

      box.replaceChildren(
        h('div', { class: 'card' },
          h('h3', {}, 'Tastenbelegung'),
          h('p', { class: 'muted small' }, classic
            ? 'Alte Xenia (DBL): Eine Position ①–④ antippen und auswählen, was kurzes bzw. langes Drücken startet. ② (linker Schalter nach rechts, am Ein/Aus-Symbol) ist fest Ein/Aus und lässt sich nicht ändern.'
            : 'Einen Taster antippen und auswählen, was kurzes bzw. langes Drücken startet. Eigene Abläufe entstehen unter „Skripte“.'),
          h('div', { class: 'machine-wrap' }, svg,
            directMode || !look.editButton ? null : h('button', { class: 'btn text', type: 'button', onclick: () => navigate('/einstellungen/modell') }, icon('settings', 's18'), 'Farbe und Dampflanze ändern')),
          grid,
          editable ? saveBtn : h('p', { class: 'muted small' }, 'Ändern ist in der Server-Konfiguration deaktiviert.')));
    } catch (e) {
      box.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  })();
  return () => {};
}

// --- Paddle ------------------------------------------------------------------------------
// Paddle-Modus aus ⇒ Pumpe aus. Maschine aus/offline ⇒ alles gesperrt.
// Optional Aufnahme wie in der Original-UI: Pumpenleistung über die Zeit als Paddle-Skript speichern.
function paddleTab(root) {
  const features = store.server?.features || {};
  if (!features.paddle) {
    root.append(h('div', { class: 'empty' }, 'Paddle-Steuerung ist in der Server-Konfiguration deaktiviert.'));
    return () => {};
  }
  let active = false;
  let level = 0;
  let sendTimer = null;
  let pollTimer = null;
  let startedAt = null;
  let inflight = Promise.resolve();
  let rec = null; // { steps, lastLevel, lastAt }
  const vP = h('div', { class: 'v' }, '0,0');
  const vL = h('div', { class: 'v' }, '0');
  const vT = h('div', { class: 'v' }, '0');
  const fill = h('div', { class: 'fill' });
  const knob = h('div', { class: 'knob' });
  const lvl = h('div', { class: 'lvl' }, '0 %');
  const paddle = h('div', { class: 'paddle locked', role: 'slider', 'aria-label': 'Pumpenleistung', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-disabled': 'true', tabindex: 0 },
    h('div', { class: 'lines' }), fill, lvl, knob);
  const stopBtn = h('button', { class: 'btn danger wide big', onclick: () => stopPump(true) }, icon('power', 's20'), 'PUMPE STOPPEN');
  const enable = switchEl({ label: 'Paddle aktivieren', onChange: (on) => setActive(on) });
  const enableInput = enable.querySelector('input');
  const recSw = switchEl({ label: 'Aufnahme', onChange: (on) => setRecording(on) });
  const recInput = recSw.querySelector('input');
  const recInfo = h('div', { class: 'muted small' }, 'Bewegungen des Reglers als Paddle-Skript speichern.');
  const hint = h('div', { class: 'offline-banner', hidden: true }, icon('warn', 's20'), h('span', {}, 'Maschine ist aus – Paddle nicht verfügbar.'));

  root.append(
    hint,
    h('div', { class: 'card low row' }, h('div', { class: 'grow' }, h('strong', {}, 'Paddle-Modus'), h('div', { class: 'muted small' }, 'Pumpenleistung direkt steuern (Vorinfusion, Profil von Hand). Ausschalten stoppt die Pumpe.')), enable),
    h('div', { class: 'card low row' }, icon('record'), h('div', { class: 'grow' }, h('strong', {}, 'Aufnahme'), recInfo), recSw),
    h('div', { class: 'readouts' },
      h('div', {}, vP, h('div', { class: 'k' }, 'Druck (bar)')),
      h('div', {}, vL, h('div', { class: 'k' }, 'Pumpe (%)')),
      h('div', {}, vT, h('div', { class: 'k' }, 'Zeit (s)'))),
    paddle,
    stopBtn);

  function paint() {
    paddle.style.setProperty('--lvl', String(level));
    lvl.textContent = `${Math.round(level)} %`;
    vL.textContent = String(Math.round(level));
    paddle.setAttribute('aria-valuenow', String(Math.round(level)));
  }
  function paintEnabled() {
    const on = machineOn();
    hint.hidden = on;
    enableInput.disabled = !on;
    recInput.disabled = !on || !active;
    stopBtn.disabled = !on && level === 0;
    paddle.classList.toggle('locked', !active || !on);
    paddle.setAttribute('aria-disabled', String(!active || !on));
    if (!on && active) setActive(false);
  }
  function setActive(on) {
    active = on && machineOn();
    enableInput.checked = active;
    if (!active) {
      if (rec) setRecording(false);
      stopPump(false);
    } else poll();
    paintEnabled();
  }
  function setLevel(v) {
    level = Math.max(0, Math.min(100, Math.round(v)));
    if (level > 0 && !startedAt) startedAt = Date.now();
    paint();
    clearTimeout(sendTimer);
    sendTimer = setTimeout(send, 150);
  }
  function send() {
    if (!active) return;
    const lv = level;
    recordLevel(lv);
    inflight = inflight.then(async () => {
      if (!active) return; // inzwischen ausgeschaltet: nicht mehr senden
      try {
        await api('/api/machine/paddle', { method: 'POST', body: { level: lv } });
      } catch (e) {
        snackbar(e.status === 502 ? 'Pumpe nicht bereit (Maschine an? Gerade am Ablassen?)' : e.message);
        level = 0;
        paint();
      }
    });
  }
  async function stopPump(notify) {
    clearTimeout(sendTimer);
    level = 0;
    startedAt = null;
    paint();
    // Erst laufende Pumpen-Befehle abwarten, sonst könnte ein später ankommender Wert die Pumpe wieder starten.
    const run = inflight.then(async () => {
      try {
        await api('/api/machine/paddle/stop', { method: 'POST' });
        if (notify) snackbar('Pumpe gestoppt');
      } catch (e) {
        if (notify) snackbar(e.message);
      }
    });
    inflight = run;
    await run;
    paintEnabled();
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (!active) return;
    try {
      const d = await api('/api/machine/paddle');
      vP.textContent = fmt(d.pressure, 1);
    } catch { /* still */ }
    vT.textContent = startedAt ? String(Math.round((Date.now() - startedAt) / 1000)) : '0';
    pollTimer = setTimeout(poll, 1000);
  }

  // --- Aufnahme ---
  function recordLevel(lv) {
    if (!rec) return;
    const now = Date.now();
    if (rec.lastAt !== null && now - rec.lastAt < 250 && rec.steps.length) {
      rec.lastLevel = lv; // schnelle Bewegung: letzten Wert überschreiben
      return;
    }
    flushSegment(now);
    rec.lastLevel = lv;
    rec.lastAt = now;
    recInfo.textContent = `Aufnahme läuft · ${rec.steps.length / 2} Abschnitte`;
  }
  function flushSegment(now) {
    if (rec.lastAt === null) return;
    let dur = Math.round((now - rec.lastAt) / 100) / 10;
    // Pumpenleistung (Op 3) erlaubt höchstens 45 s pro Schritt
    while (dur > 0) {
      const d = Math.min(45, dur);
      rec.steps.push(rec.lastLevel > 0 ? { op: 3, args: [rec.lastLevel, d] } : { op: 6, args: [] }, { op: 12, args: [d] });
      dur = Math.round((dur - d) * 10) / 10;
    }
  }
  async function setRecording(on) {
    recInput.checked = on;
    if (on) {
      rec = { steps: [], lastLevel: level, lastAt: level > 0 ? Date.now() : null };
      recInfo.textContent = 'Aufnahme läuft · bewege den Regler';
      return;
    }
    if (!rec) return;
    if (rec.lastLevel > 0) flushSegment(Date.now());
    const steps = rec.steps;
    rec = null;
    recInfo.textContent = 'Bewegungen des Reglers als Paddle-Skript speichern.';
    if (!steps.length) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `paddle_${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
    if (!(await confirmDialog('Aufnahme speichern?', `${steps.length / 2} Abschnitte als „${name}“ auf der Maschine speichern.`, 'Speichern'))) return;
    try {
      await api('/api/machine/scripts', { method: 'POST', body: { name, steps: [...steps, { op: 17, args: [] }], kind: 'paddle' } });
      snackbar('Paddle-Aufnahme gespeichert');
    } catch (e) {
      snackbar(e.message);
    }
  }

  const fromEvent = (e) => {
    const r = paddle.getBoundingClientRect();
    return ((r.bottom - e.clientY) / r.height) * 100;
  };
  paddle.addEventListener('pointerdown', (e) => {
    if (!machineOn()) return snackbar('Maschine ist aus');
    if (!active) return snackbar('Bitte zuerst „Paddle aktivieren“');
    paddle.setPointerCapture(e.pointerId);
    setLevel(fromEvent(e));
  });
  paddle.addEventListener('pointermove', (e) => {
    if (active && paddle.hasPointerCapture(e.pointerId)) setLevel(fromEvent(e));
  });
  paddle.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'ArrowUp') setLevel(level + 5);
    if (e.key === 'ArrowDown') setLevel(level - 5);
  });
  paint();
  paintEnabled();
  const un = subscribe((part) => {
    if (part === 'machine' || part === 'all' || part === 'conn') paintEnabled();
  });
  return () => {
    un();
    clearTimeout(pollTimer);
    const wasActive = active;
    active = false;
    rec = null;
    if (wasActive || level > 0) stopPump(false);
  };
}
