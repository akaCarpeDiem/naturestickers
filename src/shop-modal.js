// /shop — expanded sticker view. Opens in place over the grid (no navigation),
// animates from the tile, and is shareable via #<state> / #<state>-stained-glass.
import { escapeHtml, money } from './cart-ui.js';
import info from './data/state-info.json';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSheet = () => window.matchMedia('(max-width: 600px)').matches;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} opts
 * @param {() => any[]} opts.getItems   current catalog items (parsed products)
 * @param {(it: any) => string} opts.artKey
 * @param {(s: string) => string} opts.slug
 * @param {(it: any, btn: HTMLButtonElement) => void} opts.onAdd
 */
export function createModal({ getItems, artKey, slug, onAdd }) {
  const root = document.createElement('div');
  root.className = 'sx-modal';
  root.hidden = true;
  root.innerHTML = `
    <div class="sx-modal-backdrop" data-close></div>
    <div class="sx-dialog" role="dialog" aria-modal="true" aria-labelledby="sx-d-title" aria-describedby="sx-d-blurb" tabindex="-1">
      <button type="button" class="sx-close" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <div class="sx-d-scroll">
        <figure class="sx-d-art"><img alt="" width="1400" height="473" decoding="async" /></figure>
        <div class="sx-d-body">
          <div class="sx-d-head">
            <div>
              <h2 class="sx-d-title" id="sx-d-title"></h2>
              <p class="sx-d-style"></p>
            </div>
            <span class="sx-d-price"></span>
          </div>
          <div class="sx-d-toggle" hidden>
            <span class="sx-label" id="sx-d-toggle-label">Style</span>
            <div class="seg sx-d-seg" role="radiogroup" aria-labelledby="sx-d-toggle-label"></div>
          </div>
          <div class="sx-d-buy">
            <span class="state-badge sx-d-size"></span>
            <button type="button" class="btn btn-primary sx-add sx-d-add">Add to cart</button>
          </div>
          <p class="sx-d-blurb" id="sx-d-blurb"></p>
          <section class="sx-d-letters" aria-labelledby="sx-d-letters-h" hidden>
            <h3 id="sx-d-letters-h" class="sx-label">In every letter</h3>
            <div class="sx-d-cols"></div>
          </section>
        </div>
      </div>
    </div>`;
  document.body.appendChild(root);

  const dialog = root.querySelector('.sx-dialog');
  const img = root.querySelector('.sx-d-art img');
  const figure = root.querySelector('.sx-d-art');
  const titleEl = root.querySelector('.sx-d-title');
  const styleEl = root.querySelector('.sx-d-style');
  const priceEl = root.querySelector('.sx-d-price');
  const sizeEl = root.querySelector('.sx-d-size');
  const addBtn = root.querySelector('.sx-d-add');
  const toggle = root.querySelector('.sx-d-toggle');
  const seg = root.querySelector('.sx-d-seg');
  const blurbEl = root.querySelector('.sx-d-blurb');
  const lettersSec = root.querySelector('.sx-d-letters');
  const lettersCols = root.querySelector('.sx-d-cols');

  let current = null; // item shown
  let opener = null; // element to return focus to
  let sourceEl = null; // tile art to animate from/to
  let scrollY = 0;
  let closing = false;

  const groupKey = (it) => [slug(it.state), it.edition ? slug(it.edition) : ''].filter(Boolean).join('-');
  const same = (a, b) => !!a && !!b && String(a.v.sync_variant_id) === String(b.v.sync_variant_id);
  const siblings = (it) => getItems().filter((x) => groupKey(x) === groupKey(it));
  const hashFor = (it) => {
    const sib = siblings(it);
    // The first style (Real Photo) owns the bare #state hash; other styles add their key.
    return same(sib[0], it) || it.styleKey === 'real-photo' ? groupKey(it) : `${groupKey(it)}-${it.styleKey}`;
  };

  function show(it) {
    current = it;
    const title = `${it.state}${it.edition ? ` (${it.edition})` : ''}`;
    titleEl.textContent = title;
    styleEl.textContent = it.style;
    priceEl.textContent = money(it.v.retail_price);
    sizeEl.textContent = it.v?.size || '';
    sizeEl.hidden = !it.v?.size;
    addBtn.dataset.id = it.v.sync_variant_id;
    addBtn.classList.remove('is-added');
    addBtn.innerHTML = `Add to cart<span class="sr-only"> — ${escapeHtml(`${title}, ${it.style}`)}</span>`;

    const key = artKey(it);
    figure.classList.remove('is-mockup');
    delete img.dataset.fellBack;
    img.dataset.fallback = it.thumb || '';
    img.src = `/stickers/all/${key}-1400.webp`;
    img.alt = `${title} sticker, ${it.style}: each letter frames a ${it.state} landscape`;

    const sib = siblings(it);
    toggle.hidden = sib.length < 2;
    seg.innerHTML = sib
      .map((s) => `<button type="button" class="seg-btn" role="radio" aria-checked="${same(s, it)}" tabindex="${same(s, it) ? 0 : -1}" data-id="${s.v.sync_variant_id}">${escapeHtml(s.style)}</button>`)
      .join('');
    // Warm the other style's art so toggling is instant.
    sib.filter((s) => !same(s, it)).forEach((s) => { const i = new Image(); i.src = `/stickers/all/${artKey(s)}-1400.webp`; });

    // Edition-specific records (e.g. new-york-stacked) override the state's own entry; the blurb falls back to the state.
    const data = { ...(info[slug(it.state)] || {}), ...(info[groupKey(it)] || {}) };
    blurbEl.textContent = data.blurb || '';
    blurbEl.hidden = !data.blurb;
    const letters = Array.isArray(data.letters) ? data.letters.filter((l) => l && l.letter && l.place) : [];
    lettersSec.hidden = letters.length === 0;
    // One column per word of the state name (North Carolina → NORTH | CAROLINA); one-word states stay one column.
    const words = it.state.toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z]/g, '')).filter(Boolean);
    const groups = [];
    let at = 0;
    for (const w of words) { groups.push(letters.slice(at, at + w.length)); at += w.length; }
    if (at !== letters.length || groups.length > 2) groups.splice(0, groups.length, letters); // unexpected shape: one list
    lettersCols.classList.toggle('is-two', groups.length === 2);
    const line = (l) => {
      const full = `${l.letter}: ${l.place}${l.area ? ` — ${l.area}` : ''}`;
      return `
        <li title="${escapeHtml(full)}">
          <span class="sx-d-letter" aria-hidden="true">${escapeHtml(l.letter)}</span>
          <span class="sx-d-line"><span class="sr-only">${escapeHtml(l.letter)}: </span><span class="sx-d-place">${escapeHtml(l.place)}</span>${l.area ? `<span class="sx-d-area"><span aria-hidden="true"> · </span><span class="sr-only">, </span>${escapeHtml(l.area)}</span>` : ''}</span>
        </li>`;
    };
    lettersCols.innerHTML = groups
      .map((g, i) => `<ol class="sx-d-list"${groups.length === 2 ? ` aria-label="${escapeHtml(words[i])}"` : ''}>${g.map(line).join('')}</ol>`)
      .join('');
  }

  img.addEventListener('error', () => {
    if (!img.dataset.fallback || img.dataset.fellBack) return;
    img.dataset.fellBack = '1';
    figure.classList.add('is-mockup');
    img.src = img.dataset.fallback;
  });

  function setHash(it) {
    const url = `${location.pathname}${location.search}${it ? `#${hashFor(it)}` : ''}`;
    history.replaceState(null, '', url);
  }

  function lockScroll(on) {
    const others = [...document.body.children].filter((el) => el !== root && el.tagName !== 'SCRIPT');
    if (on) {
      scrollY = window.scrollY;
      const sbw = window.innerWidth - document.documentElement.clientWidth;
      document.documentElement.classList.add('sx-locked');
      document.body.style.paddingRight = sbw ? `${sbw}px` : '';
      others.forEach((el) => { if (!el.inert) { el.inert = true; el.dataset.sxInert = '1'; } });
    } else {
      document.documentElement.classList.remove('sx-locked');
      document.body.style.paddingRight = '';
      others.forEach((el) => { if (el.dataset.sxInert) { el.inert = false; delete el.dataset.sxInert; } });
      if (Math.abs(window.scrollY - scrollY) > 2) window.scrollTo(0, scrollY);
    }
  }

  /** FLIP: transform from the tile's art box to the dialog's art box. */
  function flipFrames(fromEl) {
    if (!fromEl || !fromEl.isConnected) return null;
    const a = fromEl.getBoundingClientRect();
    const b = figure.getBoundingClientRect();
    if (!a.width || !b.width || a.bottom < 0 || a.top > innerHeight) return null;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const s = Math.max(0.2, Math.min(a.width / b.width, 1));
    return [`translate(${dx}px, ${dy}px) scale(${s})`, 'translate(0, 0) scale(1)'];
  }

  function animateIn() {
    const backdrop = root.querySelector('.sx-modal-backdrop');
    if (reduceMotion()) {
      root.animate({ opacity: [0, 1] }, { duration: 150, easing: 'linear' });
      return;
    }
    backdrop.animate({ opacity: [0, 1] }, { duration: 320, easing: 'ease-out' });
    if (isSheet()) {
      dialog.animate({ transform: ['translateY(100%)', 'translateY(0)'] }, { duration: 420, easing: 'cubic-bezier(.16, 1, .3, 1)' });
      return;
    }
    const frames = flipFrames(sourceEl);
    if (frames) {
      // Origin at the art's centre so the scale lines the art up with the tile.
      const d = dialog.getBoundingClientRect();
      const f = figure.getBoundingClientRect();
      dialog.style.transformOrigin = `${f.left - d.left + f.width / 2}px ${f.top - d.top + f.height / 2}px`;
      dialog.animate({ transform: frames }, { duration: 460, easing: 'cubic-bezier(.16, 1, .3, 1)' });
      dialog.querySelector('.sx-d-body').animate(
        { opacity: [0, 1], transform: ['translateY(12px)', 'none'] },
        { duration: 360, delay: 140, easing: 'ease-out', fill: 'backwards' },
      );
      dialog.animate({ opacity: [0.4, 1] }, { duration: 200, easing: 'ease-out' });
    } else {
      dialog.animate({ opacity: [0, 1], transform: ['scale(.96)', 'scale(1)'] }, { duration: 320, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
  }

  function animateOut() {
    const backdrop = root.querySelector('.sx-modal-backdrop');
    if (reduceMotion()) return root.animate({ opacity: [1, 0] }, { duration: 120, fill: 'forwards' }).finished;
    backdrop.animate({ opacity: [1, 0] }, { duration: 260, easing: 'ease-in', fill: 'forwards' });
    if (isSheet()) {
      return dialog.animate({ transform: ['translateY(0)', 'translateY(100%)'] }, { duration: 280, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' }).finished;
    }
    const frames = flipFrames(sourceEl);
    if (frames) {
      dialog.querySelector('.sx-d-body').animate({ opacity: [1, 0] }, { duration: 140, fill: 'forwards' });
      return dialog.animate(
        { transform: frames.slice().reverse(), opacity: [1, 0.2] },
        { duration: 320, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' },
      ).finished;
    }
    return dialog.animate({ opacity: [1, 0], transform: ['scale(1)', 'scale(.97)'] }, { duration: 200, fill: 'forwards' }).finished;
  }

  function open(it, { from = null, trigger = null, updateHash = true } = {}) {
    if (!it) return;
    const wasOpen = !root.hidden;
    show(it);
    if (updateHash) setHash(it);
    if (wasOpen) return;
    opener = trigger || document.activeElement;
    sourceEl = from;
    closing = false;
    root.hidden = false;
    lockScroll(true);
    root.querySelector('.sx-d-scroll').scrollTop = 0;
    animateIn();
    dialog.focus({ preventScroll: true });
  }

  async function close() {
    if (root.hidden || closing) return;
    closing = true;
    // Re-target the tile for the current style in case the toggle changed it.
    const tile = document.querySelector(`.sx-card[data-id="${CSS.escape(String(current?.v.sync_variant_id))}"]`) ;
    if (tile) sourceEl = tile.querySelector('.sx-art');
    try { await animateOut(); } catch { /* animation cancelled */ }
    root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    root.hidden = true;
    lockScroll(false);
    setHash(null);
    const back = (tile && tile.isConnected ? tile : null) || (opener && opener.isConnected ? opener : null);
    back?.focus({ preventScroll: true });
    current = null;
    closing = false;
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    const r = e.target.closest('.sx-d-seg .seg-btn');
    if (r) {
      const it = getItems().find((x) => String(x.v.sync_variant_id) === r.dataset.id);
      if (it && !same(it, current)) {
        open(it);
        seg.querySelector(`[data-id="${CSS.escape(r.dataset.id)}"]`)?.focus();
        if (!reduceMotion()) img.animate({ opacity: [0.3, 1] }, { duration: 240, easing: 'ease-out' });
      }
      return;
    }
    if (e.target.closest('.sx-d-add') && current) onAdd(current, addBtn);
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Radio group arrows
    const r = e.target.closest('.sx-d-seg .seg-btn');
    if (r && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const btns = [...seg.querySelectorAll('.seg-btn')];
      const i = btns.indexOf(r) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      btns[(i + btns.length) % btns.length].click();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /** Resolve #alabama, #alabama-stained-glass, #new-york-stacked, #alabama-photo. */
  function fromHash(hash = location.hash) {
    const h = decodeURIComponent(String(hash).replace(/^#/, '')).toLowerCase();
    if (!h) return null;
    const items = getItems();
    return (
      items.find((it) => hashFor(it) === h) ||
      items.find((it) => artKey(it) === h) ||
      null
    );
  }

  return { open, close, fromHash, isOpen: () => !root.hidden, current: () => current };
}
