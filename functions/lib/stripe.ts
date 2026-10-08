import type { Env } from "./http";

/** PLACEHOLDER flat-rate shipping in USD cents. Replace with Printful shipping-rate lookup later. */
export const FLAT_SHIPPING_CENTS = 499; // $4.99 — PLACEHOLDER flat rate
export const FLAT_SHIPPING_LABEL = "Standard US shipping (placeholder flat rate)";

export function shippingCountries(env: Env): string[] {
  const raw = (env.SHIPPING_COUNTRIES || "US").trim();
  const list = raw
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return list.length ? list : ["US"];
}

export async function stripeForm(
  env: Env,
  path: string,
  params: URLSearchParams,
  method = "POST",
): Promise<{ ok: boolean; status: number; data: any }> {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, status: 503, data: { error: { message: "STRIPE_SECRET_KEY not configured" } } };
  }
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" || method === "DELETE" ? undefined : params,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function stripeGet(env: Env, path: string): Promise<{ ok: boolean; status: number; data: any }> {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, status: 503, data: { error: { message: "STRIPE_SECRET_KEY not configured" } } };
  }
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify Stripe-Signature header (t=...,v1=...) with Web Crypto HMAC-SHA256.
 * No Node-only libs.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSec = 300,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!signatureHeader) return { ok: false, error: "Missing Stripe-Signature header" };
  const parts: Record<string, string[]> = {};
  for (const piece of signatureHeader.split(",")) {
    const [k, v] = piece.split("=").map((s) => s.trim());
    if (!k || v == null) continue;
    (parts[k] ||= []).push(v);
  }
  const timestamp = parts.t?.[0];
  const v1s = parts.v1 || [];
  if (!timestamp || !v1s.length) return { ok: false, error: "Malformed Stripe-Signature header" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: "Invalid signature timestamp" };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSec) return { ok: false, error: "Signature timestamp outside tolerance" };

  const signed = `${timestamp}.${rawBody}`;
  const expect = await hmacSha256Hex(secret, signed);
  const match = v1s.some((sig) => timingSafeEqual(sig, expect));
  if (!match) return { ok: false, error: "Invalid signature" };
  return { ok: true };
}

export function dollarsToCents(price: string | number): number {
  const n = typeof price === "number" ? price : Number(price);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * 100);
}
