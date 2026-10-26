// Nature Stickers — homepage behaviour.
// 1. Sticker showcase: rotates through popular states; toggle between the two art styles.
// (The whole page is dark now, so the header always uses its over-dark style.)
// 3. The 50-state atlas tiles.
//
// Everything here is progressive enhancement: without JS the hero still
// renders the California stained-glass sticker and every section reads fine.

import './main.js';
import { season } from './seasons.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ——————————————————————————————————————————————
   1. Sticker showcase
   —————————————————————————————————————————————— */

// Twenty well-known, much-visited states (no sales data yet, so picked by
// travel popularity and name recognition). California leads.
const POPULAR = [
  ['california', 'California'], ['florida', 'Florida'], ['new-york', 'New York'],
  ['hawaii', 'Hawaii'], ['colorado', 'Colorado'], ['alaska', 'Alaska'],
  ['arizona', 'Arizona'], ['nevada', 'Nevada'], ['montana', 'Montana'],
  ['oregon', 'Oregon'], ['maine', 'Maine'], ['north-carolina', 'North Carolina'],
  ['georgia', 'Georgia'], ['michigan', 'Michigan'], ['massachusetts', 'Massachusetts'],
  ['louisiana', 'Louisiana'], ['new-mexico', 'New Mexico'], ['idaho', 'Idaho'],
  ['minnesota', 'Minnesota'], ['south-carolina', 'South Carolina'],
];

// States at their best right now lead the slideshow, then the popular ones follow.
const IN_SEASON = {
  fall: [['vermont', 'Vermont'], ['maine', 'Maine'], ['new-hampshire', 'New Hampshire'], ['tennessee', 'Tennessee'], ['colorado', 'Colorado']],
  winter: [['colorado', 'Colorado'], ['alaska', 'Alaska'], ['utah', 'Utah'], ['hawaii', 'Hawaii'], ['florida', 'Florida']],
  spring: [['texas', 'Texas'], ['arizona', 'Arizona'], ['georgia', 'Georgia'], ['california', 'California'], ['utah', 'Utah']],
  summer: [['montana', 'Montana'], ['wyoming', 'Wyoming'], ['alaska', 'Alaska'], ['maine', 'Maine'], ['michigan', 'Michigan']],
};
const now = season();
const inSeason = new Set(IN_SEASON[now].map(([slug]) => slug));
const STATES = [...IN_SEASON[now], ...POPULAR.filter(([slug]) => !inSeason.has(slug))]
  .map(([slug, name]) => ({ slug, name, inSeason: inSeason.has(slug) }));

const STYLES = {
  'stained-glass': 'Stained glass',
  photo: 'Photo',
};

const DWELL = 4600; // ms each state stays on screen
const SIZES = '(max-width: 900px) 88vw, min(680px, 48vw)';

const showcase = document.querySelector('[data-showcase]');

