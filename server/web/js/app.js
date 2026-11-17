import { pageEnter } from './motion.js'; // zuerst: animiertes Ein- und Ausblenden für die ganze App
// App-Start: Login, Navigation, Live-Verbindung, Service Worker, Shortcuts.
import { h, icon, snackbar, closeTopOverlay } from './ui.js';
import { api, store, subscribe, connect, disconnect, setUnauthorizedHandler, refreshState, directMode, hasGrinder, hasPaddle } from './api.js';
import { dashboardView } from './views/dashboard.js';
import { scriptsView, scriptNewView, scriptEditView, profileBuilderView, discoverView } from './views/scripts.js';
import { controlsView, paddleView } from './views/controls.js';
import { shotsView } from './views/shots.js';
import { timerView } from './views/timer.js';
import { grinderView } from './views/grinder.js';
import { settingsView, machineSettingsView } from './views/settings.js';
import { serverView } from './views/server.js';
import { showSetup } from './setup.js';
import { quickRate } from './views/shot-detail.js';
import { hiddenTabs, onPrefs, powerOnBody } from './prefs.js';

const ROUTES = [
  // Home ist das Dashboard (frühere eigene Startseite entfällt; /dashboard leitet hierher)
  { path: '/', label: 'Home', icon: 'home', view: dashboardView, title: 'Xenios', wide: true },
  { path: '/bezuege', label: 'Bezüge', icon: 'coffeeLine', view: shotsView, title: 'Bezüge' },
  { path: '/skripte', label: 'Skripte', icon: 'list', view: scriptsView, title: 'Skripte' },
  { path: '/steuerung', label: 'Schalter', icon: 'toggleTile', view: controlsView, title: 'Schalter', feature: 'settings' },
  { path: '/paddle', label: 'Paddle', icon: 'speed', view: paddleView, title: 'Paddle', feature: 'paddle' },
  { path: '/timer', label: 'Timer', icon: 'event', view: timerView, title: 'Timer' },
  { path: '/muehle', label: 'Mühle', icon: 'grinder', view: grinderView, title: 'Mühle' },
  // Einstellungen: immer in der Leiste, lässt sich nicht ausblenden
  { path: '/einstellungen', label: 'Einstellungen', icon: 'settings', view: settingsView, title: 'Einstellungen', fixed: true },
  { path: '/einstellungen/maschine', label: 'Maschine', icon: 'settings', view: machineSettingsView, title: 'Maschinen-Einstellungen', nav: false, back: '/einstellungen' },
  { path: '/skripte/neu', label: 'Skript erstellen', icon: 'add', view: scriptNewView, title: 'Skript erstellen', nav: false, back: '/skripte' },
  { path: '/skripte/bearbeiten', label: 'Skript bearbeiten', icon: 'edit', view: scriptEditView, title: 'Skript bearbeiten', nav: false, back: '/skripte' },
  { path: '/skripte/profil', label: 'Druckprofil erstellen', icon: 'profile', view: profileBuilderView, title: 'Druckprofil erstellen', nav: false, back: '/skripte' },
  { path: '/skripte/entdecken', label: 'Profile entdecken', icon: 'explore', view: discoverView, title: 'Profile entdecken', nav: false, back: '/skripte' },
  { path: '/server', label: 'Server', icon: 'shield', view: serverView, title: 'Server- & App-Einstellungen', nav: false, back: '/einstellungen' },
];

const $ = (id) => document.getElementById(id);

let current = null;      // { route, dispose }

