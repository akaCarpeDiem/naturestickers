// /shop — the state sticker catalog: style chips + state search over /api/products.
import './main.js';
import { addToCart } from './cart.js';
import { announce, escapeHtml, money } from './cart-ui.js';
import { createModal } from './shop-modal.js';
import { sizeLabel } from './size-label.js';

const grid = document.getElementById('state-grid');
const tools = document.getElementById('states-tools');
const chipsEl = document.getElementById('style-chips');
const search = document.getElementById('state-search');
const countEl = document.getElementById('states-count');
const emptyEl = document.getElementById('states-empty');
const clearBtn = document.getElementById('clear-filters');

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * "New York Protected Lands Sticker (Stacked) — Real Photo"
 *   → { state: "New York", edition: "Stacked", style: "Real Photo" }
 * Styles come from the title suffix after the dash, so a new style in Printful
 * automatically becomes a new filter chip.
 */
function parse(p) {
  const name = String(p.name || '');
  const m = name.match(/^(.*?)\s+[—–-]\s+([^—–]+)$/);
  const base = (m ? m[1] : name).trim();
  const style = m ? m[2].trim() : 'Original';
  const edition = (base.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
  const state = base.replace(/\([^)]*\)\s*$/, '').replace(/\s+Protected Lands Sticker\s*$/i, '').replace(/\s+Sticker\s*$/i, '').trim();
  const v = (p.variants || [])[0];
  return { p, v, state, edition, style, styleKey: slug(style), thumb: p.thumbnail || v?.thumbnail || '' };
}

let items = [];
let styles = []; // [{ key, label }]
const selected = new Set(); // empty = All

function readUrl() {
  const q = new URLSearchParams(location.search);
  selected.clear();
  (q.get('style') || '').split(',').map(slug).filter(Boolean).forEach((k) => selected.add(k));
  if (search) search.value = q.get('q') || '';
}