if (showcase) {
  const plate = showcase.querySelector('[data-plate]');
  const link = showcase.querySelector('[data-link]');
  const pauseBtn = showcase.querySelector('[data-pause]');
  const styleBtns = Array.from(showcase.querySelectorAll('[data-style]'));

  let layers = Array.from(showcase.querySelectorAll('.showcase-layer'));
  let index = 0;
  let style = 'stained-glass';
  let token = 0;

  const base = (slug, st) => `/stickers/all/${slug}-${st}`;
  const setSrc = (img, slug, st) => {
    img.sizes = SIZES;
    img.srcset = `${base(slug, st)}.webp 800w, ${base(slug, st)}-1400.webp 1400w`;
    img.src = `${base(slug, st)}.webp`;
  };
  const warmed = new Set();
  /** Warm the cache for a variant without blocking anything. */
  const preload = (slug, st) => {
    const key = `${slug}/${st}`;
    if (warmed.has(key)) return;
    warmed.add(key);
    setSrc(new Image(), slug, st);
  };
  const next = () => (index + 1) % STATES.length;

  const seasonTag = showcase.querySelector('[data-season-tag]');
  const syncControls = () => {
    const { slug, name, inSeason: fresh } = STATES[index];
    if (seasonTag) { seasonTag.hidden = !fresh; seasonTag.textContent = `In season this ${now}`; }
    styleBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === style)));
    if (link) {
      link.href = `/shop#${style === 'photo' ? slug : `${slug}-stained-glass`}`;
      link.setAttribute('aria-label', `Shop the ${name} sticker, ${STYLES[style].toLowerCase()}`);
    }
  };

  /**
   * Bring in a variant on the hidden layer. mode 'slide' (state change) moves
   * the old sticker out to the left and the new one in from the right with a
   * little blur/scale; mode 'fade' (style toggle) crossfades in place.
   */
  const show = async (i, st, mode) => {
    const mine = ++token;
    index = i; style = st;
    syncControls();

    const [live, spare] = layers;
    const { slug, name } = STATES[i];

    // Park the spare layer at the "enter" position without animating there.
    spare.classList.add('no-t');
    spare.classList.remove('is-out', 'is-on');
    plate.classList.toggle('is-xfade', mode === 'fade');
    setSrc(spare, slug, st);

    plate.classList.add('is-busy');
    try {
      if (spare.decode) await spare.decode();
      else await new Promise((res, rej) => { spare.onload = res; spare.onerror = rej; });
    } catch { /* show it anyway rather than freezing */ }
    if (mine !== token) return; // a newer change won
    plate.classList.remove('is-busy');

    void spare.offsetWidth; // commit the parked position
    spare.classList.remove('no-t');

    const article = /^[aeiou]/i.test(name) ? 'an' : 'a';
    spare.alt = `${name} state-name sticker, ${STYLES[st].toLowerCase()} style: each letter frames ${article} ${name} landscape`;
    spare.removeAttribute('aria-hidden');
    live.alt = 'State-name sticker slideshow, next design';
    live.setAttribute('aria-hidden', 'true');

    requestAnimationFrame(() => {
      live.classList.remove('is-on');
      live.classList.add('is-out');
      spare.classList.add('is-on');
    });
    layers = [spare, live];

    preload(STATES[next()].slug, style);
  };

  /* —— Auto-rotation —— */
  let timer = 0;
  let userPaused = false;
  const holds = new Set(); // hover, focus, offscreen, hidden tab
  const canRun = () => !userPaused && holds.size === 0 && !reduceMotion.matches;
  const schedule = () => {
    clearTimeout(timer);
    if (canRun()) timer = setTimeout(() => { show(next(), style, 'slide').then(schedule); }, DWELL);
  };
  const hold = (why, on) => { if (on) holds.add(why); else holds.delete(why); schedule(); };

  showcase.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hold('hover', true); });
  showcase.addEventListener('pointerleave', () => hold('hover', false));
  // Keyboard focus pauses; a mouse click on the toggle shouldn't freeze the slideshow.
  showcase.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) hold('focus', true); });
  showcase.addEventListener('focusout', (e) => { if (!showcase.contains(e.relatedTarget)) hold('focus', false); });
  document.addEventListener('visibilitychange', () => hold('hidden', document.hidden));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => hold('offscreen', !en.isIntersecting), { threshold: 0.15 }).observe(showcase);
  }

  const syncPause = () => {
    if (!pauseBtn) return;
    if (reduceMotion.matches) {
      // Reduced motion: no auto-advance; the button steps to the next state.
      pauseBtn.setAttribute('aria-pressed', 'true');
      pauseBtn.setAttribute('aria-label', 'Show the next state');
      return;
    }
    pauseBtn.setAttribute('aria-pressed', String(userPaused));
    pauseBtn.setAttribute('aria-label', userPaused ? 'Play the state slideshow' : 'Pause the state slideshow');
  };
  pauseBtn?.addEventListener('click', () => {
    if (reduceMotion.matches) { show(next(), style, 'fade'); return; }
    userPaused = !userPaused;
    syncPause();
    schedule();
  });

  /* —— Style toggle: applies to the current and every following state —— */
  styleBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => { if (btn.dataset.style !== style) show(index, btn.dataset.style, 'fade'); });
    btn.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const to = styleBtns[(i + dir + styleBtns.length) % styleBtns.length];
      to.focus();
      show(index, to.dataset.style, 'fade');
    });
  });

  const applyMotion = () => {
    plate.classList.toggle('is-floating', !reduceMotion.matches);
    syncPause();
    schedule();
  };
  reduceMotion.addEventListener?.('change', applyMotion);

  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 900));
  idle(() => { preload(STATES[next()].slug, style); preload(STATES[index].slug, 'photo'); });

  syncControls();
  applyMotion();
  // The HTML ships California so the hero paints instantly; swap to this season's lead state.
  if (STATES[0].slug !== 'california') show(0, style, 'fade');
}

/* —— Touch: tap a state card to flip to the photo version —— */
const touchOnly = window.matchMedia('(hover: none)');
document.querySelectorAll('.state-card:not(.is-more)').forEach((card) => {
  card.addEventListener('click', () => {
    if (touchOnly.matches) card.classList.toggle('is-flipped');
  });
});

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
