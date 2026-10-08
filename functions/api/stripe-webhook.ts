import { json, methodNotAllowed, type Env } from "../lib/http";
import { externalIdFromSession, printful } from "../lib/printful";
import { verifyStripeSignature } from "../lib/stripe";

function parseCartMeta(cart: string | undefined): { sync_variant_id: number; qty: number }[] {
  if (!cart) return [];
  const items: { sync_variant_id: number; qty: number }[] = [];
  for (const piece of cart.split(",")) {
    const m = /^(\d+)x(\d+)$/.exec(piece.trim());
    if (!m) continue;
    items.push({ sync_variant_id: Number(m[1]), qty: Number(m[2]) });
  }
  return items;
}

async function createPrintfulOrder(env: Env, session: any): Promise<void> {
  const cart = parseCartMeta(session?.metadata?.cart);
  if (!cart.length) {
    console.error("[stripe-webhook] missing cart metadata on session", session?.id);
    return;
  }

  const ship = session.shipping_details || session.collected_information?.shipping_details || null;
  const addr = ship?.address || {};
  const email = session.customer_details?.email || session.customer_email || undefined;
  const name = ship?.name || session.customer_details?.name || "Customer";

  if (!addr.line1 || !addr.city || !addr.country || !addr.postal_code) {
    console.error("[stripe-webhook] incomplete shipping address on session", session?.id);
    return;
  }

  const externalId = await externalIdFromSession(String(session.id));

  // Idempotency: one Printful order per Stripe session (external_id is derived from session.id).
  const existing = await printful(env, `/orders/@${externalId}`);
  if (existing.ok && existing.data?.result?.id) {
    console.log(
      "[stripe-webhook] Printful order already exists, skipping",
      session?.id,
      "printful_id=",
      existing.data.result.id,
    );
    return;
  }
  if (!existing.ok && existing.status !== 404) {
    // Unknown state (Printful down / auth). Throw so Stripe retries instead of risking a duplicate.
    throw new Error(`Printful lookup failed (${existing.status}) for ${session?.id}`);
  }

  const recipient: Record<string, string> = {
    name: String(name),
    address1: String(addr.line1),
    city: String(addr.city),
    country_code: String(addr.country),
    zip: String(addr.postal_code),
  };
  if (addr.line2) recipient.address2 = String(addr.line2);
  if (addr.state) recipient.state_code = String(addr.state);
  if (email) recipient.email = String(email);
  if (session.customer_details?.phone) recipient.phone = String(session.customer_details.phone);

  const body = {
    external_id: externalId,
    shipping: "STANDARD",
    recipient,
    items: cart.map((c) => ({
      sync_variant_id: c.sync_variant_id,
      quantity: c.qty,
    })),
    packing_slip: {
      email: "support@naturestickers.shop",
      message: "Thank you for supporting Nature Stickers.",
      store_name: "Nature Stickers",
      custom_order_id: String(session.id).slice(0, 64),
    },
  };

  // confirm=true → submit for fulfillment. No update_existing: a duplicate external_id is
  // rejected by Printful instead of modifying an order that already exists.
  const res = await printful(
    env,
    "/orders?confirm=true",
    { method: "POST", body: JSON.stringify(body) },
  );

  if (!res.ok) {
    console.error(
      "[stripe-webhook] Printful order failed",
      session?.id,
      res.status,
      JSON.stringify(res.data)?.slice(0, 500),
    );
    return;
  }
  console.log(
    "[stripe-webhook] Printful order ok",
    session?.id,
    "printful_id=",
    res.data?.result?.id,
    "status=",
    res.data?.result?.status,
  );
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const env = context.env;
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "STRIPE_WEBHOOK_SECRET not configured" }, 503);
  }

  const rawBody = await context.request.text();
  const sig = context.request.headers.get("Stripe-Signature");
  const verified = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!verified.ok) {
    return json({ error: verified.error }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const session = event.data?.object;
  let fulfill = false;

  if (event.type === "checkout.session.completed") {
    if (session?.payment_status === "paid") {
      fulfill = true;
    } else {
      // e.g. bank debits: Stripe sends checkout.session.async_payment_succeeded once funds clear.
      console.log(
        "[stripe-webhook] session completed but not paid yet, skipping fulfillment",
        session?.id,
        "payment_status=",
        session?.payment_status,
      );
    }
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    if (session?.payment_status === "paid") {
      fulfill = true;
    } else {
      console.warn(
        "[stripe-webhook] async_payment_succeeded but payment_status is not paid, skipping",
        session?.id,
        "payment_status=",
        session?.payment_status,
      );
    }
  } else if (event.type === "checkout.session.async_payment_failed") {
    console.warn("[stripe-webhook] async payment failed, not fulfilling", session?.id);
  }

  if (fulfill) {
    try {
      await createPrintfulOrder(env, session);
    } catch (err) {
      console.error("[stripe-webhook] handler error", err);
      // Return 500 so Stripe retries
      return json({ error: "Fulfillment error" }, 500);
    }
  }

  return json({ received: true });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
};
