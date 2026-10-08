// Nature Stickers — homepage behaviour.
// 1. Sticker showcase: choose a state, flip between the two art styles.
// 2. Header theme swap while the dark hero is on screen.
// 3. The 50-state atlas tiles.
//
// Everything here is progressive enhancement: without JS the hero still
// renders the California stained-glass sticker and every section reads fine.

import './main.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ——————————————————————————————————————————————
   1. Sticker showcase
   —————————————————————————————————————————————— */

const STATES = [
  { slug: 'alabama', name: 'Alabama' },
  { slug: 'alaska', name: 'Alaska' },
  { slug: 'arizona', name: 'Arizona' },
  { slug: 'arkansas', name: 'Arkansas' },
  { slug: 'california', name: 'California' },
];

const STYLES = {
  'stained-glass': 'Stained glass',
  photo: 'Photo',
};

const showcase = document.querySelector('[data-showcase]');

if (showcase) {
  const plate = showcase.querySelector('[data-plate]');
  const caption = showcase.querySelector('[data-caption]');
  const styleBtns = Array.from(showcase.querySelectorAll('[data-style]'));
  const stateBtns = Array.from(showcase.querySelectorAll('[data-state]'));

  let layers = Array.from(showcase.querySelectorAll('.showcase-layer'));
  let current = { slug: 'california', style: 'stained-glass' };
  let token = 0;

  const stateName = (slug) => STATES.find((s) => s.slug === slug)?.name || slug;
  const base = (slug, style) => `/stickers/states/${slug}-${style}`;
  const srcFor = (slug, style) => `${base(slug, style)}.webp`;
  const srcsetFor = (slug, style) => `${base(slug, style)}-700.webp 700w, ${base(slug, style)}.webp 1400w`;

  /** Warm the browser cache for a variant without blocking anything. */
  const preload = (slug, style) => {
    const img = new Image();
    img.sizes = '(max-width: 900px) 92vw, min(1100px, 88vw)';
    img.srcset = srcsetFor(slug, style);
    img.src = srcFor(slug, style);
  };

  const syncControls = () => {
    styleBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === current.style)));
    stateBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.state === current.slug)));
    if (caption) caption.textContent = `${stateName(current.slug)} \u00B7 ${STYLES[current.style]}`;
  };

  /**
   * Crossfade to a new variant using the currently hidden layer, then swap
   * which layer is "live". Falls back to an instant swap for reduced motion
   * or if the image fails to decode.
   */
  const show = async (slug, style) => {
    if (slug === current.slug && style === current.style) return;

    const mine = ++token;
    current = { slug, style };
    syncControls();

    const [live, spare] = layers;
    const alt = `${stateName(slug)} state-name sticker, ${STYLES[style].toLowerCase()} style: each letter frames a ${stateName(slug)} landscape`;

    spare.sizes = '(max-width: 900px) 92vw, min(1100px, 88vw)';
    spare.srcset = srcsetFor(slug, style);
    spare.src = srcFor(slug, style);

    if (plate) plate.classList.add('is-busy');

    try {
      if (spare.decode) await spare.decode();
      else await new Promise((res, rej) => { spare.onload = res; spare.onerror = rej; });
    } catch {
      /* Decode failed (offline, bad file) — show it anyway rather than freezing. */
    }

    // A newer click landed while we were decoding; let that one win.
    if (mine !== token) return;

    if (plate) plate.classList.remove('is-busy');

    spare.alt = alt;
    spare.removeAttribute('aria-hidden');
    live.alt = '';
    live.setAttribute('aria-hidden', 'true');

    spare.classList.add('is-on');
    live.classList.remove('is-on');
    layers = [spare, live];
  };

  styleBtns.forEach((btn) => {
    btn.addEventListener('click', () => show(current.slug, btn.dataset.style));
  });

  // Arrow-key support for the radiogroup, per WAI-ARIA.
  styleBtns.forEach((btn, i) => {
    btn.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const next = styleBtns[(i + dir + styleBtns.length) % styleBtns.length];
      next.focus();
      show(current.slug, next.dataset.style);
    });
  });

  stateBtns.forEach((btn) => {
    btn.addEventListener('click', () => show(btn.dataset.state, current.style));
    // Preload on intent so the swap feels instant.
    btn.addEventListener('pointerenter', () => preload(btn.dataset.state, current.style), { once: true });
  });

  // Respect reduced motion for the idle float.
  const applyMotion = () => {
    if (!plate) return;
    plate.classList.toggle('is-floating', !reduceMotion.matches);
  };
  applyMotion();
  reduceMotion.addEventListener?.('change', applyMotion);

  // Quietly warm the other style of the state we are already showing,
  // since the toggle is the most likely first interaction.
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 900));
  idle(() => preload(current.slug, 'photo'));

  syncControls();
}

/* ——————————————————————————————————————————————
   2. Header theme while the dark hero is on screen
   —————————————————————————————————————————————— */

const hero = document.querySelector('.hero');
const siteHeader = document.querySelector('.site-header');

if (hero && siteHeader && 'IntersectionObserver' in window) {
  let io;

  const watch = () => {
    io?.disconnect();
    const h = siteHeader.offsetHeight || 78;
    io = new IntersectionObserver(
      ([entry]) => siteHeader.classList.toggle('over-dark', entry.isIntersecting),
      { rootMargin: `-${h}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(hero);
  };

  watch();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(watch, 180);
  }, { passive: true });
} else if (hero && siteHeader) {
  siteHeader.classList.add('over-dark');
}

/* ——————————————————————————————————————————————
   3. 50-state atlas
   —————————————————————————————————————————————— */

const ABBR = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const LIVE = new Set(['AL', 'AK', 'AZ', 'AR', 'CA']);

const atlas = document.querySelector('[data-atlas]');
if (atlas) {
  const frag = document.createDocumentFragment();
  ABBR.forEach((code) => {
    const el = document.createElement('span');
    el.textContent = code;
    if (LIVE.has(code)) el.className = 'is-live';
    frag.appendChild(el);
  });
  atlas.appendChild(frag);
}
