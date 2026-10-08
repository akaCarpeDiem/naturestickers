import { json, methodNotAllowed, type Env } from "../lib/http";
import { getSyncVariant } from "../lib/printful";
import {
  FLAT_SHIPPING_CENTS,
  FLAT_SHIPPING_LABEL,
  dollarsToCents,
  shippingCountries,
  stripeForm,
} from "../lib/stripe";

type CartItem = { sync_variant_id: number; qty: number };

function parseCart(body: any): { ok: true; items: CartItem[] } | { ok: false; error: string } {
  const raw = body?.cart ?? body?.items ?? body;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "Cart is empty. Send { cart: [{ sync_variant_id, qty }] }." };
  }
  const items: CartItem[] = [];
  for (const row of raw) {
    const id = Number(row?.sync_variant_id);
    const qty = Number(row?.qty ?? row?.quantity);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "Each item needs a valid sync_variant_id." };
    }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 99) {
      return { ok: false, error: "Each item needs qty between 1 and 99." };
    }
    items.push({ sync_variant_id: id, qty });
  }
  return { ok: true, items };
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const env = context.env;
  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: "Stripe is not configured." }, 503);
  }
  if (!env.PRINTFUL_TOKEN) {
    return json({ error: "Printful is not configured." }, 503);
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = parseCart(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // Re-price on the server from Printful retail prices — never trust client prices.
  const lineItems: { sync_variant_id: number; qty: number; name: string; unit_cents: number }[] = [];
  for (const item of parsed.items) {
    const looked = await getSyncVariant(env, item.sync_variant_id);
    if (!looked.ok || !looked.variant) {
      return json({ error: `Unknown sync_variant_id: ${item.sync_variant_id}` }, 400);
    }
    const v = looked.variant;
    if (v.is_ignored) {
      return json({ error: `Variant ${item.sync_variant_id} is not available.` }, 400);
    }
    const cents = dollarsToCents(v.retail_price);
    if (!Number.isFinite(cents) || cents <= 0) {
      return json(
        { error: `Variant ${item.sync_variant_id} has no retail price set in Printful.` },
        400,
      );
    }
    lineItems.push({
      sync_variant_id: item.sync_variant_id,
      qty: item.qty,
      name: String(v.name || `Variant ${item.sync_variant_id}`),
      unit_cents: cents,
    });
  }

  const origin = (env.PUBLIC_ORIGIN || new URL(context.request.url).origin).replace(/\/$/, "");
  const countries = shippingCountries(env);

  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`);
  params.set("cancel_url", `${origin}/shop`);
  params.set("payment_method_types[0]", "card");
  params.set("billing_address_collection", "auto");

  countries.forEach((c, i) => {
    params.set(`shipping_address_collection[allowed_countries][${i}]`, c);
  });

  // PLACEHOLDER flat-rate shipping (see FLAT_SHIPPING_CENTS).
  params.set("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(FLAT_SHIPPING_CENTS));
  params.set("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
  params.set("shipping_options[0][shipping_rate_data][display_name]", FLAT_SHIPPING_LABEL);

  lineItems.forEach((li, i) => {
    params.set(`line_items[${i}][quantity]`, String(li.qty));
    params.set(`line_items[${i}][price_data][currency]`, "usd");
    params.set(`line_items[${i}][price_data][unit_amount]`, String(li.unit_cents));
    params.set(`line_items[${i}][price_data][product_data][name]`, li.name.slice(0, 200));
    params.set(
      `line_items[${i}][price_data][product_data][metadata][sync_variant_id]`,
      String(li.sync_variant_id),
    );
  });

  // Compact cart for webhook → Printful order (metadata value max 500 chars).
  const cartMeta = lineItems.map((li) => `${li.sync_variant_id}x${li.qty}`).join(",");
  if (cartMeta.length > 490) {
    return json({ error: "Cart is too large." }, 400);
  }
  params.set("metadata[cart]", cartMeta);
  params.set("metadata[source]", "naturestickers");

  const res = await stripeForm(env, "/v1/checkout/sessions", params);
  if (!res.ok) {
    return json({ error: res.data?.error?.message || "Stripe error" }, 502);
  }
  return json({ url: res.data.url, id: res.data.id });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
};
