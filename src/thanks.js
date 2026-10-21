import './main.js';
import { clearCart } from './cart.js';

const status = document.getElementById('thanks-status');
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('session_id');
// Only a real Stripe return (with session_id) empties the cart; a plain visit to /thanks keeps it.
if (sessionId) clearCart();
if (status) {
  if (sessionId) {
    status.textContent = 'Payment received. We’re preparing your order for print — you’ll get tracking by email when it ships.';
  } else {
    status.textContent = 'Thanks for supporting Nature Stickers.';
  }
}
