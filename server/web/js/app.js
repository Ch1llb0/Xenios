// App-Start: Login, Navigation, Live-Verbindung, Service Worker, Shortcuts.
import { h, icon, snackbar } from './ui.js';
import { api, store, subscribe, connect, disconnect, setUnauthorizedHandler, refreshState, directMode, hasGrinder } from './api.js';
import { homeView } from './views/home.js';
import { dashboardView } from './views/dashboard.js';
import { scriptsView } from './views/scripts.js';
import { controlsView, paddleView } from './views/controls.js';
import { shotsView } from './views/shots.js';
import { timerView } from './views/timer.js';
import { grinderView } from './views/grinder.js';
import { settingsView } from './views/settings.js';
import { serverView } from './views/server.js';
import { showSetup } from './setup.js';
import { quickRate } from './views/shot-detail.js';
import { hiddenTabs, onPrefs, powerOnBody } from './prefs.js';

const ROUTES = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard', view: dashboardView, title: 'Dashboard', wide: true },
  { path: '/', label: 'Home', icon: 'home', view: homeView, title: 'Xenios' },
  { path: '/bezuege', label: 'Bezüge', icon: 'coffee', view: shotsView, title: 'Bezüge' },
  { path: '/skripte', label: 'Skripte', icon: 'list', view: scriptsView, title: 'Skripte' },
  { path: '/steuerung', label: 'Schalter', icon: 'toggle', view: controlsView, title: 'Schalter' },
  { path: '/paddle', label: 'Paddle', icon: 'speed', view: paddleView, title: 'Paddle' },
  { path: '/timer', label: 'Timer', icon: 'event', view: timerView, title: 'Timer' },
  { path: '/muehle', label: 'Mühle', icon: 'grinder', view: grinderView, title: 'Mühle' },
  // Einstellungen: immer in der Leiste, lässt sich nicht ausblenden
  { path: '/einstellungen', label: 'Einstellungen', icon: 'settings', view: settingsView, title: 'Einstellungen', fixed: true },
  { path: '/server', label: 'Server', icon: 'shield', view: serverView, title: 'Server & Sicherheit', nav: false, back: '/einstellungen' },
];

const $ = (id) => document.getElementById(id);
let current = null;      // { route, dispose }

// --- Darstellung --------------------------------------------------------------
// Stil „xenia“ (Standard, wie die Web-Oberfläche der Maschine) oder „material“; dazu optional eigene Akzent- und Aktiv-Farbe.
export const THEME_DEFAULTS = { style: 'xenia', accent: { xenia: '#4f9a1c', material: '#4a5891' }, active: { xenia: '#f5862f', material: '#4a5891' } };
export function applyTheme(theme = localStorageGet('theme') || 'system') {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const style = localStorageGet('uiStyle') || THEME_DEFAULTS.style;
  root.dataset.style = style;
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
  const bar = style === 'xenia' ? (dark ? '#2b2d34' : '#3b3e47') : (dark ? '#121318' : '#fbf8ff');
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
export function navChoices() {
  return ROUTES.filter((r) => r.nav !== false && (r.path !== '/muehle' || hasGrinder()));
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
  $('navbar').replaceChildren(inner);
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
  if (location.pathname === '/muehle' && !hasGrinder()) return navigate('/', { replace: true });
  const route = ROUTES.find((r) => r.path === location.pathname) || ROUTES.find((r) => r.path === '/');
  current?.dispose?.();
  $('app').classList.toggle('wide', Boolean(route.wide));
  setTopActions();
  setTabs(null);
  $('title').textContent = route.title;
  $('back-btn').hidden = !route.back;
  $('back-btn').onclick = () => navigate(route.back);
  document.title = route.title === 'Xenios' ? 'Xenios' : `${route.title} · Xenios`;
  const navPath = route.path === '/server' ? '/einstellungen' : route.path;
  document.querySelectorAll('.nav-item').forEach((b) => (b.dataset.path === navPath ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  const view = $('view');
  view.replaceChildren();
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  // Einblend-Animation bei jedem Seitenwechsel neu starten
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
  current = { route, dispose: route.view(view) };
}
window.addEventListener('popstate', render);

subscribe((part) => {
  if (part === 'server' || part === 'all') buildNav();
});
onPrefs(() => {
  if (!window.__authed) return;
  buildNav();
  document.querySelectorAll('.nav-item').forEach((b) => (b.dataset.path === location.pathname ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
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
  if (location.pathname === '/' && !location.search && localStorageGet('startPage') === '/dashboard') history.replaceState({}, '', '/dashboard');
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
