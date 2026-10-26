// Nature Stickers — "peel and stick" add-to-cart feedback.
// A copy of the sticker art lifts off with a curled corner, arcs into the cart
// link in the header, and the cart gives one small bounce. Pure decoration:
// the cart itself is updated before this runs, and reduced motion skips it.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Where the sticker flies to: the cart link if the page has one, else the header's main button. */
const cartTarget = () =>
  document.getElementById('cart-count')?.closest('a') || document.querySelector('.site-header .nav-cta');

/** The visible part of an <img> drawn with object-fit: contain, in viewport pixels. */
function artRect(img) {
  const r = img.getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  if (!nw || !nh || getComputedStyle(img).objectFit !== 'contain') return r;
  const k = Math.min(r.width / nw, r.height / nh), w = nw * k, h = nh * k;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

/**
 * Fly a copy of `img` into the cart.
 * @param {HTMLImageElement|null} img  the sticker art the shopper is looking at
 */
export function peelToCart(img) {
  const target = cartTarget();
  if (!img || !target || reduceMotion.matches || !img.complete || !Element.prototype.animate) return;

  const from = artRect(img);
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;

  // Copy of the art plus a curl of white backing paper at the bottom-right corner.
  const fly = document.createElement('div');
  fly.className = 'peel-fly';
  fly.setAttribute('aria-hidden', 'true');
  Object.assign(fly.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  const art = img.cloneNode();
  art.removeAttribute('id'); art.removeAttribute('srcset'); art.removeAttribute('sizes');
  art.src = img.currentSrc || img.src; art.alt = '';
  art.className = 'peel-art';
  const curl = document.createElement('span');
  curl.className = 'peel-curl';
  const c = Math.min(from.height * 0.55, 90);
  curl.style.setProperty('--c', `${c}px`);
  fly.append(art, curl);
  document.body.append(fly);

  // 1. Peel: the corner curls up and the sticker lifts.
  const cut = (p) => `polygon(0 0, 100% 0, 100% calc(100% - ${c * p}px), calc(100% - ${c * p}px) 100%, 0 100%)`;
  const peelMs = 260;
  art.animate([{ clipPath: cut(0) }, { clipPath: cut(1) }], { duration: peelMs, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
  curl.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: peelMs, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });

  // 2. Fly: a curved path into the cart, shrinking and turning a little.
  const sx = from.left + from.width / 2, sy = from.top + from.height / 2;
  const ex = to.left + to.width / 2, ey = to.top + to.height / 2;
  const cx = (sx + ex) / 2, cy = Math.min(sy, ey) - Math.max(80, Math.abs(ex - sx) * 0.25);
  const end = Math.max(0.08, Math.min(0.3, (to.height * 1.1) / from.height, (to.width * 0.9) / from.width));
  const steps = 14, frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const x = u * u * sx + 2 * u * t * cx + t * t * ex, y = u * u * sy + 2 * u * t * cy + t * t * ey;
    const s = i === 0 ? 1.04 : 1.04 + (end - 1.04) * t * t;
    frames.push({ transform: `translate(${x - sx}px, ${y - sy}px) rotate(${-4 + 10 * t}deg) scale(${s})`, opacity: t > 0.9 ? 1 - (t - 0.9) * 8 : 1 });
  }
  fly.animate([{ transform: 'translate(0,0) rotate(0) scale(1)' }, { transform: 'translate(0,-6px) rotate(-4deg) scale(1.04)' }],
    { duration: peelMs, easing: 'ease-out', fill: 'forwards' });
  const flight = fly.animate(frames, { duration: 720, delay: peelMs + 40, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });

  // 3. Stick: the cart bounces once as it lands.
  flight.finished.then(() => {
    fly.remove();
    target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' });
  }, () => fly.remove());
}
