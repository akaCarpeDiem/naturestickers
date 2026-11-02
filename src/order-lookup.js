import './main.js';

const GENERIC = 'If we find a matching order, we’ll email the details to the address on file.';
const form = document.getElementById('order-lookup-form');
const input = document.getElementById('lookup');
const status = document.getElementById('lookup-status');
const button = form?.querySelector('button[type="submit"]');

if (form && input && status && button) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) {
      status.textContent = 'Enter an order number or the email you used at checkout.';
      input.focus();
      return;
    }
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.textContent = 'Sending…';
    try {
      const res = await fetch('/api/order-lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json().catch(() => null);
      status.textContent = data && typeof data.message === 'string' ? data.message : GENERIC;
    } catch {
      status.textContent = 'Something went wrong. Please try again, or email support@naturestickers.shop.';
    } finally {
      button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}
