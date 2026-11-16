// App-Start: Login, Navigation, Live-Verbindung, Service Worker, Shortcuts.
import { h, icon, snackbar } from './ui.js';
import { api, store, subscribe, connect, disconnect, setUnauthorizedHandler, refreshState, directMode, hasGrinder, hasPaddle } from './api.js';
import { dashboardView } from './views/dashboard.js';
import { scriptsView } from './views/scripts.js';
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
  { path: '/bezuege', label: 'Bezüge', icon: 'coffee', view: shotsView, title: 'Bezüge' },
  { path: '/skripte', label: 'Skripte', icon: 'list', view: scriptsView, title: 'Skripte' },
  { path: '/steuerung', label: 'Schalter', icon: 'toggle', view: controlsView, title: 'Schalter', feature: 'settings' },
  { path: '/paddle', label: 'Paddle', icon: 'speed', view: paddleView, title: 'Paddle', feature: 'paddle' },
  { path: '/timer', label: 'Timer', icon: 'event', view: timerView, title: 'Timer' },
  { path: '/muehle', label: 'Mühle', icon: 'grinder', view: grinderView, title: 'Mühle' },
  // Einstellungen: immer in der Leiste, lässt sich nicht ausblenden
  { path: '/einstellungen', label: 'Einstellungen', icon: 'settings', view: settingsView, title: 'Einstellungen', fixed: true },
  { path: '/einstellungen/maschine', label: 'Maschine', icon: 'settings', view: machineSettingsView, title: 'Maschinen-Einstellungen', nav: false, back: '/einstellungen' },
  { path: '/server', label: 'Server', icon: 'shield', view: serverView, title: 'Server- & App-Einstellungen', nav: false, back: '/einstellungen' },
];

const $ = (id) => document.getElementById(id);

// In der Android-App rückt die App selbst um Status- und Navigationsleiste ein. Ohne viewport-fit=cover rückt die
// WebView zusätzlich ein (doppelter Rand oben und unten). Im Browser bleibt es weg: dort führte es bei unten
// eingeblendeter Adressleiste zu einer Leerzeile unter den Tabs.
if (/XeniaApp\//.test(navigator.userAgent) || typeof window.XeniaApp === 'object') {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
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
  const palette = localStorageGet('uiStyle') === 'material' ? 'material' : 'xenia';
  if (palette === 'material') root.dataset.palette = 'material';
  else delete root.dataset.palette;
  // Anzeigen: Farbvorlage Xenia → Manometer (Zifferblatt schwarz/weiß), Material → flache Anzeigen (dunkel/hell).
  // Die Wahl hell/dunkel merkt sich jede Vorlage für sich (Material standardmäßig hell, Xenia schwarz).
  root.dataset.gauge = palette === 'material'
    ? (localStorageGet('gaugeStyleMaterial') === 'black' ? 'black' : 'white')
    : (localStorageGet('gaugeStyle') === 'white' ? 'white' : 'black');
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
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const bar = palette === 'material' ? (dark ? '#1b1b21' : '#2f3e74') : (dark ? '#2b2d34' : '#383c44');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bar));
}
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
  const inner = h('div', { class: `navbar-inner${routes.length > 5 ? ' many' : ''}${routes.length > 7 ? ' lots' : ''}` }, routes.map((r) =>
    h('button', { class: 'nav-item', dataset: { path: r.path }, onclick: () => navigate(r.path) },
      h('span', { class: 'pill' }, icon(r.icon)), h('span', { class: 'nav-label' }, r.label))));
  // Auf kleinen Bildschirmen nur Symbole: Name als Tooltip und für Screenreader
  inner.querySelectorAll('.nav-item').forEach((b, i) => { b.title = routes[i].label; b.setAttribute('aria-label', routes[i].label); });
  $('navbar').replaceChildren(inner);
  markNav();
}

// Aktiven Tab markieren: nach jedem Seitenwechsel UND nach jedem Neuaufbau der Leiste (Server-Zustand, Einstellungen)
function markNav() {
  const here = ROUTES.find((r) => r.path === location.pathname);
  const navPath = here?.navPath || here?.back || location.pathname;
  document.querySelectorAll('.nav-item').forEach((b) => (b.dataset.path === navPath ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
}

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
  $('back-btn').hidden = !route.back;
  $('back-btn').onclick = () => navigate(route.back);
  document.title = route.title === 'Xenios' ? 'Xenios' : `${route.title} · Xenios`;
  markNav();
  const view = $('view');
  view.replaceChildren();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  // Einblend-Animation bei jedem Seitenwechsel neu starten
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  current = { route, dispose: route.view(view) };
  if (restore) {
    // nach dem Aufbau (und noch einmal, wenn nachgeladene Inhalte die Seite verlängert haben)
    requestAnimationFrame(() => window.scrollTo(0, restore));
    setTimeout(() => { if (current?.route === route && window.scrollY < restore) window.scrollTo(0, restore); }, 350);
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
