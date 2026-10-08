export type Env = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PRINTFUL_TOKEN?: string;
  PRINTFUL_STORE_ID?: string;
  /** Comma-separated ISO country codes for Stripe shipping_address_collection. Default: US */
  SHIPPING_COUNTRIES?: string;
  PUBLIC_ORIGIN?: string;
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function methodNotAllowed(allow: string) {
  return json({ error: "Method not allowed" }, 405, { allow });
}
