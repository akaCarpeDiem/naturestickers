// Nature Stickers — tiny progressive enhancements (no dependencies)
document.documentElement.classList.add('js');

document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = String(new Date().getFullYear());
});

// Header hairline once the page scrolls
const header = document.querySelector('.site-header');
if (header) {
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

// Gentle reveal on scroll
const reveals = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add('in'));
}

// Hero state-sticker cycle (crossfade). Respects prefers-reduced-motion.
const hero = document.querySelector('[data-hero-cycle]');
if (hero) {
  const slides = Array.from(hero.querySelectorAll('.hero-slide'));
  const caption = hero.querySelector('[data-hero-caption]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = Math.max(0, slides.findIndex((s) => s.classList.contains('is-active')));

  const setCaption = (slide, fade) => {
    if (!caption) return;
    const next = slide?.dataset.caption || '';
    if (!fade || reduceMotion) {
      caption.textContent = next;
      caption.classList.remove('is-fading');
      return;
    }
    caption.classList.add('is-fading');
    window.setTimeout(() => {
      caption.textContent = next;
      caption.classList.remove('is-fading');
    }, 280);
  };

  const preloadRest = () => {
    slides.slice(1).forEach((slide) => {
      const img = slide.querySelector('img');
      if (!img) return;
      img.loading = 'eager';
      const src = img.currentSrc || img.getAttribute('src');
      if (src) {
        const pre = new Image();
        pre.src = src;
      }
      if (img.decode) img.decode().catch(() => {});
    });
  };

  if (slides.length > 1 && !reduceMotion) {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 600));
    idle(preloadRest);

    const INTERVAL = 3500;
    window.setInterval(() => {
      const prev = slides[index];
      index = (index + 1) % slides.length;
      const next = slides[index];
      prev.classList.remove('is-active');
      next.classList.add('is-active');
      setCaption(next, true);
    }, INTERVAL);
  } else {
    // Static first slide for reduced motion (or single slide)
    slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
    setCaption(slides[index], false);
  }
}
