// /shop — the sticker catalog: section tabs + style chips + search over /api/products.
// Sections (states, locations, …) come from src/data/sections.json; see src/sections.js.
import './main.js';
import { addToCart } from './cart.js';
import { announce, escapeHtml, money } from './cart-ui.js';
import { artKey, parse, placeholder, slug } from './catalog-parse.js';
import { pageUrl, SECTIONS, sectionByKey, sizesBlurb } from './sections.js';
import { createModal } from './shop-modal.js';
import { sizeLabel } from './size-label.js';

const grid = document.getElementById('state-grid');
const tools = document.getElementById('states-tools');
const tabsEl = document.getElementById('section-tabs');
const chipsEl = document.getElementById('style-chips');
const search = document.getElementById('state-search');
const countEl = document.getElementById('states-count');
const emptyEl = document.getElementById('states-empty');
const clearBtn = document.getElementById('clear-filters');

let items = [];
let styles = []; // [{ key, label }]
const selected = new Set(); // empty = All
let section = ''; // '' = all sections

function readUrl() {
  const q = new URLSearchParams(location.search);
  selected.clear();
  (q.get('style') || '').split(',').map(slug).filter(Boolean).forEach((k) => selected.add(k));
  section = sectionByKey(slug(q.get('section') || '')) ? slug(q.get('section')) : '';
  if (search) search.value = q.get('q') || '';
}

function writeUrl() {
  const q = new URLSearchParams(location.search);
  if (section) q.set('section', section); else q.delete('section');
  const keys = styles.map((s) => s.key).filter((k) => selected.has(k));
  if (keys.length) q.set('style', keys.join(',')); else q.delete('style');
  const term = search?.value.trim();
  if (term) q.set('q', term); else q.delete('q');
  const qs = q.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
}

function normalizeSelection() {
  for (const k of [...selected]) {
    if (styles.some((s) => s.key === k)) continue;
    selected.delete(k); // unknown key in URL: accept a short alias such as ?style=photo
    const alias = styles.find((s) => s.key.split('-').includes(k));
    if (alias) selected.add(alias.key);
  }
  if (selected.size === styles.length) selected.clear(); // every style = All
}

function renderTabs() {
  if (!tabsEl) return;
  tabsEl.innerHTML = [
    `<button type="button" class="seg-btn filter-chip" data-section="" aria-pressed="${!section}">All</button>`,
    ...SECTIONS.map(
      (s) => `<button type="button" class="seg-btn filter-chip" data-section="${escapeHtml(s.key)}" aria-pressed="${section === s.key}">${escapeHtml(s.label)}</button>`,
    ),
  ].join('');
}

function renderChips() {
  const all = selected.size === 0;
  chipsEl.innerHTML = [
    `<button type="button" class="seg-btn filter-chip" data-key="" aria-pressed="${all}">All</button>`,
    ...styles.map(
      (s) => `<button type="button" class="seg-btn filter-chip" data-key="${escapeHtml(s.key)}" aria-pressed="${!all && selected.has(s.key)}">${escapeHtml(s.label)}</button>`,
    ),
  ].join('');
}

const multiSize = (it) => it.section.sizes.length > 1;
/** Card price: one size → its live price; several → "From" the cheapest (live if in, else the section's). */
function priceText(it) {
  if (!multiSize(it)) return money(it.v.retail_price);
  const live = it.vs.map((x) => Number(x.retail_price)).filter((n) => n > 0);
  return `From ${money(live.length ? Math.min(...live) : it.section.minPrice)}`;
}

