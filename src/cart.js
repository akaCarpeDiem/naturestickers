/** Small localStorage cart for Nature Stickers shop. */
const KEY = 'nv_cart';

export function readCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => ({
        sync_variant_id: Number(row.sync_variant_id),
        qty: Number(row.qty),
        name: String(row.name || ''),
        thumbnail: row.thumbnail || null,
        retail_price: row.retail_price != null ? String(row.retail_price) : null,
      }))
      .filter((r) => Number.isInteger(r.sync_variant_id) && r.sync_variant_id > 0 && Number.isInteger(r.qty) && r.qty > 0);
  } catch {
    return [];
  }
}

export function writeCart(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('nv:cart', { detail: items }));
}

export function clearCart() {
  writeCart([]);
}

export function addToCart(item, qty = 1) {
  const cart = readCart();
  const id = Number(item.sync_variant_id);
  const existing = cart.find((c) => c.sync_variant_id === id);
  if (existing) existing.qty = Math.min(99, existing.qty + qty);
  else {
    cart.push({
      sync_variant_id: id,
      qty: Math.min(99, qty),
      name: item.name || item.variant_name || 'Sticker',
      thumbnail: item.thumbnail || null,
      retail_price: item.retail_price != null ? String(item.retail_price) : null,
    });
  }
  writeCart(cart);
  return cart;
}

export function setQty(syncVariantId, qty) {
  let cart = readCart();
  const id = Number(syncVariantId);
  if (qty <= 0) cart = cart.filter((c) => c.sync_variant_id !== id);
  else {
    const row = cart.find((c) => c.sync_variant_id === id);
    if (row) row.qty = Math.min(99, qty);
  }
  writeCart(cart);
  return cart;
}

export function cartCount(items = readCart()) {
  return items.reduce((n, i) => n + i.qty, 0);
}
