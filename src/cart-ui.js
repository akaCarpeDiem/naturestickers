/** Shared cart panel + checkout (used by /shop and /states). */
import { readCart, setQty, cartCount } from './cart.js';

const cartEl = document.getElementById('cart-panel');
const cartCountEl = document.getElementById('cart-count');
const checkoutBtn = document.getElementById('checkout-btn');
const cartStatus = document.getElementById('cart-status');
// Must match FLAT_SHIPPING_CENTS in functions/lib/stripe.ts.
const FLAT_SHIPPING = 4.99;

export function money(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function renderCart() {
  const cart = readCart();
  if (cartCountEl) cartCountEl.textContent = String(cartCount(cart));
  if (!cartEl) return;
  if (!cart.length) {
    cartEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }
  // Line totals skip items without a price (never show NaN).
  const unit = (item) => {
    const n = Number(item.retail_price);
    return item.retail_price != null && Number.isFinite(n) ? n : null;
  };
  const lineText = (item) => {
    const u = unit(item);
    if (u == null) return '';
    return item.qty > 1 ? `${money(u * item.qty)} (${money(u)} each)` : money(u);
  };
  const subtotal = cart.reduce((sum, item) => sum + (unit(item) ?? 0) * item.qty, 0);
  cartEl.innerHTML =
    cart
      .map(
        (item) => `
    <div class="cart-row" data-id="${item.sync_variant_id}">
      <div class="cart-row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="cart-price">${lineText(item)}</span>
      </div>
      <div class="cart-qty">
        <button type="button" class="qty-btn" data-act="dec" aria-label="Decrease quantity of ${escapeHtml(item.name)}">−</button>
        <span>${item.qty}</span>
        <button type="button" class="qty-btn" data-act="inc" aria-label="Increase quantity of ${escapeHtml(item.name)}">+</button>
        <button type="button" class="qty-btn qty-remove" data-act="rm" aria-label="Remove ${escapeHtml(item.name)}">Remove</button>
      </div>
    </div>`,
      )
      .join('') +
    `
    <div class="cart-summary">
      <div class="cart-summary-row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="cart-summary-row"><span>Shipping</span><span>${money(FLAT_SHIPPING)} flat (US)</span></div>
      <div class="cart-summary-row cart-summary-total"><span>Estimated total</span><span>${money(subtotal + FLAT_SHIPPING)}</span></div>
    </div>`;
  if (checkoutBtn) checkoutBtn.disabled = false;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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


/** Show a short polite status message under the cart. */
export function announce(msg) {
  if (!cartStatus) return;
  cartStatus.textContent = msg;
  clearTimeout(announce.t);
  announce.t = setTimeout(() => { cartStatus.textContent = ''; }, 2500);
}

window.addEventListener('nv:cart', renderCart);
renderCart();