// --- Darstellung --------------------------------------------------------------
// Stil „xenia“ (Standard, wie die Web-Oberfläche der Maschine) oder „material“; dazu optional eigene Akzent- und Aktiv-Farbe.
// Design (Layout, Schrift, Icons, Navigation) ist immer das der Xenia. Einstellbar sind nur Farben:
// Farbvorlage (xenia/material), eigene Akzent-/Aktiv-Farbe, Hell/Dunkel und das Zifferblatt der Manometer.
export const THEME_DEFAULTS = { palette: 'xenia', gauge: 'black', accent: { xenia: '#4f9a1c', material: '#4a5891' }, active: { xenia: '#f5862f', material: '#5c6bc0' } };
export function applyTheme(theme = localStorageGet('theme') || 'system') {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  root.dataset.style = 'xenia';
  const palette = uiPalette();
  if (palette === 'material') root.dataset.palette = 'material';
  else delete root.dataset.palette;
  // Anzeigen: Farbvorlage Xenia → Manometer, Material → flache Anzeigen. Hell oder dunkel merkt sich jede Vorlage
  // für sich; ohne eigene Wahl folgen sie der Helligkeit (helle Ansicht → helle Anzeigen, dunkle → dunkle).
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.gauge = gaugeChoice(palette) || (dark ? 'black' : 'white');
  const setColor = (name, onName, value, extra) => {
    if (!value) {
      for (const n of [name, onName, ...Object.keys(extra || {})]) root.style.removeProperty(n);
      return;
    }
    root.style.setProperty(name, value);
    root.style.setProperty(onName, contrastOn(value));
    for (const [n, v] of Object.entries(extra || {})) root.style.setProperty(n, v);
  };
  const accent = localStorageGet('accent');
  setColor('--primary', '--on-primary', accent, accent ? {
    '--primary-container': `color-mix(in srgb, ${accent} 18%, var(--surface-container-lowest))`,
    '--on-primary-container': `color-mix(in srgb, ${accent} 70%, var(--on-surface))`,
    '--success': accent,
  } : null);
  setColor('--active', '--on-active', localStorageGet('activeColor'));
  const bar = palette === 'material' ? (dark ? '#1b1b21' : '#2f3e74') : (dark ? '#2b2d34' : '#383c44');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bar));
  syncAppBars();
}

// Android-App: Zoom sperren (im Browser bleibt Zoomen erlaubt)
if (/XeniaApp\//.test(navigator.userAgent)) {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  document.documentElement.classList.add('in-app');
  // Strg/Cmd + Plus/Minus/0 und Strg + Mausrad (Tastatur oder Maus am Handy/Tablet)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(e.key)) e.preventDefault();
  }, { capture: true });
  window.addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, { capture: true, passive: false });
}

// Farbvorlage: Material ist Standard
export function uiPalette() {
  return localStorageGet('uiStyle') === 'xenia' ? 'xenia' : 'material';
}
// Eigene Wahl der Anzeigen je Vorlage ('white' | 'black') oder null = folgt der Helligkeit
export const gaugeKey = (palette) => (palette === 'material' ? 'gaugeStyleMaterial' : 'gaugeStyle');
export function gaugeChoice(palette) {
  const v = localStorageGet(gaugeKey(palette));
  return v === 'white' || v === 'black' ? v : null;
}

// Systemleisten in den Farben der Seite: im Browser die Adressleiste (theme-color) wie die Kopfzeile,
// in der Android-App zusätzlich die Navigationsleiste wie die untere Leiste
let barsTimer = 0;
export function syncAppBars() {
  const send = () => {
    const color = (el) => {
      const m = el && /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
      if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
      return '#' + [m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('');
    };
    const page = color(document.body) || color(document.documentElement) || '#ffffff';
    const nav = document.querySelector('.navbar');
    const r = nav?.getBoundingClientRect();
    const navAtBottom = r && r.width >= window.innerWidth - 2 && Math.abs(r.bottom - window.innerHeight) < 3; // breite Xenia-Ansicht: Leiste links
    const top = color(document.querySelector('.topbar')) || page;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', top));
    if (typeof window.XeniaApp?.setBars !== 'function') return;
    try { window.XeniaApp.setBars(top, (navAtBottom && color(nav)) || page); } catch { /* ältere App */ }
  };
  requestAnimationFrame(send);
  clearTimeout(barsTimer);
  barsTimer = setTimeout(send, 400); // nach dem Farbübergang der Seite (0,3 s)
}
window.addEventListener('resize', () => syncAppBars());
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme());
// Schrift auf einer Farbfläche: schwarz oder weiß, je nach Helligkeit
export function contrastOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111111' : '#ffffff';
}
export function localStorageGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* privat */ }
}
// Einmalig (2.10.5): neue Standards übernehmen – Material, Anzeigen folgen der Helligkeit
if (localStorageGet('themeDefaults') !== '2') {
  for (const k of ['uiStyle', 'gaugeStyle', 'gaugeStyleMaterial']) { try { localStorage.removeItem(k); } catch { /* privat */ } }
  localStorageSet('themeDefaults', '2');
}
applyTheme();

// --- Navigation ---------------------------------------------------------------
// Alle Seiten, die in die untere Leiste können (die Mühle nur, wenn eingerichtet und nicht ausgeblendet)
// Ausgeschaltete Funktionen (Einstellungen → Komponenten & Funktionen) blenden ihre Seiten aus: Paddle ohne
// Pumpensteuerung, Schalter (Tastenbelegung) ohne „Maschinen-Einstellungen ändern“.
export function routeAvailable(r) {
  if (r.path === '/muehle' && !hasGrinder()) return false;
  if (r.feature && store.server?.features?.[r.feature] === false) return false;
  if (r.path === '/paddle' && store.machine?.info && !hasPaddle()) return false; // erst entscheiden, wenn die Firmware bekannt ist
  return true;
}
export function navChoices() {
  return ROUTES.filter((r) => r.nav !== false && routeAvailable(r));
}

