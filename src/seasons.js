// Nature Stickers — seasonal sky behind the homepage hero.
// The season comes from today's date and the light from the visitor's clock:
// snow in winter, soft rain and petals in spring, sun glare / fireflies in summer,
// leaves in the wind in fall. Faint on purpose; it only lives in the hero.
//
// Progressive enhancement: one canvas, no dependencies. It pauses when the tab is
// hidden or the hero is off screen, draws one still frame for reduced motion,
// and the footer's "Ambient effects" switch turns it off (remembered per browser).

const STORE_KEY = 'ns-ambient';
const STRENGTH = 0.6;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

const hero = document.querySelector('.hero');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const readPref = () => { try { return localStorage.getItem(STORE_KEY) !== 'off'; } catch { return true; } };
const writePref = (on) => { try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };

/* —— Season and light —— */
export const season = (d = new Date()) => {
  const m = d.getMonth();
  return (m === 11 || m < 2) ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'fall';
};
const timeOfDay = (d = new Date()) => {
  const h = d.getHours();
  return (h >= 5 && h < 8) ? 'dawn' : (h >= 8 && h < 17) ? 'day' : (h >= 17 && h < 20) ? 'dusk' : 'night';
};

if (hero) {
  /* —— Layers: time-of-day tint under the topo texture, canvas above it —— */
  const sky = document.createElement('div');
  sky.className = 'hero-sky';
  sky.setAttribute('aria-hidden', 'true');
  sky.innerHTML = '<i class="t-dawn"></i><i class="t-day"></i><i class="t-dusk"></i>';
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-fx';
  canvas.setAttribute('aria-hidden', 'true');
  hero.prepend(sky);
  const heroGlow = hero.querySelector('.hero-glow');
  if (heroGlow) heroGlow.after(canvas); else sky.after(canvas);
  const ctx = canvas.getContext('2d');

  let enabled = readPref();
  let W = 0, H = 0, dpr = 1, t = 0;

  /* —— Sprites, drawn once and stamped every frame —— */
  const sprite = (size, draw) => {
    const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c;
  };
  const glow = (rgb) => sprite(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, `rgba(${rgb},1)`); r.addColorStop(0.35, `rgba(${rgb},.55)`); r.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  const SNOW = glow('238,244,235');
  const FIREFLY = glow('226,240,150');
  const MOTE = glow('250,230,190');

  const blurred = (src, px) => sprite(src.width, (g) => { g.filter = `blur(${px}px)`; g.drawImage(src, 0, 0); });
  const leafPath = (g, w, h) => {
    g.beginPath(); g.moveTo(0, -h);
    g.bezierCurveTo(w, -h * 0.55, w * 0.85, h * 0.5, 0, h);
    g.bezierCurveTo(-w * 0.85, h * 0.5, -w, -h * 0.55, 0, -h);
  };
  const leaf = (fill, edge, kind) => sprite(64, (g, s) => {
    g.translate(s / 2, s / 2);
    const shade = g.createLinearGradient(-20, -20, 20, 20); shade.addColorStop(0, fill); shade.addColorStop(1, edge);
    g.fillStyle = shade;
    if (kind === 'maple') {
      for (const a of [-0.9, 0, 0.9]) { g.save(); g.rotate(a); g.translate(0, -6); leafPath(g, 9, 17); g.fill(); g.restore(); }
    } else if (kind === 'aspen') { leafPath(g, 17, 19); g.fill(); } else { leafPath(g, 11, 24); g.fill(); }
    g.strokeStyle = 'rgba(40,24,12,.35)'; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(0, kind === 'maple' ? 2 : -18); g.lineTo(0, 26); g.stroke();
  });
  // Brand clay and sun tones, plus a muted olive.
  const LEAF_TONES = [['#C97B4A', '#8F4826'], ['#E2B36C', '#B07A35'], ['#B8673F', '#7A3A1E'], ['#A99351', '#6E6230'], ['#D9925A', '#9C5328']];
  let LEAVES = null; // built on first use
  const leaves = () => LEAVES ??= LEAF_TONES.flatMap(([f, e]) => ['maple', 'aspen', 'elm'].map((k) => {
    const s = leaf(f, e, k); return { sharp: s, soft: blurred(s, 2.5) };
  }));
  const PETAL = sprite(32, (g, s) => {
    g.translate(s / 2, s / 2);
    const r = g.createLinearGradient(0, -10, 0, 10); r.addColorStop(0, '#F6E3E4'); r.addColorStop(1, '#D9AEB4');
    g.fillStyle = r; g.beginPath(); g.ellipse(0, 0, 6, 10, 0, 0, TAU); g.fill();
  });

  /* —— Wind: a slow swell plus an occasional gust —— */
  let gust = 0, gustTarget = 0, nextGust = rand(4, 8);
  const wind = () => 10 + 16 * Math.sin(t * 0.13) + 8 * Math.sin(t * 0.37 + 1) + gust;
  const stepWind = (dt) => {
    nextGust -= dt;
    if (nextGust <= 0) { gustTarget = rand(45, 85); nextGust = rand(7, 13); }
    gust += (gustTarget - gust) * Math.min(1, dt * 1.4);
    gustTarget *= Math.pow(0.55, dt);
  };

  /* —— The pointer stirs the air —— */
  const ptr = { x: -9999, y: -9999, vx: 0, vy: 0, last: 0 };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const now = performance.now(), dt = Math.max(16, now - ptr.last) / 1000;
    if (ptr.last && now - ptr.last < 120) {
      ptr.vx = ptr.vx * 0.6 + ((x - ptr.x) / dt) * 0.4; ptr.vy = ptr.vy * 0.6 + ((y - ptr.y) / dt) * 0.4;
    }
    ptr.x = x; ptr.y = y; ptr.last = now;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { ptr.x = ptr.y = -9999; ptr.vx = ptr.vy = 0; });
  const stir = (p, dt, k) => {
    const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy, R = 170;
    if (d2 < R * R) { const f = Math.pow(1 - Math.sqrt(d2) / R, 2) * k; p.kx += ptr.vx * f * dt * 2.2; p.ky += ptr.vy * f * dt * 2.2; }
    p.kx *= Math.pow(0.25, dt); p.ky *= Math.pow(0.25, dt);
  };

  /* —— Particle systems; each one fades in and out with `mix` —— */
  const area = () => (W * H) / (1400 * 800);
  const systems = {};
  const make = (name, density, init, step, draw) => {
    systems[name] = { name, mix: 0, target: 0, ps: [], init, step, draw, count: () => Math.round(density * Math.max(0.35, Math.min(1.4, area()))) };
  };
  const reset = (s) => { s.ps = Array.from({ length: s.count() }, () => s.init(true)); };

  make('snow', 150, (fresh) => {
    const z = Math.random(), bokeh = z > 0.9;
    return { x: rand(-40, W + 40), y: fresh ? rand(-20, H) : rand(-60, -10), z, r: bokeh ? rand(5, 8) : 1 + z * 2.4,
      vy: 14 + z * 34, ph: rand(0, TAU), sw: rand(0.4, 1.1), kx: 0, ky: 0, a: bokeh ? 0.16 : 0.25 + z * 0.55 };
  }, (p, dt, s) => {
    stir(p, dt, 0.5);
    p.x += (wind() * (0.25 + p.z * 0.35) + Math.sin(t * p.sw + p.ph) * 9 + p.kx) * dt;
    p.y += (p.vy + p.ky) * dt;
    if (p.y > H + 20 || p.x > W + 60 || p.x < -60) Object.assign(p, s.init(false), { x: rand(-80, W) });
  }, (p, a) => {
    const d = p.r * 2.6; ctx.globalAlpha = p.a * a; ctx.drawImage(SNOW, p.x - d, p.y - d, d * 2, d * 2);
  });

  make('leaves', 18, (fresh) => {
    const z = Math.random(), set = leaves();
    return { x: rand(-60, W), y: fresh ? rand(-40, H) : rand(-80, -30), z, s: 0.34 + z * 0.42, vy: 22 + z * 30,
      rot: rand(0, TAU), vr: rand(-1.2, 1.2), fl: rand(0, TAU), vf: rand(1.4, 3.2), ph: rand(0, TAU),
      sp: set[(Math.random() * set.length) | 0], kx: 0, ky: 0, a: 0.3 + z * 0.45 };
  }, (p, dt, s) => {
    stir(p, dt, 0.9);
    const w = wind();
    p.x += (w * (0.7 + p.z * 0.9) + Math.sin(t * 0.9 + p.ph) * 18 + p.kx) * dt;
    p.y += (p.vy + Math.cos(t * 1.3 + p.ph) * 10 + p.ky) * dt;
    p.rot += (p.vr + w * 0.006 + (p.kx + p.ky) * 0.004) * dt;
    p.fl += p.vf * (1 + w * 0.01) * dt;
    if (p.y > H + 40 || p.x > W + 80) Object.assign(p, s.init(false), { x: rand(-120, W * 0.8) });
  }, (p, a) => {
    // Squash on one axis as the leaf flips, so it reads as tumbling in 3D.
    const fx = Math.cos(p.fl), c = Math.cos(p.rot), sn = Math.sin(p.rot);
    const sx = p.s * (0.18 + 0.82 * Math.abs(fx)), sy = p.s;
    ctx.setTransform(c * sx * dpr, sn * sx * dpr, -sn * sy * dpr, c * sy * dpr, p.x * dpr, p.y * dpr);
    ctx.globalAlpha = p.a * a * (fx < 0 ? 0.78 : 1);
    ctx.drawImage(p.z < 0.45 ? p.sp.soft : p.sp.sharp, -32, -32);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  });

  make('rain', 160, (fresh) => {
    const z = Math.random();
    return { x: rand(-100, W + 40), y: fresh ? rand(-40, H) : rand(-200, -20), z, len: 10 + z * 20, vy: 520 + z * 520 };
  }, (p, dt, s) => {
    p.x += wind() * 2.2 * dt; p.y += p.vy * dt;
    if (p.y > H + 30) Object.assign(p, s.init(false));
  }, null);
  // Rain is stroked in three batches (far, mid, near) instead of drop by drop.
  systems.rain.drawAll = (a, n) => {
    const w = wind() * 2.2, ps = systems.rain.ps;
    for (const [lo, hi, alpha, lw] of [[0, 0.4, 0.07, 0.6], [0.4, 0.8, 0.11, 0.8], [0.8, 1.01, 0.17, 1]]) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = ps[i];
        if (p.z >= lo && p.z < hi) { const k = p.len / p.vy; ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - w * k, p.y - p.len); }
      }
      ctx.strokeStyle = `rgba(206,224,214,${alpha * a})`; ctx.lineWidth = lw; ctx.stroke();
    }
  };

  make('petals', 7, (fresh) => {
    const z = Math.random();
    return { x: rand(-40, W), y: fresh ? rand(-20, H) : rand(-60, -20), z, s: 0.5 + z * 0.5, vy: 16 + z * 18,
      rot: rand(0, TAU), fl: rand(0, TAU), vf: rand(1, 2.4), ph: rand(0, TAU), kx: 0, ky: 0, a: 0.25 + z * 0.35 };
  }, (p, dt, s) => {
    stir(p, dt, 0.9);
    p.x += (wind() * 0.6 + Math.sin(t * 0.8 + p.ph) * 14 + p.kx) * dt; p.y += (p.vy + p.ky) * dt;
    p.rot += 0.6 * dt; p.fl += p.vf * dt;
    if (p.y > H + 20 || p.x > W + 40) Object.assign(p, s.init(false), { x: rand(-80, W * 0.8) });
  }, (p, a) => {
    const c = Math.cos(p.rot), sn = Math.sin(p.rot), sx = p.s * (0.25 + 0.75 * Math.abs(Math.cos(p.fl))), sy = p.s;
    ctx.setTransform(c * sx * dpr, sn * sx * dpr, -sn * sy * dpr, c * sy * dpr, p.x * dpr, p.y * dpr);
    ctx.globalAlpha = p.a * a; ctx.drawImage(PETAL, -16, -16);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  });

  make('motes', 46, () => ({ x: rand(W * 0.3, W), y: rand(0, H * 0.8), z: Math.random(), ph: rand(0, TAU), vx: rand(-6, 6), vy: rand(-4, 4), kx: 0, ky: 0 }),
    (p, dt) => {
      stir(p, dt, 0.6);
      p.vx += rand(-8, 8) * dt; p.vy += rand(-8, 8) * dt; p.vx *= 0.99; p.vy *= 0.99;
      p.x += (p.vx + 4 + p.kx) * dt; p.y += (p.vy - 2 + p.ky) * dt;
      if (p.x > W + 10 || p.y < -10 || p.y > H) Object.assign(p, { x: rand(W * 0.3, W * 0.9), y: rand(H * 0.1, H * 0.8) });
    }, (p, a) => {
      // Dust only shows up where it drifts through the sunbeam.
      const beam = Math.max(0, 1 - Math.hypot(p.x - W * 0.88, p.y + H * 0.1) / (H * 1.3));
      const tw = 0.5 + 0.5 * Math.sin(t * 1.7 + p.ph * 3);
      const d = 2 + p.z * 3; ctx.globalAlpha = a * (0.08 + beam * 0.5) * tw;
      ctx.drawImage(MOTE, p.x - d, p.y - d, d * 2, d * 2);
    });

  make('fireflies', 18, () => ({ x: rand(0, W), y: rand(H * 0.35, H), z: Math.random(), dir: rand(0, TAU), on: 0, cycle: rand(0, 4), len: rand(2.6, 5), kx: 0, ky: 0 }),
    (p, dt) => {
      stir(p, dt, 0.4);
      p.dir += rand(-2, 2) * dt;
      const sp = 10 + p.z * 10;
      p.x += (Math.cos(p.dir) * sp + p.kx) * dt; p.y += (Math.sin(p.dir) * sp * 0.6 + p.ky) * dt;
      if (p.y < H * 0.3) p.dir = Math.abs(p.dir);
      if (p.y > H) p.dir = -Math.abs(p.dir);
      if (p.x < -20) p.x = W + 10;
      if (p.x > W + 20) p.x = -10;
      p.cycle = (p.cycle + dt) % p.len;
      p.on = p.cycle < 1.3 ? Math.sin((p.cycle / 1.3) * Math.PI) : 0;
    }, (p, a) => {
      if (p.on <= 0.01) return;
      const d = 7 + p.z * 9; ctx.globalAlpha = a * p.on * (0.35 + p.z * 0.4);
      ctx.drawImage(FIREFLY, p.x - d, p.y - d, d * 2, d * 2);
    });

  /* —— Stars and summer glare are drawn directly —— */
  let stars = [];
  const makeStars = () => {
    stars = Array.from({ length: Math.round(80 * Math.max(0.4, Math.min(1.4, area()))) }, () => (
      { x: Math.random(), y: Math.pow(Math.random(), 1.6) * 0.55, r: rand(0.4, 1.2), ph: rand(0, TAU), sp: rand(0.4, 1.4) }));
  };
  const lights = { stars: 0, starsT: 0, glare: 0, glareT: 0 };
  const drawStars = (a) => {
    ctx.fillStyle = '#EEF4EB';
    for (const s of stars) {
      ctx.globalAlpha = a * (0.15 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph)));
      ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, TAU); ctx.fill();
    }
  };
  const drawGlare = (a) => {
    const sx = W * 0.9, sy = -H * 0.12, breathe = 0.85 + 0.15 * Math.sin(t * 0.35);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 1.05);
    g.addColorStop(0, `rgba(233,184,114,${0.30 * a * breathe})`); g.addColorStop(0.35, `rgba(233,184,114,${0.08 * a})`); g.addColorStop(1, 'rgba(233,184,114,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Slow light shafts
    const L = Math.hypot(W, H) * 1.1;
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI * 0.62 + i * 0.13 + Math.sin(t * 0.05 + i) * 0.04, spread = 0.028 + (i % 3) * 0.012;
      const lg = ctx.createLinearGradient(sx, sy, sx + Math.cos(ang) * L, sy + Math.sin(ang) * L);
      lg.addColorStop(0, `rgba(250,226,180,${(0.05 + 0.025 * Math.sin(t * 0.3 + i * 2)) * a})`); lg.addColorStop(1, 'rgba(250,226,180,0)');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(ang - spread) * L, sy + Math.sin(ang - spread) * L);
      ctx.lineTo(sx + Math.cos(ang + spread) * L, sy + Math.sin(ang + spread) * L); ctx.fill();
    }
    // Lens ghosts on the line from the sun through the pointer (or the middle)
    const tx = ptr.x > -999 ? ptr.x : W * 0.45, ty = ptr.y > -999 ? ptr.y : H * 0.6;
    for (const [k, r, rgb, al] of [[0.45, 26, '233,184,114', 0.07], [0.7, 54, '169,193,156', 0.045], [0.95, 14, '250,236,200', 0.09], [1.25, 90, '127,169,184', 0.035]]) {
      const x = sx + (tx - sx) * k, y = sy + (ty - sy) * k;
      const rg = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
      rg.addColorStop(0, `rgba(${rgb},${al * a * 0.4})`); rg.addColorStop(0.85, `rgba(${rgb},${al * a})`); rg.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };

  /* —— Which layers the current season and light use —— */
  const apply = () => {
    const se = season(), tm = timeOfDay(), night = tm === 'night';
    const plan = {
      snow: se === 'winter', leaves: se === 'fall', rain: se === 'spring', petals: se === 'spring' && !night,
      motes: se === 'summer' && !night, fireflies: se === 'summer' && (night || tm === 'dusk'),
    };
    for (const s of Object.values(systems)) {
      s.target = enabled && plan[s.name] ? 1 : 0;
      if (s.target && !s.ps.length) reset(s);
    }
    lights.starsT = enabled && night && se !== 'spring' ? 1 : 0;
    lights.glareT = !enabled ? 0 : se === 'summer' && tm === 'day' ? 1 : se === 'summer' && tm === 'dawn' ? 0.6 : se === 'fall' && tm === 'day' ? 0.35 : 0;
    sky.querySelectorAll('i').forEach((el) => el.classList.toggle('on', enabled && el.classList.contains(`t-${tm}`)));
    hero.dataset.season = se; hero.dataset.light = tm;
  };

  /* —— Render loop —— */
  let last = 0, visible = true, raf = 0;
  const still = () => reduceMotion.matches;
  const frame = (now, once = false) => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    const moving = !once && !still();
    if (moving) { t += dt; stepWind(dt); }
    const fade = moving ? Math.min(1, dt * 0.8) : 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    lights.stars += (lights.starsT - lights.stars) * fade;
    lights.glare += (lights.glareT - lights.glare) * fade;
    if (lights.stars > 0.01) drawStars(lights.stars * (0.4 + 0.6 * STRENGTH));
    if (lights.glare > 0.01) drawGlare(lights.glare * (0.35 + 0.65 * STRENGTH));
    let settling = false;
    for (const s of Object.values(systems)) {
      s.mix += (s.target - s.mix) * fade;
      if (Math.abs(s.target - s.mix) > 0.01) settling = true;
      if (s.mix < 0.01) { if (!s.target) s.ps.length = 0; continue; }
      const n = Math.ceil(s.ps.length * (0.35 + 0.65 * STRENGTH)), a = s.mix * (0.45 + 0.75 * STRENGTH);
      if (moving) for (let i = 0; i < n; i++) s.step(s.ps[i], dt, s);
      if (s.drawAll) s.drawAll(a, n); else for (let i = 0; i < n; i++) s.draw(s.ps[i], a);
    }
    ctx.globalAlpha = 1;
    if ((moving && enabled) || settling) schedule();
  };
  const schedule = () => {
    if (raf || !visible || document.hidden) return;
    raf = requestAnimationFrame((n) => { raf = 0; frame(n); });
  };
  const redraw = () => { if (still()) frame(performance.now(), true); else { last = 0; schedule(); } };

  const resize = () => {
    const r = hero.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    makeStars();
    for (const s of Object.values(systems)) if (s.ps.length) reset(s);
    redraw();
  };

  /* —— Fade the effect out as the hero scrolls away —— */
  const onScroll = () => { canvas.style.opacity = String(Math.max(0, 1 - window.scrollY / (H * 0.85 || 1))); };
  window.addEventListener('scroll', onScroll, { passive: true });

  // Start after the page has settled so it never competes with the hero image.
  const start = () => {
    apply();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero); else { window.addEventListener('resize', resize); resize(); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = 0; schedule(); }).observe(hero);
    }
    document.addEventListener('visibilitychange', () => { last = 0; schedule(); });
    reduceMotion.addEventListener?.('change', redraw);
    // Re-check the season and light every few minutes for long visits.
    setInterval(() => { apply(); redraw(); }, 5 * 60 * 1000);
    onScroll();
  };
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 600));
  if (document.readyState === 'complete') idle(start); else window.addEventListener('load', () => idle(start), { once: true });

  /* —— Footer switch —— */
  const toggle = document.querySelector('[data-ambient-toggle]');
  if (toggle) {
    const sync = () => { toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = enabled ? 'Ambient effects: on' : 'Ambient effects: off'; };
    toggle.hidden = false;
    sync();
    toggle.addEventListener('click', () => { enabled = !enabled; writePref(enabled); sync(); apply(); redraw(); });
  }
}

