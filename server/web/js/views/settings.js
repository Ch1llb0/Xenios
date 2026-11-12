// Einstellungen: eine Liste von oben nach unten, gegliedert wie die Seite der Maschine
// (Waage, Maschine, Brühgruppe, Brühkessel, Dampfkessel, Pumpe, PID, Timer, Schalter, System, Wi-Fi, Aufzeichnung, Firmware).
// Maschinenwerte aus allen Abschnitten sammelt eine Speichern-Leiste und sendet sie gemeinsam.
import { h, icon, fmt, fmtInt, snackbar, switchEl, sliderRow, ago } from '../ui.js';
import { api, store, isClassic, classicPages } from '../api.js';
import { logout, applyTheme, localStorageGet, localStorageSet, inAndroidApp, navigate, navChoices, THEME_DEFAULTS } from '../app.js';
import { hiddenTabs, setTabHidden, COMPONENTS, isHidden, setComponentHidden, noSteamOn, setNoSteamOn, onPrefs } from '../prefs.js';

const listButton = (ic, title, sub, onclick) => h('button', { class: 'list-item clickable as-button', onclick },
  h('span', { class: 'lead' }, icon(ic)),
  h('span', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'sub' }, sub) : null),
  icon('right', 's20 muted'));

// Abschnitte in der Reihenfolge der Original-Oberfläche
const SECTIONS = [
  ['waage', 'Waage', 'scale'], ['maschine', 'Maschine', 'settings'], ['bruehgruppe', 'Brühgruppe', 'group'],
  ['bruehkessel', 'Brühkessel', 'boiler'], ['dampfkessel', 'Dampfkessel', 'cloud'], ['pumpe', 'Pumpe', 'drop'],
  ['pid', 'PID', 'pid'], ['timer', 'Timer', 'event'], ['schalter', 'Schalter', 'toggle'], ['system', 'System', 'palette'],
  ['wifi', 'Wi-Fi', 'wifi'], ['aufzeichnung', 'Aufzeichnung', 'record'], ['firmware', 'Firmware', 'info'], ['konto', 'Konto & Server', 'shield'],
];

