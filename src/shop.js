import './main.js';
import { readCart, writeCart, addToCart, setQty, cartCount, clearCart } from './cart.js';

const productsEl = document.getElementById('products');
const emptyEl = document.getElementById('shop-empty');
const cartEl = document.getElementById('cart-panel');
const cartCountEl = document.getElementById('cart-count');
const checkoutBtn = document.getElementById('checkout-btn');
const cartStatus = document.getElementById('cart-status');

function money(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function renderCart() {
  const cart = readCart();
  if (cartCountEl) cartCountEl.textContent = String(cartCount(cart));
  if (!cartEl) return;
  if (!cart.length) {
    cartEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }
  cartEl.innerHTML = cart
    .map(
      (item) => `
    <div class="cart-row" data-id="${item.sync_variant_id}">
      <div class="cart-row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="cart-price">${item.retail_price ? money(item.retail_price) : ''}</span>
      </div>
      <div class="cart-qty">
        <button type="button" class="qty-btn" data-act="dec" aria-label="Decrease quantity">−</button>
        <span>${item.qty}</span>
        <button type="button" class="qty-btn" data-act="inc" aria-label="Increase quantity">+</button>
        <button type="button" class="qty-btn qty-remove" data-act="rm" aria-label="Remove">Remove</button>
      </div>
    </div>`,
    )
    .join('');
  if (checkoutBtn) checkoutBtn.disabled = false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderProducts(products) {
  if (!productsEl) return;
  if (!products.length) {
    productsEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  productsEl.hidden = false;
  productsEl.innerHTML = products
    .map((p) => {
      const variants = p.variants || [];
      const first = variants[0];
      const opts = variants
        .map(
          (v) =>
            `<option value="${v.sync_variant_id}" data-price="${escapeHtml(v.retail_price)}" data-name="${escapeHtml(v.variant_name)}" data-thumb="${escapeHtml(v.thumbnail || p.thumbnail || '')}">${escapeHtml(v.variant_name)}${v.size ? ` · ${escapeHtml(v.size)}` : ''} — ${money(v.retail_price)}</option>`,
        )
        .join('');
      return `
      <article class="product-card reveal in">
        <div class="product-art">
          ${p.thumbnail ? `<img src="${escapeHtml(p.thumbnail)}" alt="" width="280" height="280" loading="lazy" />` : '<div class="product-placeholder" aria-hidden="true"></div>'}
        </div>
        <div class="product-body">
          <h3>${escapeHtml(p.name)}</h3>
          <label class="sr-only" for="v-${p.id}">Variant</label>
          <select class="variant-select" id="v-${p.id}">${opts}</select>
          <p class="product-price" data-price>${first ? money(first.retail_price) : ''}</p>
          <button type="button" class="btn btn-primary add-btn" data-product="${p.id}">Add to cart</button>
        </div>
      </article>`;
    })
    .join('');
}

async function loadProducts(attempt = 0) {
  try {
    const res = await fetch('/api/products', attempt ? { cache: 'no-store' } : undefined);
    const data = await res.json();
    renderProducts(Array.isArray(data.products) ? data.products : []);
    // A large store's catalog fills in over a few requests; poll briefly until complete.
    if (data.partial && attempt < 5) setTimeout(() => loadProducts(attempt + 1), 1500);
  } catch {
    if (!attempt) renderProducts([]);
  }
}

productsEl?.addEventListener('change', (e) => {
  const sel = e.target.closest('.variant-select');
  if (!sel) return;
  const opt = sel.selectedOptions[0];
  const priceEl = sel.closest('.product-body')?.querySelector('[data-price]');
  if (priceEl && opt) priceEl.textContent = money(opt.dataset.price);
});

productsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('.add-btn');
  if (!btn) return;
  const card = btn.closest('.product-card');
  const sel = card?.querySelector('.variant-select');
  const opt = sel?.selectedOptions?.[0];
  if (!opt) return;
  addToCart({
    sync_variant_id: Number(opt.value),
    name: opt.dataset.name || 'Sticker',
    thumbnail: opt.dataset.thumb || null,
    retail_price: opt.dataset.price || null,
  });
  renderCart();
  if (cartStatus) {
    cartStatus.textContent = 'Added to cart.';
    setTimeout(() => { cartStatus.textContent = ''; }, 2000);
  }
});

cartEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.cart-row');
  const id = Number(row?.dataset.id);
  const cart = readCart();
  const item = cart.find((c) => c.sync_variant_id === id);
  if (!item) return;
  const act = btn.dataset.act;
  if (act === 'inc') setQty(id, item.qty + 1);
  else if (act === 'dec') setQty(id, item.qty - 1);
  else if (act === 'rm') setQty(id, 0);
  renderCart();
});

checkoutBtn?.addEventListener('click', async () => {
  const cart = readCart();
  if (!cart.length) return;
  checkoutBtn.disabled = true;
  if (cartStatus) cartStatus.textContent = 'Starting checkout…';
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cart: cart.map((c) => ({ sync_variant_id: c.sync_variant_id, qty: c.qty })),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      if (cartStatus) cartStatus.textContent = data.error || 'Checkout failed.';
      checkoutBtn.disabled = false;
      return;
    }
    window.location.href = data.url;
  } catch {
    if (cartStatus) cartStatus.textContent = 'Network error. Try again.';
    checkoutBtn.disabled = false;
  }
});

window.addEventListener('nv:cart', renderCart);
renderCart();
loadProducts();

// Expose clear for thanks page via same module graph if needed
export { clearCart };