/* —— Showcase sticker tilts toward the pointer and catches the light —— */
const stage = document.querySelector('.showcase-stage');
const link = stage?.querySelector('.showcase-link');
const plate = stage?.querySelector('[data-plate]');
if (stage && link && plate && !reduceMotion.matches) {
  const sheen = document.createElement('span');
  sheen.className = 'showcase-sheen';
  sheen.setAttribute('aria-hidden', 'true');
  plate.append(sheen);
  let maskSrc = '';
  // Mask the gloss to the sticker that is showing, so it never lights the empty plate.
  const syncMask = () => {
    const img = plate.querySelector('.showcase-layer.is-on');
    const src = img?.currentSrc || img?.src || '';
    if (src && src !== maskSrc) { maskSrc = src; sheen.style.webkitMaskImage = sheen.style.maskImage = `url("${src}")`; }
  };
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    stage.addEventListener('pointermove', (e) => {
      const r = plate.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      syncMask();
      stage.classList.add('is-tilting');
      link.style.transform = `rotateX(${(0.5 - y) * 9}deg) rotateY(${(x - 0.5) * 11}deg)`;
      sheen.style.setProperty('--sx', `${x * 100}%`); sheen.style.setProperty('--sy', `${y * 100}%`);
    });
    stage.addEventListener('pointerleave', () => { stage.classList.remove('is-tilting'); link.style.transform = ''; });
  } else {
    // Touch screens: a slow sheen sweeps across every few seconds.
    setInterval(() => {
      if (document.hidden) return;
      syncMask();
      stage.classList.add('is-sweeping');
      const t0 = performance.now();
      const run = (n) => {
        const k = (n - t0) / 1600;
        sheen.style.setProperty('--sx', `${-30 + k * 160}%`);
        if (k < 1) requestAnimationFrame(run); else stage.classList.remove('is-sweeping');
      };
      requestAnimationFrame(run);
    }, 7000);
  }
}