// Sichtbare Tabs: ohne die in den Einstellungen ausgeblendeten; „Einstellungen“ bleibt immer stehen
function navRoutes() {
  const hidden = hiddenTabs();
  return navChoices().filter((r) => r.fixed || !hidden.has(r.path));
}

function buildNav() {
  $('back-btn').replaceChildren(icon('left'));
  const routes = navRoutes();
  const cls = `navbar-inner${routes.length > 5 ? ' many' : ''}${routes.length > 7 ? ' lots' : ''}`;
  // Auf kleinen Bildschirmen nur Symbole: Name als Tooltip und für Screenreader
  const make = (r) => h('button', { class: 'nav-item', dataset: { path: r.path }, title: r.label, 'aria-label': r.label, onclick: () => navigate(r.path) },
    h('span', { class: 'pill' }, icon(r.icon)), h('span', { class: 'nav-label' }, r.label));
  const old = $('navbar').querySelector('.navbar-inner');
  if (!old || !old.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('navbar').replaceChildren(h('div', { class: cls }, routes.map(make)));
    markNav();
    return;
  }
  // Leiste bleibt stehen: wegfallende Einträge schrumpfen weg, neue wachsen hinein, die übrigen rücken mit
  old.className = cls;
  const vertical = getComputedStyle(old).flexDirection.startsWith('column'); // linke Navigationsliste (breite Xenia-Ansicht)
  const prop = vertical ? 'maxHeight' : 'maxWidth';
  // Größe samt Innenabstand: sonst bleibt der Eintrag beim Schrumpfen am Innenabstand hängen und springt dann
  const pads = vertical ? ['paddingTop', 'paddingBottom'] : ['paddingLeft', 'paddingRight'];
  const minProp = vertical ? 'minHeight' : 'minWidth';
  const full = (b) => {
    const cs = getComputedStyle(b);
    return { [prop]: `${vertical ? b.offsetHeight : b.offsetWidth}px`, [pads[0]]: cs[pads[0]], [pads[1]]: cs[pads[1]], [minProp]: '0px', boxSizing: 'border-box' };
  };
  const none = { [prop]: '0px', [pads[0]]: '0px', [pads[1]]: '0px', [minProp]: '0px', boxSizing: 'border-box' };
  const ease = { duration: 280, easing: 'cubic-bezier(.2, 0, 0, 1)' };
  const keep = new Map([...old.children].filter((b) => !b.__leaving).map((b) => [b.dataset.path, b]));
  const want = new Set(routes.map((r) => r.path));
  for (const [path, b] of keep) {
    if (want.has(path)) continue;
    b.__leaving = true;
    b.style.pointerEvents = 'none';
    b.style.overflow = 'hidden';
    const a = b.animate([{ ...full(b), opacity: 1 }, { ...none, opacity: 0, transform: vertical ? 'translateX(-12px)' : 'translateY(12px)' }], { ...ease, fill: 'forwards' });
    a.onfinish = () => b.remove();
  }
  // Bleibende Einträge nicht umstellen (sonst wandert ein wegfallender ans Ende); neue vor dem nächsten bleibenden einfügen
  routes.forEach((r, i) => {
    if (keep.has(r.path)) return;
    const b = make(r);
    const next = routes.slice(i + 1).map((x) => keep.get(x.path)).find(Boolean);
    old.insertBefore(b, next || null);
    b.style.overflow = 'hidden';
    const a = b.animate([{ ...none, opacity: 0, transform: vertical ? 'translateX(-12px)' : 'translateY(12px)' }, { ...full(b), opacity: 1 }], ease);
    a.onfinish = () => { b.style.overflow = ''; };
  });
  markNav();
}