function writeUrl() {
  const q = new URLSearchParams(location.search);
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

function renderChips() {
  const all = selected.size === 0;
  chipsEl.innerHTML = [
    `<button type="button" class="seg-btn filter-chip" data-key="" aria-pressed="${all}">All</button>`,
    ...styles.map(
      (s) => `<button type="button" class="seg-btn filter-chip" data-key="${escapeHtml(s.key)}" aria-pressed="${!all && selected.has(s.key)}">${escapeHtml(s.label)}</button>`,
    ),
  ].join('');
}

/** Transparent site art keyed like the Printful external_id: <state>[-<edition>]-<photo|stained-glass>. */
function artKey(it) {
  const style = it.styleKey === 'real-photo' ? 'photo' : it.styleKey;
  return [slug(it.state), it.edition ? slug(it.edition) : '', style].filter(Boolean).join('-');
}

function card(it) {
  const title = `${it.state}${it.edition ? ` (${it.edition})` : ''}`;
  const size = it.v?.size ? escapeHtml(sizeLabel(it.v.size)) : '';
  const alt = escapeHtml(`${title} sticker, ${it.style}`);
  return `
    <article class="sx-card" data-id="${it.v.sync_variant_id}" tabindex="0" aria-haspopup="dialog" aria-label="${escapeHtml(`${title}, ${it.style}, ${money(it.v.retail_price)}. Open details`)}">
      <div class="sx-art">
        <img src="/stickers/all/${artKey(it)}.webp" srcset="/stickers/all/${artKey(it)}.webp 800w, /stickers/all/${artKey(it)}-1400.webp 1400w" sizes="(max-width: 600px) calc(100vw - 60px), (max-width: 1280px) calc(50vw - 60px), 580px" data-fallback="${escapeHtml(it.thumb)}" alt="${alt}" width="800" height="270" loading="lazy" decoding="async" />
      </div>
      <div class="sx-body">
        <div class="sx-title">
          <h3 class="sx-name">${escapeHtml(title)}</h3>
          <p class="sx-style">${escapeHtml(it.style)}</p>
        </div>
        <span class="sx-price">${money(it.v.retail_price)}</span>
      </div>
      <div class="sx-foot">
        ${size ? `<span class="state-badge" aria-label="Size ${size}">${size}</span>` : '<span></span>'}
        <button type="button" class="btn btn-primary add-btn sx-add" data-id="${it.v.sync_variant_id}">Add to cart<span class="sr-only"> — ${escapeHtml(`${title}, ${it.style}`)}</span></button>
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

function render() {
  const term = (search?.value || '').trim().toLowerCase();
  const shown = items.filter(
    (it) => (selected.size === 0 || selected.has(it.styleKey)) && (!term || it.state.toLowerCase().includes(term)),
  );
  grid.innerHTML = shown.map(card).join('');
  grid.hidden = shown.length === 0;
  emptyEl.hidden = shown.length !== 0;
  const states = new Set(shown.map((it) => it.state)).size;
  countEl.textContent = shown.length
    ? `Showing ${shown.length} sticker${shown.length === 1 ? '' : 's'} across ${states} state${states === 1 ? '' : 's'}`
    : 'No stickers match these filters.';
}

function setData(products) {
  items = products
    .map(parse)
    .filter((it) => it.v && Number(it.v.retail_price) > 0)
    .sort(
      (a, b) =>
        a.state.localeCompare(b.state) ||
        a.edition.localeCompare(b.edition) ||
        a.style.localeCompare(b.style),
    );
  const seen = new Map();
  for (const it of items) if (!seen.has(it.styleKey)) seen.set(it.styleKey, it.style);
  styles = [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  normalizeSelection();
  tools.hidden = items.length === 0;
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
  if (search) search.value = '';
  renderChips();
  render();
  writeUrl();
  search?.focus();
});

function addItem(it, btn) {
  addToCart({
    sync_variant_id: it.v.sync_variant_id,
    name: `${it.state}${it.edition ? ` (${it.edition})` : ''} — ${it.style} · ${sizeLabel(it.v.size)}`.replace(/ · $/, ''),
    thumbnail: it.thumb || null,
    retail_price: it.v.retail_price,
  });
  announce(`Added ${it.state} ${it.style} to cart.`);
  btn.classList.add('is-added');
  btn.firstChild.textContent = 'Added ✓';
  setTimeout(() => { btn.classList.remove('is-added'); btn.firstChild.textContent = 'Add to cart'; }, 1600);
}

const modal = createModal({ getItems: () => items, artKey, slug, onAdd: addItem });
const byId = (id) => items.find((x) => String(x.v.sync_variant_id) === String(id));

grid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-btn');
  if (btn) {
    const it = byId(btn.dataset.id);
    if (it) addItem(it, btn);
    return;
  }
  const tile = e.target.closest('.sx-card');
  if (!tile || window.getSelection()?.toString()) return;
  modal.open(byId(tile.dataset.id), { from: tile.querySelector('.sx-art'), trigger: tile });
});

grid?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tile = e.target;
  if (!(tile instanceof HTMLElement) || !tile.classList.contains('sx-card')) return; // the tile itself, not its Add button
  e.preventDefault();
  modal.open(byId(tile.dataset.id), { from: tile.querySelector('.sx-art'), trigger: tile });
});

// Shared links: /shop#alabama or /shop#alabama-stained-glass open that sticker once the catalog is in.
let hashHandled = false;
function openFromHash() {
  const it = modal.fromHash();
  if (!it) return;
  const tile = grid.querySelector(`.sx-card[data-id="${CSS.escape(String(it.v.sync_variant_id))}"]`);
  modal.open(it, { from: tile?.querySelector('.sx-art'), trigger: tile, updateHash: false });
}
window.addEventListener('hashchange', () => { if (modal.fromHash()) openFromHash(); else if (modal.isOpen() && !location.hash) modal.close(); });

readUrl();
load();