export function settingsView(root) {
  const unsubs = [];
  const features = store.server?.features || {};
  const direct = store.server?.mode === 'direct';
  const sec = {};
  for (const [id, title, ic] of SECTIONS) {
    sec[id] = h('section', { class: 'set-section', id: `set-${id}` }, h('div', { class: 'section-title' }, icon(ic), title));
  }
  const add = (id, ...nodes) => sec[id].append(...nodes.filter(Boolean));
  const jump = h('nav', { class: 'set-nav', 'aria-label': 'Abschnitte' });

  // --- Speichern-Leiste für Maschinenwerte ---
  const changes = {};
  const saveBtn = h('button', { class: 'btn filled', onclick: save }, icon('check', 's18'), 'Speichern');
  const savebar = h('div', { class: 'savebar', hidden: true, role: 'region', 'aria-label': 'Ungespeicherte Änderungen' },
    h('span', { class: 'savebar-text' }, 'Maschinenwerte geändert'),
    h('button', { class: 'btn text', onclick: () => { for (const k of Object.keys(changes)) delete changes[k]; savebar.hidden = true; loadMachine(); } }, 'Verwerfen'),
    saveBtn);
  const set = (k) => (v) => { changes[k] = v; savebar.hidden = false; };
  async function save() {
    saveBtn.disabled = true;
    try {
      await api('/api/machine/settings', { method: 'POST', body: { changes } });
      for (const k of Object.keys(changes)) delete changes[k];
      savebar.hidden = true;
      snackbar('Einstellungen gespeichert');
    } catch (e) {
      snackbar(e.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  root.append(jump, ...SECTIONS.map(([id]) => sec[id]),
    h('p', { class: 'muted small', style: { 'text-align': 'center', 'margin-top': '24px' } }, `Xenios ${store.server?.version || ''}`), savebar);

  // --- Maschinenwerte (Brühgruppe, Brühkessel, Dampfkessel, Pumpe, Maschine) ---
  const slots = {
    maschine: h('div'), bruehgruppe: h('div'), bruehkessel: h('div'), dampfkessel: h('div'), pumpe: h('div'),
  };
  for (const [k, el] of Object.entries(slots)) add(k, el);
  add('maschine', powerPrefCard());
  slots.maschine.append(h('div', { class: 'empty' }, 'Lade Einstellungen …'));

  async function loadMachine() {
    try {
      const { settings: s } = await api('/api/machine/settings');
      const classic = isClassic();
      const pages = classic && (s._pages || classicPages());
      const full = !classic || pages; // Eco, Hysterese, Timer usw. verfügbar
      const has = (k) => s[k] !== undefined && s[k] !== null;
      const slider = (label, key, min, max, step, unit, digits = 1) => (has(key) || !classic
        ? sliderRow({ label, min, max, step, value: s[key] ?? min, unit, digits, onInput: set(key) }) : null);
      const sel = (label, key, options, onChange) => {
        if (classic && !has(key)) return null;
        const select = h('select', { class: 'text' }, options.map(([v, t]) => h('option', { value: v, selected: Number(s[key]) === v }, t)));
        select.addEventListener('change', () => { set(key)(Number(select.value)); onChange?.(Number(select.value)); });
        return h('label', { class: 'field', style: { 'margin-top': '8px' } }, h('span', {}, label), select);
      };
      const card = (...nodes) => (nodes.some(Boolean) ? h('div', { class: 'card' }, ...nodes) : null);

      // Maschine
      let flushRow = null;
      if (!classic) {
        flushRow = sliderRow({ label: 'Dauer der Aufheiz-Spülung', min: 1, max: 20, step: 1, value: Math.max(1, s.MA_HEATUP_FLUSH_DURATION || 1), unit: 's', digits: 0, onInput: set('MA_HEATUP_FLUSH_DURATION') });
        flushRow.hidden = Number(s.MA_FAST_HEATUP_TYPE) !== 1;
      }
      slots.maschine.replaceChildren(...[
        card(
          sel('Beim Einschalten', 'MA_BOILER_START_MODE', [[1, 'Brühkessel AN & Dampfkessel AN'], [2, 'Brühkessel AN & Dampfkessel AUS']]),
          classic ? null : sel('Aufheiz-Spülung', 'MA_FAST_HEATUP_TYPE', [[0, 'Keine Spülung'], [1, 'Automatische Spülung']], (v) => { flushRow.hidden = v !== 1; }),
          flushRow,
          pages ? slider('Aufheizphase: automatischer Leerbezug', 'MA_HEATUP_FLUSH_DURATION', 0, 20, 1, 's', 0) : null,
          pages ? sel('Wasserversorgung', 'MA_FIX_WATER_SUPPLY', [[0, 'Tank'], [1, 'Festwasseranschluss']]) : null,
          pages ? sel('Thermische Stabilität', 'MA_EXTENDED_THERMAL_STABILITY', [[0, 'normal'], [1, 'optimiert']]) : null,
          pages ? slider('Eco-Modus nach', 'MA_SET_TIMER_ECO_MA', 1, 240, 1, 'min', 0) : null,
          pages ? slider('Ausschalten nach', 'MA_SET_TIMER_POWERDOWN', 1, 240, 1, 'min', 0) : null),
        classic && !pages ? h('p', { class: 'muted small' }, 'Diese Firmware erlaubt über die API nur Temperatur und Dampfdruck. Weitere Werte stehen in der Original-Oberfläche.') : null,
      ].filter(Boolean));

      // Brühgruppe / Brühkessel / Dampfkessel
      slots.bruehgruppe.replaceChildren(card(
        slider('Temperatur', 'BG_SET_TEMP', 60, 96, 0.1, '°C'),
        full ? slider('Eco-Temperatur', 'BG_SET_ECO_TEMP', 40, 95, 0.1, '°C') : null,
        full ? slider('Hysterese', 'BG_SET_TEMP_HYST', 2, 5, 0.1, 'K') : null));
      slots.bruehkessel.replaceChildren(card(
        slider('Temperatur', 'BB_SET_TEMP', 60, 96, 0.1, '°C'),
        full ? slider('Eco-Temperatur', 'BB_SET_ECO_TEMP', 40, 95, 0.1, '°C') : null,
        full ? slider('Hysterese', 'BB_SET_TEMP_HYST', 2, 5, 0.1, 'K') : null));
      slots.dampfkessel.replaceChildren(card(
        slider('Druck', 'SB_SET_PRESS', 0, 1.8, 0.1, 'bar'),
        full ? slider('Eco-Druck', 'SB_SET_ECO_PRESS', 0, 1, 0.1, 'bar') : null,
        full ? slider('Hysterese', 'SB_SET_PRESS_HYST', 0.1, 0.3, 0.1, 'bar') : null));

      // Pumpe
      slots.pumpe.replaceChildren(...[card(
        pages ? slider('Bezugszeit Espresso (Standardbezug)', 'PU_SET_BREW_TIMER_1', 15, 60, 1, 's', 0) : null,
        pages ? h('p', { class: 'muted small' }, 'Wie lange die Pumpe beim Skript „Espresso“ läuft (z. B. auf einem Schalter).') : null,
        full ? slider('Max. Bezugszeit', 'PU_SET_MAX_TIMER', 30, 120, 1, 's', 0) : null,
        classic ? null : sel('Bezugszeit startet bei', 'MA_START_EXTRACTIONCOUNTER_EVENT', [[0, 'Pumpenstart'], [1, '1 bar Druck'], [2, 'Erster Tropfen in der Tasse']])),
      !full ? h('p', { class: 'muted small' }, 'Pumpenwerte sind bei dieser Firmware nur in der Original-Oberfläche einstellbar.') : null].filter(Boolean));

      if (!features.settings) {
        for (const el of Object.values(slots)) el.querySelectorAll('input,select').forEach((x) => { x.disabled = true; });
        slots.maschine.append(h('p', { class: 'muted small' }, 'Ändern ist in der Server-Konfiguration deaktiviert.'));
      }
    } catch (e) {
      slots.maschine.replaceChildren(h('div', { class: 'empty' }, e.message));
    }
  }
  loadMachine();

  // --- Waage ---
  if (!isHidden('scale')) add('waage', scaleCard(features));
  else sec.waage.remove();

  // --- PID (nur lesen) ---
  add('pid', h('div', { class: 'card low' }, serviceDetails()));

  // --- Timer / Schalter: eigene Tabs ---
  add('timer', h('div', { class: 'list' }, listButton('event', 'Wochen-Timer & Eco', 'Ein- und Ausschaltzeiten', () => navigate('/timer'))));
  add('schalter', h('div', { class: 'list' },
    listButton('toggle', 'Tastenbelegung', 'Was die Schalter an der Maschine starten', () => navigate('/steuerung')),
    listButton('speed', 'Paddle', 'Pumpe direkt steuern', () => navigate('/paddle'))));

  // --- System: Darstellung, Leiste, Komponenten, Benachrichtigungen ---
  const pushBox = h('div', { class: 'card' });
  add('system',
    h('h3', { class: 'sub-title' }, 'Darstellung'), themeCard(),
    h('h3', { class: 'sub-title' }, 'Untere Leiste'), navCard(unsubs),
    h('h3', { class: 'sub-title' }, 'Komponenten'), componentsCard(),
    h('h3', { class: 'sub-title' }, 'Benachrichtigungen'), pushBox);
  paintPush(pushBox);

  // --- Wi-Fi / Firmware: aus /api/machine/details ---
  const wifiBox = h('div', { class: 'card low' }, h('div', { class: 'muted' }, 'Lade …'));
  const fwBox = h('div', { class: 'card low' }, h('div', { class: 'muted' }, 'Lade …'));
  add('wifi', wifiBox);
  add('firmware', fwBox);
  (async () => {
    try {
      const d = await api('/api/machine/details');
      const m = d.machine || {};
      const i = d.info || {};
      const n = d.network || {};
      const st = store.machine || {};
      const sig = Number(n.WIFI_SIGNAL_STRENGTH);
      const sigTxt = Number.isFinite(sig) ? `${sig} dBm (${sig > -55 ? 'sehr gut' : sig > -67 ? 'gut' : sig > -75 ? 'schwach' : 'sehr schwach'})` : '–';
      wifiBox.replaceChildren(n.error && !n.WIFI_NAME
        ? h('div', { class: 'muted small' }, 'Diese Firmware gibt die WLAN-Daten nicht über die API heraus.')
        : h('dl', { class: 'kv' },
          h('dt', {}, 'Signal'), h('dd', {}, sigTxt),
          h('dt', {}, 'WLAN-Name'), h('dd', {}, n.WIFI_NAME || '–'),
          h('dt', {}, 'IP-Adresse'), h('dd', {}, n.WIFI_AP_IP || '–'),
          h('dt', {}, 'Verschlüsselung'), h('dd', {}, n.WIFI_ENCRYPTION || '–'),
          h('dt', {}, 'Eigener Access Point'), h('dd', {}, n.WIFI_SOFT_AP || '–'),
          h('dt', {}, 'Letzter Kontakt'), h('dd', {}, ago(st.lastSeen))));
      fwBox.replaceChildren(h('dl', { class: 'kv' },
        h('dt', {}, 'Modell'), h('dd', {}, st.info?.typeName || `Typ ${m.MA_TYPE}`),
        h('dt', {}, 'Firmware (Steuerung / WLAN)'), h('dd', {}, `${m.FW_VERSION_MAJOR}.${m.FW_VERSION_MINOR} / ${m.ESP_FW_MAJOR}.${m.ESP_FW_MINOR}`),
        h('dt', {}, 'Schnittstelle'), h('dd', {}, isClassic() ? (classicPages() ? 'alte API mit Seiten-API' : 'alte API') : 'Brew-by-Sync'),
        h('dt', {}, 'Seriennummer'), h('dd', {}, m.MA_SN || '–'),
        h('dt', {}, 'Bezüge gesamt'), h('dd', {}, fmtInt(m.MA_EXTRACTIONS)),
        h('dt', {}, 'Betriebsstunden'), h('dd', {}, fmtInt(m.MA_OPERATING_HOURS)),
        h('dt', {}, 'Energie gesamt'), h('dd', {}, `${fmt(m.MA_ENERGY_TOTAL_KWH, 2)} kWh`),
        h('dt', {}, 'Max. Strom'), h('dd', {}, `${fmtInt(m.MA_MAX_AMPERE)} A`),
        i.TZ_IND !== undefined ? h('dt', {}, 'Zeitzone (Index)') : null, i.TZ_IND !== undefined ? h('dd', {}, String(i.TZ_IND)) : null),
      h('p', { class: 'muted small' }, 'Firmware-Updates nur über die Original-Oberfläche der Maschine.'));
    } catch (e) {
      wifiBox.replaceChildren(h('div', { class: 'muted' }, e.message));
      fwBox.replaceChildren(h('div', { class: 'muted' }, e.message));
    }
  })();

  // --- Aufzeichnung ---
  add('aufzeichnung', shotFilterCard());

  // --- Konto & Server ---
  add('konto',
    direct ? h('div', { class: 'card low muted small' }, 'Direkt-Modus: Die App spricht Maschine und Mühle ohne Server im Heimnetz an. Eine Anmeldung gibt es dabei nicht. Wechsel des Modus unter „App-Verbindung“.') : null,
    h('div', { class: 'list' },
      direct ? null : listButton('shield', 'Server & Sicherheit', 'Geräte-Adressen, Passwort, angemeldete Geräte, Ports, Zertifikat', () => navigate('/server')),
      inAndroidApp() ? listButton('wifi', 'App-Verbindung', 'Server-Adresse und Anmeldung der Android-App', () => window.XeniaApp.reauth()) : null,
      listButton('logout', 'Abmelden', null, logout)));

  // Sprungmarken oben
  jump.replaceChildren(...SECTIONS.filter(([id]) => sec[id].isConnected).map(([id, title]) =>
    h('button', { class: 'chip', onclick: () => sec[id].scrollIntoView({ behavior: 'smooth', block: 'start' }) }, title)));

  return () => { unsubs.forEach((u) => u()); savebar.remove(); };
}

// Waage: Zielgewicht der Standardbezüge (Skripte 7/8). Die DBL-Oberfläche kennt sie nur als feste Werte.
function scaleCard(features) {
  const box = h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Lade …'));
  (async () => {
    try {
      const sw = await api('/api/machine/switches');
      if (isClassic()) {
        box.replaceChildren(h('dl', { class: 'kv' },
          h('dt', {}, 'Single (Skript 7)'), h('dd', {}, sw.singleDoseG ? `${fmtInt(sw.singleDoseG)} g/ml` : '–'),
          h('dt', {}, 'Double (Skript 8)'), h('dd', {}, sw.doubleDoseG ? `${fmtInt(sw.doubleDoseG)} g/ml` : '–')),
        h('p', { class: 'muted small' }, 'Bei der Xenia DBL sind diese Mengen fest. Die Original-Oberfläche bietet keine Einstellung dafür, deshalb ändert Xenios sie auch nicht.'));
        return;
      }
      const single = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.singleDoseG ?? '' });
      const double = h('input', { class: 'text', type: 'number', min: 1, max: 199, step: 0.5, value: sw.doubleDoseG ?? '' });
      box.replaceChildren(
        h('h3', {}, 'Bezugsgewicht (interne Waage)'),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', {}, 'Einfache Dosis (g)'), single),
          h('label', { class: 'field grow' }, h('span', {}, 'Doppelte Dosis (g)'), double)),
        h('div', { style: { height: '12px' } }),
        h('button', { class: 'btn filled wide', disabled: !features.settings, onclick: async () => {
          try {
            await api('/api/machine/switches', { method: 'PUT', body: { singleDoseG: Number(single.value), doubleDoseG: Number(double.value) } });
            snackbar('Gewichte gespeichert');
          } catch (e) { snackbar(e.message); }
        } }, 'Speichern'));
    } catch (e) {
      box.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  })();
  return box;
}

const prefRow = (ic, title, sub, sw) => h('div', { class: 'list-item' }, h('span', { class: 'lead' }, icon(ic)),
  h('div', { class: 'grow' }, h('div', { class: 'title' }, title), sub ? h('div', { class: 'sub' }, sub) : null), sw);

// Einschalten ohne Dampfkessel: gilt auf diesem Gerät für Startseite, Dashboard und den App-Shortcut „Ein“
function powerPrefCard() {
  return h('div', { class: 'list', style: { 'margin-top': '12px' } },
    prefRow('cloud', 'Ohne Dampf einschalten', '„Ein“ schaltet nur den Brühkessel ein (Startseite, Dashboard, Shortcut). Dampf lässt sich jederzeit dazuschalten.',
      switchEl({ checked: noSteamOn(), label: 'Ohne Dampf einschalten', onChange: (on) => setNoSteamOn(on) })));
}

// Tabs der unteren Leiste ein- und ausblenden (mindestens einer bleibt)
function navCard(unsubs) {
  const list = h('div', { class: 'list' });
  const paint = () => {
    const hidden = hiddenTabs();
    const all = navChoices();
    list.replaceChildren(all.map((r) => {
      const shown = r.fixed || !hidden.has(r.path);
      return prefRow(r.icon, r.label, r.fixed ? 'immer sichtbar' : null, switchEl({ checked: shown, disabled: Boolean(r.fixed), label: `${r.label} in der Leiste`, onChange: (on) => { setTabHidden(r.path, !on); paint(); } }));
    }));
  };
  paint();
  unsubs.push(onPrefs((k) => { if (k === 'hiddenComponents') paint(); }));
  return h('div', {}, h('p', { class: 'muted small' }, 'Welche Seiten in der Leiste stehen (gilt für dieses Gerät). Ausgeblendete Seiten bleiben über Links erreichbar. „Einstellungen“ bleibt immer sichtbar.'), list);
}

// Komponenten komplett ausblenden (z. B. die Mühle, wenn keine im Einsatz ist)
function componentsCard() {
  return h('div', {}, h('p', { class: 'muted small' }, 'Ausgeblendete Komponenten verschwinden aus Leiste, Startseite, Dashboard und Bezügen (gilt für dieses Gerät).'),
    h('div', { class: 'list' }, COMPONENTS.map((c) => prefRow(c.id === 'grinder' ? 'grinder' : c.id === 'scale' ? 'scale' : 'check', c.title, c.sub,
      switchEl({ checked: !isHidden(c.id), label: `${c.title} anzeigen`, onChange: (on) => setComponentHidden(c.id, !on) })))));
}

// Bezüge unter einer Mindestdauer aussortieren (Backflush, Spülen, Fehlbezüge); gilt auf dem Server bzw. in der App
function shotFilterCard() {
  const box = h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Lade …'));
  (async () => {
    try {
      const st = await api('/api/shots/settings');
      let value = st.minShotS;
      const save = h('button', { class: 'btn filled wide', disabled: true, onclick: async () => {
        save.disabled = true;
        try {
          const r = await api('/api/shots/settings', { method: 'PUT', body: { minShotS: value } });
          value = r.minShotS;
          snackbar(value ? `Bezüge unter ${value} s werden aussortiert` : 'Alle Bezüge werden gelistet');
        } catch (e) {
          snackbar(e.message);
          save.disabled = false;
        }
      } }, 'Speichern');
      box.replaceChildren(
        h('h3', {}, 'Kurze Bezüge aussortieren'),
        h('p', { class: 'muted small' }, `Pumpvorgänge kürzer als die Mindestdauer (Backflush, Spülen, Fehler) werden nicht protokolliert und nicht gelistet. Bewertete Bezüge bleiben sichtbar. Standard: ${st.defaultMinShotS} s.`),
        sliderRow({ label: 'Mindestdauer', min: st.limits.min, max: st.limits.max, step: 1, value, unit: 's', digits: 0, onInput: (v) => { value = v; save.disabled = false; } }),
        save);
    } catch (e) {
      box.replaceChildren(h('div', { class: 'muted small' }, e.message));
    }
  })();
  return box;
}

function themeCard() {
  const box = h('div', { class: 'card' });
  const paint = () => {
    const theme = localStorageGet('theme') || 'system';
    const style = localStorageGet('uiStyle') || THEME_DEFAULTS.style;
    const chips = (current, list, onPick) => h('div', { class: 'chips' }, list.map(([v, label]) =>
      h('button', { class: 'chip', 'aria-pressed': String(current === v), onclick: () => { onPick(v); applyTheme(); paint(); } }, label)));
    const color = (key, label, fallback) => {
      const value = localStorageGet(key) || fallback;
      const input = h('input', { type: 'color', value, 'aria-label': label });
      input.addEventListener('input', () => { localStorageSet(key, input.value); applyTheme(); });
      return h('div', { class: 'color-row' }, input, h('span', { class: 'grow' }, label),
        localStorageGet(key) ? h('button', { class: 'btn text', onclick: () => { try { localStorage.removeItem(key); } catch { /* privat */ } applyTheme(); paint(); } }, 'Standard') : null);
    };
    box.replaceChildren(
      h('div', { class: 'muted small' }, 'Stil'),
      chips(style, [['xenia', 'Xenia'], ['material', 'Material']], (v) => { localStorageSet('uiStyle', v); location.reload(); }),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, 'Temperatur- und Druckanzeigen'),
      chips(localStorageGet('gaugeStyle') || THEME_DEFAULTS.gauge, [['black', 'Wie die Maschine: schwarz'], ['white', 'Wie die Maschine: weiß'], ['app', 'Flach']], (v) => localStorageSet('gaugeStyle', v)),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, 'Helligkeit'),
      chips(theme, [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']], (v) => localStorageSet('theme', v)),
      h('div', { class: 'muted small', style: { 'margin-top': '12px' } }, 'Farben (gilt für dieses Gerät)'),
      color('accent', 'Akzent (Schaltflächen, Regler, Anzeigen)', THEME_DEFAULTS.accent[style]),
      color('activeColor', 'Aktiv (gewählter Zustand, z. B. „Ein“)', THEME_DEFAULTS.active[style]));
  };
  paint();
  return box;
}

// --- Push-Benachrichtigungen -------------------------------------------------------------
function b64ToBytes(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// PID- und Sensorwerte der Original-Oberfläche – nur lesend; Ändern bleibt dort (Regelverhalten/Kalibrierung).
const SERVICE = [
  ['Brühgruppe (PID/Sensor)', 'brewgroup/pid'],
  ['Brühkessel (PID/Sensor)', 'brewboiler/pid'],
  ['Pumpe (PID/Sensor)', 'pump/pid'],
  ['Dampfkessel (Sensor)', 'steamboiler/pid'],
  ['Waage, Durchfluss, Display', 'mahlkonig/get'],
];
function serviceDetails() {
  const body = h('div', {}, h('div', { class: 'muted small' }, 'Lade …'));
  const det = h('details', { class: 'adv' }, h('summary', {}, 'Regel- und Sensorwerte anzeigen', icon('more', 's20')), body);
  let loaded = false;
  det.addEventListener('toggle', async () => {
    if (!det.open || loaded) return;
    loaded = true;
    const parts = [];
    for (const [title, ep] of SERVICE) {
      try {
        const d = await api(`/api/raw/machine/${ep}`);
        const rows = Object.entries(d).filter(([k]) => k !== 'VIEW').flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))]);
        parts.push(h('h3', { style: { 'margin-top': '12px' } }, title), h('dl', { class: 'kv' }, ...rows));
      } catch (e) {
        parts.push(h('h3', { style: { 'margin-top': '12px' } }, title), h('div', { class: 'muted small' }, e.message));
      }
    }
    body.replaceChildren(h('p', { class: 'muted small' }, 'Regelparameter und Kalibrierung ändert der Server bewusst nicht (Gefahr falscher Temperaturen bzw. Waage). Dafür die Original-Oberfläche im WLAN nutzen.'), ...parts);
  });
  return det;
}

