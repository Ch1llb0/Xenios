// Einstellungen dieses Geräts (localStorage): sichtbare Tabs, ausgeblendete Komponenten, Einschalten ohne Dampf.
// Ändert sich etwas, gibt es das Ereignis „xenios-prefs“ (Navigation und offene Seiten zeichnen sich neu).

function get(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function set(k, v) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* privat */ }
  window.dispatchEvent(new CustomEvent('xenios-prefs', { detail: k }));
}
function readSet(k) {
  try {
    const v = JSON.parse(get(k) || '[]');
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
}

// --- Tabs der unteren Leiste ---
export const hiddenTabs = () => readSet('navHidden');
export function setTabHidden(path, hidden) {
  const s = hiddenTabs();
  if (hidden) s.add(path); else s.delete(path);
  set('navHidden', JSON.stringify([...s]));
}

// --- Komponenten komplett ausblenden ---
export const COMPONENTS = [
  { id: 'grinder', title: 'Mühle', sub: 'Mühlen-Tab, Mühlen-Kacheln, Mahlvorgänge auf der Startseite' },
  { id: 'scale', title: 'Waage', sub: 'Gewicht und Bezugsgewichte der internen Waage' },
  { id: 'care', title: 'Pflege (Backflush)', sub: 'Backflush-Erinnerung und Pflege-Kachel' },
];
export const isHidden = (id) => readSet('hiddenComponents').has(id);
export function setComponentHidden(id, hidden) {
  const s = readSet('hiddenComponents');
  if (hidden) s.add(id); else s.delete(id);
  set('hiddenComponents', JSON.stringify([...s]));
}

// --- Einschalten ohne Dampfkessel (gilt für Startseite, Dashboard und App-Shortcut „Ein“) ---
export const noSteamOn = () => get('powerNoSteam') === '1';
export const setNoSteamOn = (on) => set('powerNoSteam', on ? '1' : null);

// Body für POST /api/machine/power zum Einschalten
export const powerOnBody = () => (noSteamOn() ? { mode: 'on', steam: false } : { mode: 'on' });

export function onPrefs(fn) {
  const h = (e) => fn(e.detail);
  window.addEventListener('xenios-prefs', h);
  return () => window.removeEventListener('xenios-prefs', h);
}
