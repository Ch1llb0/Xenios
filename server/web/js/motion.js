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
  // Seitenbereiche direkt im <body> (App, Anmeldung, Einrichtung) wechseln ohne Zusammenklappen
  return reduced() || !el.isConnected || el.parentElement === document.body || el.closest?.('[data-noanim]') || typeof el.animate !== 'function';
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