async function paintPush(box) {
  const push = store.server?.push;
  if (inAndroidApp()) {
    box.replaceChildren(h('div', { class: 'muted' }, 'In der Android-App gibt es noch keine Push-Benachrichtigungen. Dafür vorerst die Web-App in Chrome nutzen. Der Status ist über das Widget und die Schnelleinstellungs-Kachel sichtbar.'));
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    box.replaceChildren(h('div', { class: 'muted' }, 'Dieser Browser unterstützt keine Push-Benachrichtigungen. Tipp: App über Chrome „Zum Startbildschirm hinzufügen“ und per HTTPS (Cloudflare) öffnen.'));
    return;
  }
  if (!push?.enabled) {
    box.replaceChildren(h('div', { class: 'muted' }, 'Push ist auf dem Server nicht eingerichtet (npm run setup).'));
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  let prefs = null;
  if (sub) {
    try { prefs = (await api('/api/push/prefs', { method: 'POST', body: { endpoint: sub.endpoint } })).prefs; } catch { /* egal */ }
    if (!prefs) {
      // Abo im Browser, aber nicht auf dem Server → neu anmelden
      try { await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs: {} } }); prefs = {}; } catch { /* egal */ }
    }
  }
  const topics = push.topics || {};
  const enabled = Boolean(sub);
  const toggle = switchEl({ checked: enabled, label: 'Benachrichtigungen auf diesem Gerät', onChange: async (on, input) => {
    input.disabled = true;
    try {
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Benachrichtigungen wurden im Browser nicht erlaubt');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.publicKey) });
        await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs: {} } });
        snackbar('Benachrichtigungen aktiviert');
      } else if (sub) {
        await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe();
        sub = null;
        snackbar('Benachrichtigungen deaktiviert');
      }
    } catch (e) {
      input.checked = !on;
      snackbar(e.message);
    } finally {
      input.disabled = false;
      paintPush(box);
    }
  } });
  const rows = enabled ? Object.entries(topics).map(([k, label]) => h('div', { class: 'row', style: { padding: '4px 0' } }, h('span', { class: 'grow' }, label), switchEl({ checked: prefs?.[k] !== false, label, onChange: async (on) => {
    prefs = { ...(prefs || {}), [k]: on };
    try { await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), prefs } }); } catch (e) { snackbar(e.message); }
  } }))) : [];
  box.replaceChildren(
    h('div', { class: 'row' }, icon('bell'), h('div', { class: 'grow' }, h('div', {}, 'Auf diesem Gerät'), h('div', { class: 'small muted' }, enabled ? 'Aktiv' : Notification.permission === 'denied' ? 'Im Browser blockiert' : 'Aus')), toggle),
    enabled ? h('div', { style: { 'margin-top': '8px' } }, ...rows) : null,
    enabled ? h('button', { class: 'btn text', onclick: async () => {
      try { await api('/api/push/test', { method: 'POST', body: { endpoint: sub.endpoint } }); snackbar('Test gesendet'); } catch (e) { snackbar(e.message); }
    } }, 'Test senden') : null);
}