function card(it) {
  const square = it.section.art === 'square';
  const multi = multiSize(it);
  const size = multi ? escapeHtml(sizesBlurb(it.section)) : it.v?.size ? escapeHtml(sizeLabel(it.v.size)) : '';
  const alt = escapeHtml(`${it.title} sticker, ${it.style}`);
  const price = priceText(it);
  const art = `/stickers/all/${artKey(it)}`;
  const sizes = square
    ? '(max-width: 600px) calc(50vw - 40px), (max-width: 1280px) calc(25vw - 50px), 280px'
    : '(max-width: 600px) calc(100vw - 60px), (max-width: 1280px) calc(50vw - 60px), 580px';
  const button = multi
    ? `<button type="button" class="btn btn-primary sx-add sx-choose" data-id="${escapeHtml(it.id)}">Choose size<span class="sr-only"> — ${escapeHtml(`${it.title}, ${it.style}`)}</span></button>`
    : `<button type="button" class="btn btn-primary add-btn sx-add" data-id="${escapeHtml(it.id)}">Add to cart<span class="sr-only"> — ${escapeHtml(`${it.title}, ${it.style}`)}</span></button>`;
  return `
    <article class="sx-card${square ? ' is-square' : ''}" data-id="${escapeHtml(it.id)}" tabindex="0" aria-haspopup="dialog" aria-label="${escapeHtml(`${it.title}, ${it.style}, ${price}. Open details`)}">
      <div class="sx-art">
        <img src="${art}.webp" srcset="${art}.webp 800w, ${art}-1400.webp 1400w" sizes="${sizes}" data-fallback="${escapeHtml(it.thumb)}" alt="${alt}" width="800" height="${square ? 800 : 270}" loading="lazy" decoding="async" />
      </div>
      <div class="sx-body">
        <div class="sx-title">
          <h3 class="sx-name"><a class="sx-name-link" href="${pageUrl(it.section, it.key)}">${escapeHtml(it.title)}</a></h3>
          ${it.sub ? `<p class="sx-sub">${escapeHtml(it.sub)}</p>` : ''}
          <p class="sx-style">${escapeHtml(it.style)}</p>
        </div>
        <span class="sx-price">${price}</span>
      </div>
      <div class="sx-foot">
        ${size ? `<span class="state-badge" aria-label="Size ${size}">${size}</span>` : '<span></span>'}
        ${button}
      </div>
    </article>`;
}

// No transparent art for this product (e.g. a brand-new style)? Fall back to the Printful mockup on a light plate.
grid?.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.fallback || img.dataset.fellBack) return;
  img.dataset.fellBack = '1';
  img.closest('.sx-art')?.classList.add('is-mockup');
  img.removeAttribute('srcset');
  img.removeAttribute('sizes');
  img.src = img.dataset.fallback;
}, true);

const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

function render() {
  const term = (search?.value || '').trim().toLowerCase();
  const matches = (it) =>
    !term || [it.title, it.state, it.sub].some((t) => String(t || '').toLowerCase().includes(term));
  const shown = items.filter(
    (it) => (!section || it.section.key === section) && (selected.size === 0 || selected.has(it.styleKey)) && matches(it),
  );
  const groups = SECTIONS.map((s) => ({ s, list: shown.filter((it) => it.section.key === s.key) })).filter((g) => g.list.length);
  grid.innerHTML = groups
    .map(
      ({ s, list }) => `
      <section class="sx-sec" data-section="${escapeHtml(s.key)}" aria-labelledby="sx-sec-${escapeHtml(s.key)}">
        <h2 class="sx-sec-h" id="sx-sec-${escapeHtml(s.key)}">${escapeHtml(s.heading)}</h2>
        <div class="sx-grid${s.art === 'square' ? ' sx-grid--square' : ''}">${list.map(card).join('')}</div>
      </section>`,
    )
    .join('');
  grid.hidden = shown.length === 0;
  emptyEl.hidden = shown.length !== 0;
  // "Showing 110 stickers: 50 states and 8 locations" (states count by name, so New York's two editions are one state).
  const parts = groups.map(({ s, list }) => plural(new Set(list.map((it) => (s.key === 'states' ? it.state : it.key))).size, s.noun));
  countEl.textContent = shown.length
    ? `Showing ${plural(shown.length, ['sticker', 'stickers'])}: ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`
    : 'No stickers match these filters.';
}

