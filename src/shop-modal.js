// /shop — expanded sticker view. Opens in place over the grid (no navigation),
// animates from the tile, and is shareable via #<key> / #<key>-stained-glass.
import { escapeHtml, money } from './cart-ui.js';
import { variantFor } from './catalog-parse.js';
import { pageUrl } from './sections.js';
import { locationPhotoSrc } from './sticker-url.js';
import { sizeLabel, SIZE_NOTE } from './size-label.js';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSheet = () => window.matchMedia('(max-width: 600px)').matches;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} opts
 * @param {() => any[]} opts.getItems   current catalog items (parsed products)
 * @param {(it: any) => string} opts.artKey
 * @param {(s: string) => string} opts.slug
 * @param {(it: any, btn: HTMLButtonElement, variant?: any) => void} opts.onAdd
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
            <div class="sx-d-pricebox">
              <span class="sx-d-price"></span>
              <a class="sx-d-page" href="/shop" hidden>Open full page ↗</a>
            </div>
          </div>
          <div class="sx-d-toggle" hidden>
            <span class="sx-label" id="sx-d-toggle-label">Style</span>
            <div class="seg sx-d-seg" role="radiogroup" aria-labelledby="sx-d-toggle-label"></div>
          </div>
          <div class="sx-d-buy">
            <fieldset class="sx-sizes sx-d-sizes" data-size-picker hidden>
              <legend class="sx-label">Size</legend>
              <div class="sx-sizes-opts"></div>
            </fieldset>
            <span class="state-badge sx-d-size"></span>
            <button type="button" class="btn btn-primary sx-add sx-d-add">Add to cart</button>
          </div>
          <div class="sx-d-about">
            <p class="sx-d-blurb" id="sx-d-blurb"></p>
            <p class="sx-d-spot" hidden><span class="sx-label">Where it is</span> <span class="sx-d-spot-text"></span></p>
          </div>
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
  const pageLink = root.querySelector('.sx-d-page');
  const sizeEl = root.querySelector('.sx-d-size');
  const addBtn = root.querySelector('.sx-d-add');
  const toggle = root.querySelector('.sx-d-toggle');
  const seg = root.querySelector('.sx-d-seg');
  const blurbEl = root.querySelector('.sx-d-blurb');
  const lettersSec = root.querySelector('.sx-d-letters');
  const lettersCols = root.querySelector('.sx-d-cols');
  const sizesEl = root.querySelector('.sx-d-sizes');
  const sizeOpts = root.querySelector('.sx-sizes-opts');
  const spotEl = root.querySelector('.sx-d-spot');
  const spotText = root.querySelector('.sx-d-spot-text');
  let sizeSel = ''; // chosen size key ("3x3"), kept across style switches

  let current = null; // item shown
  let opener = null; // element to return focus to
  let sourceEl = null; // tile art to animate from/to
  let scrollY = 0;
  let closing = false;

  const groupKey = (it) => it.key;
  const same = (a, b) => !!a && !!b && a.id === b.id;
  const siblings = (it) => getItems().filter((x) => groupKey(x) === groupKey(it));
  const hashFor = (it) => {
    const sib = siblings(it);
    // The first style (Real Photo) owns the bare #state hash; other styles add their key.
    return same(sib[0], it) || it.styleKey === 'real-photo' ? groupKey(it) : `${groupKey(it)}-${it.styleKey}`;
  };

  /** Price + Add button for the chosen size (multi-size sections) or the only size. */
  function updateBuy() {
    const it = current;
    if (!it) return;
    const multi = it.section.sizes.length > 1;
    const size = multi ? it.section.sizes.find((z) => z.key === sizeSel) || it.section.sizes[0] : null;
    const variant = multi ? (it.vs.length ? variantFor(it, size.key) : null) : it.v;
    priceEl.textContent = variant ? money(variant.retail_price) : money(size ? size.price : it.section.minPrice);
    addBtn.classList.remove('is-added');
    addBtn.disabled = !variant;
    addBtn.innerHTML = variant
      ? `Add to cart<span class="sr-only"> — ${escapeHtml(`${it.title}, ${it.style}${size ? `, ${size.label}` : ''}`)}</span>`
      : 'Coming soon';
  }

  function show(it) {
    current = it;
    const title = it.title;
    titleEl.textContent = title;
    styleEl.textContent = it.sub ? `${it.sub} · ${it.style}` : it.style;
    // Every key in a section's data file has its own static page at /shop/<section>/<key>.
    pageLink.href = pageUrl(it.section, it.key);
    pageLink.hidden = false;
    const multi = it.section.sizes.length > 1;
    sizeEl.textContent = sizeLabel(it.v?.size);
    sizeEl.title = it.v?.size && it.section.key === 'states' ? SIZE_NOTE : '';
    sizeEl.hidden = multi || !it.v?.size;
    sizesEl.hidden = !multi;
    if (multi) {
      if (!it.section.sizes.some((z) => z.key === sizeSel)) sizeSel = it.section.sizes[0].key;
      sizeOpts.innerHTML = it.section.sizes
        .map((z) => {
          const v = it.vs.length ? variantFor(it, z.key) : null;
          const price = v ? money(v.retail_price) : money(z.price);
          return `<label class="sx-size-opt"><input type="radio" name="sx-d-size" value="${escapeHtml(z.key)}"${z.key === sizeSel ? ' checked' : ''} /><span class="sx-size-label">${escapeHtml(z.label)}</span><span class="sx-size-price">${price}</span></label>`;
        })
        .join('');
    }
    updateBuy();

    const key = artKey(it);
    figure.classList.remove('is-mockup');
    figure.classList.toggle('is-square', it.section.art === 'square');
    delete img.dataset.fellBack;
    img.dataset.fallback = it.thumb || '';
    img.src = locationPhotoSrc(it.section?.key, `/stickers/all/${key}-1400.webp`);
    img.alt = it.section.key === 'states'
      ? `${title} sticker, ${it.style}: each letter frames a ${it.state} landscape`
      : `${title} sticker, ${it.style}${it.data.spot ? `: ${it.data.spot}` : ''}`;

    const sib = siblings(it);
    toggle.hidden = sib.length < 2;
    seg.innerHTML = sib
      .map((s) => `<button type="button" class="seg-btn" role="radio" aria-checked="${same(s, it)}" tabindex="${same(s, it) ? 0 : -1}" data-id="${escapeHtml(s.id)}">${escapeHtml(s.style)}</button>`)
      .join('');
    // Warm the other style's art so toggling is instant.
    sib.filter((s) => !same(s, it)).forEach((s) => { const i = new Image(); i.src = locationPhotoSrc(s.section?.key, `/stickers/all/${artKey(s)}-1400.webp`); });

    spotText.textContent = it.data.spot || '';
    spotEl.hidden = !it.data.spot;

    // Edition-specific records (e.g. new-york-stacked) override the state's own entry; the blurb falls back to the state.
    const data = it.data || {};
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
    const tile = current ? document.querySelector(`.sx-card[data-id="${CSS.escape(current.id)}"]`) : null;
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
      const it = getItems().find((x) => x.id === r.dataset.id);
      if (it && !same(it, current)) {
        open(it);
        seg.querySelector(`[data-id="${CSS.escape(r.dataset.id)}"]`)?.focus();
        if (!reduceMotion()) img.animate({ opacity: [0.3, 1] }, { duration: 240, easing: 'ease-out' });
      }
      return;
    }
    if (e.target.closest('.sx-d-add') && current && !addBtn.disabled) {
      const multi = current.section.sizes.length > 1;
      const variant = multi ? variantFor(current, sizeSel) : current.v;
      if (variant) onAdd(current, addBtn, variant);
    }
  });

  sizesEl.addEventListener('change', (e) => {
    if (e.target.name !== 'sx-d-size') return;
    sizeSel = e.target.value;
    updateBuy();
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
