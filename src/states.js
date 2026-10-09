// /states — the state sticker catalog: style chips + state search over /api/products.
import './main.js';
import { addToCart } from './cart.js';
import { announce, escapeHtml, money } from './cart-ui.js';

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
  for (const k of [...selected]) if (!styles.some((s) => s.key === k)) selected.delete(k); // unknown key in URL
  if (selected.size === styles.length) selected.clear(); // every style = All
}

function renderChips() {
  const all = selected.size === 0;
  chipsEl.innerHTML = [
    `<button type="button" class="filter-chip" data-key="" aria-pressed="${all}">All</button>`,
    ...styles.map(
      (s) => `<button type="button" class="filter-chip" data-key="${escapeHtml(s.key)}" aria-pressed="${!all && selected.has(s.key)}">${escapeHtml(s.label)}</button>`,
    ),
  ].join('');
}

function card(it) {
  const title = `${it.state}${it.edition ? ` (${it.edition})` : ''}`;
  const size = it.v?.size ? escapeHtml(it.v.size) : '';
  return `
    <article class="product-card state-card-item">
      <div class="product-art">
        ${it.thumb ? `<img src="${escapeHtml(it.thumb)}" alt="${escapeHtml(`${title} sticker, ${it.style}`)}" width="600" height="600" loading="lazy" decoding="async" />` : '<div class="product-placeholder" aria-hidden="true"></div>'}
      </div>
      <div class="product-body">
        <div class="state-card-head">
          <h3>${escapeHtml(title)}</h3>
          <p class="state-style">${escapeHtml(it.style)}</p>
        </div>
        <div class="state-meta">
          <span class="product-price">${money(it.v.retail_price)}</span>
          ${size ? `<span class="size-pill" aria-label="Size ${size}">${size}</span>` : ''}
        </div>
        <button type="button" class="btn btn-primary add-btn" data-id="${it.v.sync_variant_id}">Add to cart<span class="sr-only"> — ${escapeHtml(`${title}, ${it.style}`)}</span></button>
      </div>
    </article>`;
}

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

grid?.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-btn');
  if (!btn) return;
  const it = items.find((x) => String(x.v.sync_variant_id) === btn.dataset.id);
  if (!it) return;
  addToCart({
    sync_variant_id: it.v.sync_variant_id,
    name: `${it.state}${it.edition ? ` (${it.edition})` : ''} — ${it.style} · ${it.v.size || ''}`.replace(/ · $/, ''),
    thumbnail: it.thumb || null,
    retail_price: it.v.retail_price,
  });
  announce(`Added ${it.state} ${it.style} to cart.`);
  btn.classList.add('is-added');
  btn.firstChild.textContent = 'Added ✓';
  setTimeout(() => { btn.classList.remove('is-added'); btn.firstChild.textContent = 'Add to cart'; }, 1600);
});

readUrl();
load();