function setData(products) {
  const live = products
    .map(parse)
    // Only products whose page exists (their key is in a section's data file) are shown.
    .filter((it) => it.section && it.v && Number(it.v.retail_price) > 0);
  // Sections still waiting on Printful show their stickers as "coming soon" (no Add button).
  const have = new Set(live.map((it) => `${it.key}|${it.styleKey}`));
  const pending = SECTIONS.filter((s) => s.comingSoon).flatMap((s) =>
    Object.keys(s.info).flatMap((key) => s.styles.filter((st) => !have.has(`${key}|${st.key}`)).map((st) => placeholder(s, key, st))),
  );
  const order = (it) => SECTIONS.indexOf(it.section);
  items = [...live, ...pending].sort(
    (a, b) =>
      order(a) - order(b) ||
      a.title.localeCompare(b.title) ||
      a.edition.localeCompare(b.edition) ||
      a.style.localeCompare(b.style),
  );
  const seen = new Map();
  for (const it of items) if (!seen.has(it.styleKey)) seen.set(it.styleKey, it.style);
  styles = [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  normalizeSelection();
  tools.hidden = items.length === 0;
  renderTabs();
  renderChips();
  render();
}

async function load(attempt = 0) {
  try {
    const res = await fetch('/api/products', attempt ? { cache: 'no-store' } : undefined);
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : [];
    if (!products.length && !data.partial) {
      countEl.textContent = res.ok ? 'New stickers are on the way — check back soon.' : 'Stickers couldn’t load. Please refresh in a moment.';
      return;
    }
    setData(products);
    if (!hashHandled && modal.fromHash()) { hashHandled = true; openFromHash(); }
    // A large catalog fills in over a few requests; poll briefly until complete.
    if (data.partial && attempt < 5) setTimeout(() => load(attempt + 1), 1500);
  } catch {
    if (!attempt) countEl.textContent = 'Stickers couldn’t load. Please refresh in a moment.';
  }
}

tabsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-chip');
  if (!btn) return;
  section = btn.dataset.section || '';
  renderTabs();
  tabsEl.querySelector(`.filter-chip[data-section="${CSS.escape(section)}"]`)?.focus();
  render();
  writeUrl();
});

chipsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-chip');
  if (!btn) return;
  const key = btn.dataset.key;
  if (!key) selected.clear();
  else if (selected.has(key)) selected.delete(key);
  else selected.add(key);
  normalizeSelection();
  renderChips();
  chipsEl.querySelector(`.filter-chip[data-key="${CSS.escape(key)}"]`)?.focus();
  render();
  writeUrl();
});

let t;
search?.addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(() => { render(); writeUrl(); }, 120);
});

clearBtn?.addEventListener('click', () => {
  selected.clear();
  section = '';
  if (search) search.value = '';
  renderTabs();
  renderChips();
  render();
  writeUrl();
  search?.focus();
});

/** Add one size of a sticker (`variant` defaults to its only/cheapest size). */
function addItem(it, btn, variant = it.v) {
  if (!variant) return;
  const size = sizeLabel(variant.size);
  addToCart({
    sync_variant_id: variant.sync_variant_id,
    name: `${it.title} — ${it.style} · ${size}`.replace(/ · $/, ''),
    thumbnail: it.thumb || null,
    retail_price: variant.retail_price,
  });
  announce(`Added ${it.title} ${it.style}${multiSize(it) && size ? `, ${size},` : ''} to cart.`);
  btn.classList.add('is-added');
  btn.firstChild.textContent = 'Added ✓';
  setTimeout(() => { btn.classList.remove('is-added'); btn.firstChild.textContent = 'Add to cart'; }, 1600);
}

const modal = createModal({ getItems: () => items, artKey, slug, onAdd: addItem });
const byId = (id) => items.find((x) => x.id === String(id));

grid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-btn');
  if (btn) {
    const it = byId(btn.dataset.id);
    if (it) addItem(it, btn);
    return;
  }
  // The name links to the sticker's page: a plain left click still opens the popup; modifier clicks follow the link.
  const link = e.target.closest('.sx-name-link');
  if (link) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
  }
  const tile = e.target.closest('.sx-card');
  if (!tile || window.getSelection()?.toString()) return;
  modal.open(byId(tile.dataset.id), { from: tile.querySelector('.sx-art'), trigger: tile });
});

grid?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tile = e.target;
  if (!(tile instanceof HTMLElement) || !tile.classList.contains('sx-card')) return; // the tile itself, not its buttons
  e.preventDefault();
  modal.open(byId(tile.dataset.id), { from: tile.querySelector('.sx-art'), trigger: tile });
});

// Shared links: /shop#alabama or /shop#alabama-stained-glass open that sticker once the catalog is in.
let hashHandled = false;
function openFromHash() {
  const it = modal.fromHash();
  if (!it) return;
  const tile = grid.querySelector(`.sx-card[data-id="${CSS.escape(it.id)}"]`);
  modal.open(it, { from: tile?.querySelector('.sx-art'), trigger: tile, updateHash: false });
}
window.addEventListener('hashchange', () => { if (modal.fromHash()) openFromHash(); else if (modal.isOpen() && !location.hash) modal.close(); });

readUrl();
load();
