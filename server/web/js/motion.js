// Nichts verschwindet ohne Animation: Ein- und Ausblenden über `el.hidden = …` und das Auf- und Zuklappen von
// <details> laufen animiert (Höhe und Deckkraft). Gilt für die ganze App, ohne jede Stelle einzeln anzupassen.
// Ohne Animation bleibt es, wenn das Element nicht im Dokument steht, gerade gar nicht sichtbar ist,
// in einem Bereich mit data-noanim liegt oder das System „Bewegung reduzieren“ verlangt.

const DUR = 200;
const EASE = 'cubic-bezier(.2, 0, 0, 1)';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const native = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');

function shown(el) {
  return el.isConnected && el.getClientRects().length > 0;
}

function skip(el) {
  // Seitenbereiche direkt im <body> (App, Anmeldung, Einrichtung) wechseln ohne Zusammenklappen.
  // Während eine Seite gerade einblendet, gilt der erste Zustand sofort (sonst springen Kacheln beim Aufbau).
  return reduced() || (enterView?.contains(el) && el !== enterView && performance.now() < enterSettle) || !el.isConnected || el.parentElement === document.body || el.closest?.('[data-noanim]') || typeof el.animate !== 'function';
}

const COLLAPSED = { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
function boxOf(el) {
  const cs = getComputedStyle(el);
  return { height: `${el.offsetHeight}px`, opacity: 1, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom };
}

function run(el, frames, done) {
  el.__anim?.cancel();
  const prevOverflow = el.style.overflow;
  el.style.overflow = 'hidden';
  const a = el.animate(frames, { duration: DUR, easing: EASE });
  el.__anim = a;
  const finish = () => {
    if (el.__anim !== a) return;
    el.__anim = null;
    el.style.overflow = prevOverflow;
    done?.();
  };
  a.onfinish = finish;
  a.oncancel = () => { if (el.__anim === a) el.__anim = null; el.style.overflow = prevOverflow; };
  return a;
}

// Ausblenden: erst zusammenklappen, dann wirklich verstecken. Der Getter liefert schon den Zielzustand.
function hide(el) {
  if (skip(el) || !shown(el)) { native.set.call(el, true); return; }
  el.__hideTarget = true;
  run(el, [boxOf(el), COLLAPSED], () => { el.__hideTarget = undefined; native.set.call(el, true); el.dispatchEvent(new Event('motionend')); });
}

// Einblenden: sichtbar machen und von Höhe 0 aufklappen
function show(el) {
  el.__hideTarget = undefined;
  el.__anim?.cancel();
  native.set.call(el, false);
  if (skip(el) || !shown(el)) return;
  run(el, [COLLAPSED, boxOf(el)], () => el.dispatchEvent(new Event('motionend')));
}

Object.defineProperty(HTMLElement.prototype, 'hidden', {
  configurable: true,
  enumerable: native.enumerable,
  get() {
    return this.__hideTarget ?? native.get.call(this);
  },
  set(v) {
    const want = Boolean(v);
    const pending = this.__hideTarget;
    if (pending === undefined && native.get.call(this) === want) return; // nichts zu tun (z. B. bei jeder Statusmeldung)
    if (pending === true && want) return; // klappt schon zu
    if (want) hide(this);
    else show(this);
  },
});

// Wartet, bis eine laufende Ein-/Ausblend-Animation fertig ist (für Code, der danach Größen misst)
export function afterMotion(el) {
  return el?.__anim ? el.__anim.finished.catch(() => {}) : Promise.resolve();
}

// <details>: Schließen animiert (der Browser schließt sonst sofort), Öffnen klappt auf
document.addEventListener('click', (e) => {
  const summary = e.target.closest?.('summary');
  const det = summary?.parentElement;
  if (!(det instanceof HTMLDetailsElement) || summary !== det.querySelector(':scope > summary') || reduced()) return;
  const body = [...det.children].filter((c) => c !== summary);
  if (!body.length) return;
  if (det.open) {
    e.preventDefault();
    if (det.__closing) return;
    det.__closing = true;
    let left = body.length;
    for (const c of body) {
      run(c, [boxOf(c), COLLAPSED], () => {
        if (--left === 0) {
          det.__closing = false;
          det.open = false;
        }
      });
    }
  } else {
    requestAnimationFrame(() => {
      for (const c of body) if (shown(c)) run(c, [COLLAPSED, boxOf(c)]);
    });
  }
}, true);

// Nachgeladene Inhalte einer Seite (Karten, Listen, Kacheln) blenden ebenso ein wie der erste Aufbau. Nur in der
// Ladephase kurz nach dem Seitenwechsel, damit laufende Aktualisierungen (Statuswerte) nicht ständig animieren.
const ENTER = '.card, .tile, .list, .list-item, .script-item, details.fold, .section-title, .empty, .offline-banner, .chips, .kv';
let enterView = null;
let enterUntil = 0;
let enterSettle = 0;
let enterDy = 24;
const observer = typeof MutationObserver === 'function' ? new MutationObserver((records) => {
  if (performance.now() > enterUntil || reduced()) return;
  let n = 0;
  for (const r of records) {
    for (const node of r.addedNodes) {
      if (!(node instanceof HTMLElement) || node.parentElement === enterView || !node.matches(ENTER)) continue;
      if (node.parentElement?.classList.contains('stagger')) continue; // blendet schon per CSS gestaffelt ein
      if (node.closest('[data-noanim]') || typeof node.animate !== 'function') continue;
      // nicht noch einmal, wenn ein umgebendes Element gerade selbst einblendet
      let p = node.parentElement, busy = false;
      while (p && p !== enterView) { if (p.__entering) { busy = true; break; } p = p.parentElement; }
      if (busy) continue;
      node.__entering = true;
      const a = node.animate([{ opacity: 0, transform: `translateY(${enterDy}px)` }, { transform: 'none' }], // Ziel: eigene Deckkraft
        { duration: 380, delay: Math.min(n++, 8) * 30, easing: 'cubic-bezier(.05, .7, .1, 1)', fill: 'backwards' });
      a.onfinish = a.oncancel = () => { node.__entering = false; };
    }
  }
}) : null;

// Sobald jemand tippt oder klickt, ist die Ladephase vorbei: was danach neu gezeichnet wird (z. B. Auswahlknöpfe),
// erscheint ohne Einflug-Animation
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { enterUntil = 0; enterSettle = 0; }, true);

// Beim Seitenwechsel aufrufen: fromAbove für die Seiten der unteren Leiste
export function pageEnter(view, fromAbove) {
  enterDy = fromAbove ? -18 : 24;
  view.classList.toggle('from-above', Boolean(fromAbove));
  enterSettle = performance.now() + 700;
  if (!observer) { enterView = view; return; }
  if (enterView !== view) { observer.disconnect(); observer.observe(view, { childList: true, subtree: true }); enterView = view; }
  enterUntil = performance.now() + 2500;
}