// Aktiven Tab markieren: nach jedem Seitenwechsel UND nach jedem Neuaufbau der Leiste (Server-Zustand, Einstellungen)
function markNav() {
  syncAppBars();
  const here = ROUTES.find((r) => r.path === location.pathname);
  const navPath = here?.navPath || here?.back || location.pathname;
  document.querySelectorAll('.nav-item').forEach((b) => (b.dataset.path === navPath ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

// Zurück-Taste der Android-App: offenes Fenster schließen → Unterseite → übergeordnete Seite → Home.
// true = erledigt; false = schon auf Home (die App geht dann in den Hintergrund).
window.xeniosBack = () => {
  if (closeTopOverlay()) return true;
  const route = current?.route;
  if (route?.back) { navigate(route.back, { replace: true }); return true; }
  if (location.pathname !== '/') { navigate('/', { replace: true }); return true; }
  return false;
};

export function navigate(path, { replace = false } = {}) {
  if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}

export function setTopActions(...nodes) {
  $('topbar-actions').replaceChildren(...nodes.filter(Boolean));
}
export function setTabs(tabs, active, onSelect) {
  const el = $('tabs');
  if (!tabs) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.replaceChildren(...tabs.map((t) => h('button', { class: 'tab', role: 'tab', 'aria-selected': String(t.id === active), onclick: () => onSelect(t.id) }, t.label)));
}

function render() {
  if (location.pathname === '/dashboard') return navigate('/', { replace: true });
  const want = ROUTES.find((r) => r.path === location.pathname);
  if (want && !routeAvailable(want)) return navigate('/', { replace: true });
  const route = ROUTES.find((r) => r.path === location.pathname) || ROUTES.find((r) => r.path === '/');
  // Scrollposition einer Seite merken, wenn man in eine ihrer Unterseiten wechselt (z. B. Einstellungen → Server)
  const prev = current?.route;
  if (prev && route.back === prev.path) scrollMemory.set(prev.path, window.scrollY);
  const restore = prev && prev.back === route.path ? scrollMemory.get(route.path) : null;
  current?.dispose?.();
  $('app').classList.toggle('wide', Boolean(route.wide));
  setTopActions();
  setTabs(null);
  $('title').textContent = route.title;
  // Zurück-Pfeil weich ein-/ausblenden (Breite), damit der Titel nicht springt
  $('back-btn').classList.toggle('gone', !route.back);
  $('back-btn').onclick = () => navigate(route.back);
  document.title = route.title === 'Xenios' ? 'Xenios' : `${route.title} · Xenios`;
  markNav();
  const view = $('view');
  view.replaceChildren();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  // Einblend-Animation bei jedem Seitenwechsel neu starten
  view.classList.remove('enter');
  pageEnter(view, !route.back);
  void view.offsetWidth;
  view.classList.add('enter');
  current = { route, dispose: route.view(view) };
  if (restore) {
    // Sofort an die alte Stelle, noch vor dem ersten Bild: die Seite bekommt vorübergehend genug Höhe, auch wenn ihre
    // Inhalte erst nachladen (sonst stünde sie kurz oben und spränge dann nach unten)
    view.style.minHeight = `${restore + window.innerHeight}px`;
    window.scrollTo(0, restore);
    setTimeout(() => { if (current?.route === route) view.style.minHeight = ''; }, 1500);
  } else {
    view.style.minHeight = '';
  }
}
const scrollMemory = new Map();

// Aufgeklappte Kategorie (details.fold): passt sie unterhalb ihres Kopfes nicht mehr auf den Bildschirm, so weit
// hochscrollen, dass der Kopf direkt unter der Kopfleiste steht. Nachgeladener Inhalt wird kurz danach berücksichtigt.
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('fold') || !d.open) return;
  const fit = () => {
    const top = (document.querySelector('.topbar')?.getBoundingClientRect().bottom || 64) + 8;
    const nav = $('navbar').getBoundingClientRect();
    const bottom = nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight;
    const r = d.getBoundingClientRect();
    if (r.bottom > bottom && r.top > top) window.scrollBy({ top: Math.min(r.top - top, r.bottom - bottom), behavior: 'smooth' });
  };
  requestAnimationFrame(fit);
  setTimeout(fit, 450);
}, true);
window.addEventListener('popstate', render);

// Leiste neu aufbauen, sobald sich die verfügbaren Seiten ändern (Funktionen, Mühle, Firmware der Maschine erkannt)
let navSig = '';
subscribe(() => {
  if (!window.__authed) return;
  const sig = navChoices().map((r) => r.path).join();
  if (sig === navSig) return;
  navSig = sig;
  buildNav();
});
onPrefs(() => {
  if (!window.__authed) return;
  buildNav();
});

// Verbindungspunkt oben rechts
subscribe(() => {
  const dot = $('conn-dot');
  const m = store.machine;
  dot.className = 'conn-dot ' + (!store.connected ? 'bad' : m && !m.online ? 'warn' : 'ok');
  dot.title = !store.connected ? 'Keine Verbindung zum Server' : m && !m.online ? 'Maschine nicht erreichbar' : 'Verbunden';
});

// Ereignisse aus dem Server als Snackbar; nach einem Bezug mit „Bewerten“ (Einstell-Assistent)
subscribe((part, ev) => {
  if (part !== 'event' || !ev || ev.topic === 'grinder') return;
  if (ev.topic === 'shot' && ev.shotId) snackbar(`${ev.title} – ${ev.body}`, { action: 'Bewerten', onAction: () => quickRate(ev.shotId), duration: 15000 });
  else snackbar(`${ev.title} – ${ev.body}`);
});

// --- Login --------------------------------------------------------------------
// In der Android-App (WebView mit Brücke „XeniaApp“) meldet sich die App selbst an; dort deren Anmeldung öffnen.
export const inAndroidApp = () => typeof window.XeniaApp?.reauth === 'function';

function showLogin({ offline = false } = {}) {
  window.__authed = false;
  disconnect();
  if (inAndroidApp() && !offline) {
    window.XeniaApp.reauth();
    return;
  }
  $('app').hidden = true;
  $('setup').hidden = true;
  $('login').hidden = false;
  $('splash').classList.add('hide');
  setTimeout(() => $('login-password').focus(), 50);
}

function showSetupScreen() {
  window.__authed = false;
  $('app').hidden = true;
  $('login').hidden = true;
  $('setup').hidden = false;
  $('splash').classList.add('hide');
  showSetup($('setup'), { onDone: () => { $('setup').hidden = true; showApp(); } });
}

async function showApp() {
  window.__authed = true;
  $('login').hidden = true;
  $('app').hidden = false;
  buildNav();
  // Erst den Zustand (u. a. Server-Features) holen, sonst fehlen beim direkten Aufruf einer Seite Bedienelemente
  await refreshState().catch(() => {});
  render();
  connect();
  $('splash').classList.add('hide');
  handleShortcut();
}

setUnauthorizedHandler(() => showLogin());

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('login-submit');
  const err = $('login-error');
  err.textContent = '';
  btn.disabled = true;
  try {
    await api('/auth/login', { method: 'POST', body: { password: $('login-password').value, remember: $('login-remember').checked } });
    $('login-password').value = '';
    showApp();
  } catch (ex) {
    err.textContent = ex.message;
    $('login-form').classList.remove('shake');
    void $('login-form').offsetWidth;
    $('login-form').classList.add('shake');
  } finally {
    btn.disabled = false;
  }
});

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  showLogin();
}

// --- App-Shortcuts (Langdruck auf das App-Symbol) ------------------------------
async function handleShortcut() {
  const params = new URLSearchParams(location.search);
  const action = params.get('do');
  if (!action) return;
  history.replaceState({}, '', location.pathname);
  try {
    if (action === 'on') {
      const body = powerOnBody();
      await api('/api/machine/power', { method: 'POST', body });
      snackbar(body.steam === false ? 'Xenia wird ohne Dampf eingeschaltet …' : 'Xenia wird eingeschaltet …');
    } else if (action === 'on-nosteam') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'on', steam: false } });
      snackbar('Xenia wird ohne Dampf eingeschaltet …');
    } else if (action === 'off') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'off' } });
      snackbar('Xenia ausgeschaltet');
    } else if (action === 'eco') {
      await api('/api/machine/power', { method: 'POST', body: { mode: 'eco' } });
      snackbar('Eco-Modus aktiv');
    } else if (action === 'steam') {
      await api('/api/machine/steam', { method: 'POST', body: { on: true } });
      snackbar('Dampfkessel an');
    }
  } catch (ex) {
    snackbar(ex.message);
  }
}

// --- Service Worker (Offline-Hülle, Push) --------------------------------------
window.addEventListener('xenia-error', (e) => snackbar(e.detail));

// Kein Service Worker im Direkt-Modus der App (Dateien kommen aus der APK)
if ('serviceWorker' in navigator && !directMode) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.path) navigate(e.data.path);
  });
}

// --- Start ------------------------------------------------------------------------
(async () => {
  try {
    const s = await api('/auth/session');
    if (s.authenticated) await showApp();
    else if (s.setup) showSetupScreen();
    else showLogin();
    // Notbetrieb der Android-App: Server weg, die App spricht die Maschine direkt an
    if (window.XeniaApp?.fallback?.()) {
      snackbar('Server nicht erreichbar – direkt mit der Maschine verbunden', { action: 'Server', onAction: () => window.XeniaApp.retryServer(), duration: 10000 });
    }
  } catch {
    // Offline: App-Hülle zeigen, Verbindung wird erneut versucht
    showLogin({ offline: true });
    $('login-error').textContent = 'Server nicht erreichbar.';
  }
})();
