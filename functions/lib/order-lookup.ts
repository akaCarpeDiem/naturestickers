/**
 * Privacy-preserving order lookup.
 *
 * Customers can ask Stripe to email a fresh receipt. The HTTP response is a fixed
 * sentence either way, so the endpoint cannot be used to learn whether an email
 * or order number exists. Nothing from the Stripe object (name, address, phone,
 * card, line items, receipt URL) is copied into the response or into logs.
 *
 * Order numbers we accept:
 * - Checkout Session id (`cs_live_…` / `cs_test_…`), including the id in the
 *   /thanks?session_id= return URL
 * - Packing-slip id: the last PACKING_SLIP_TAIL characters of that session id
 *   (Printful's custom_order_id). Also a longer unique suffix, or a `cs_` prefix
 *   of at least that many characters.
 * - Stripe receipt number printed on the receipt email (digits-hyphen-digits)
 * - PaymentIntent (`pi_`) or Charge (`ch_` / `py_`) id
 * - Checkout email. Up to MAX_SENDS most recent paid shop checkouts. Each one
 *   gets its own Stripe receipt email, sent only to the address already on that
 *   checkout — never to a different address typed into the form.
 *
 * Email goes out through Stripe. A receipt is sent when `receipt_email` on the
 * Charge changes, so when it is already the checkout address we clear it and set
 * the same address again. There is no other mail provider in this project.
 */

export const PACKING_SLIP_TAIL = 20;
export const MAX_SENDS = 5;
export const SCAN_PAGES = 5;
export const SCAN_PAGE_SIZE = 100;
export const EMAIL_PAGES = 3;
export const EMAIL_PAGE_SIZE = 10;
/** Full Checkout Session ids are longer than a packing-slip prefix. Try a direct retrieve first. */
export const DIRECT_SESSION_MIN = 60;

export const GENERIC_MESSAGE =
  "If we find a matching order, we’ll email the details to the address on file.";
export const EMPTY_MESSAGE = "Enter an order number or the email you used at checkout.";
export const RATE_LIMIT_MESSAGE = "Please wait a little while and try again.";
export const UNAVAILABLE_MESSAGE =
  "Order lookup is temporarily unavailable. Email support@naturestickers.shop and we’ll help.";
export const FORBIDDEN_MESSAGE =
  "Couldn’t send that from this page. Email support@naturestickers.shop and we’ll help.";

export const DEFAULT_LIMITS = { ipPerHour: 8, keyPerHour: 4, windowMs: 60 * 60 * 1000 };

const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
const SESSION_RE = /^cs_(?:live|test)_[A-Za-z0-9]+$/;
const PI_RE = /^pi_[A-Za-z0-9]+$/;
const CHARGE_RE = /^(?:ch|py)_[A-Za-z0-9]+$/;
const RECEIPT_RE = /^\d{4,}-\d{4,}$/;

export type StripeResult = { ok: boolean; status: number; data: any };

export interface StripeClient {
  get(path: string): Promise<StripeResult>;
  form(path: string, params: URLSearchParams): Promise<StripeResult>;
}

export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

export type LookupLimits = { ipPerHour: number; keyPerHour: number; windowMs: number };

export type LookupKind =
  | { kind: "email"; email: string }
  | { kind: "session"; id: string }
  | { kind: "payment_intent"; id: string }
  | { kind: "charge"; id: string }
  | { kind: "receipt"; number: string }
  | { kind: "fragment"; fragment: string }
  | { kind: "ignore" };

type PublicMessage =
  | typeof GENERIC_MESSAGE
  | typeof EMPTY_MESSAGE
  | typeof RATE_LIMIT_MESSAGE
  | typeof UNAVAILABLE_MESSAGE
  | typeof FORBIDDEN_MESSAGE;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function prepareLookupInput(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const sid = new URL(trimmed).searchParams.get("session_id");
      if (sid && SESSION_RE.test(sid.trim())) return sid.trim();
    } catch {
      /* not a URL we can read; fall through */
    }
  }
  return trimmed.replace(/^receipt\s*#?\s*/i, "").replace(/^#/, "").trim();
}

export function classifyLookup(raw: string): LookupKind {
  const prepared = prepareLookupInput(raw);
  if (!prepared || prepared.length > 200) return { kind: "ignore" };
  if (prepared.includes("@")) {
    const email = normalizeEmail(prepared);
    if (email.length > 254 || !EMAIL_RE.test(email)) return { kind: "ignore" };
    return { kind: "email", email };
  }
  const compact = prepared.replace(/\s+/g, "");
  if (SESSION_RE.test(compact)) {
    if (compact.length >= DIRECT_SESSION_MIN) return { kind: "session", id: compact };
    if (compact.length >= PACKING_SLIP_TAIL) return { kind: "fragment", fragment: compact };
    return { kind: "ignore" };
  }
  if (PI_RE.test(compact) && compact.length >= 20 && compact.length <= 80) {
    return { kind: "payment_intent", id: compact };
  }
  if (CHARGE_RE.test(compact) && compact.length >= 20 && compact.length <= 80) {
    return { kind: "charge", id: compact };
  }
  if (RECEIPT_RE.test(compact)) return { kind: "receipt", number: compact };
  if (/^[A-Za-z0-9]+$/.test(compact) && compact.length >= PACKING_SLIP_TAIL && compact.length <= 64) {
    return { kind: "fragment", fragment: compact };
  }
  return { kind: "ignore" };
}

/** True when `fragment` is this Checkout Session's id, a cs_ prefix, or its packing-slip tail. */
export function sessionMatchesFragment(sessionId: string, fragment: string): boolean {
  if (!SESSION_RE.test(sessionId)) return false;
  // Session ids include underscores in the cs_live_ / cs_test_ prefix.
  if (!/^[A-Za-z0-9_]+$/.test(fragment)) return false;
  if (fragment.length < PACKING_SLIP_TAIL || fragment.length > 80) return false;
  if (sessionId === fragment) return true;
  if (
    (fragment.startsWith("cs_live_") || fragment.startsWith("cs_test_")) &&
    sessionId.startsWith(fragment)
  ) {
    return true;
  }
  if (fragment.length <= 40 && sessionId.endsWith(fragment)) return true;
  return false;
}

export function isShopSession(session: any): boolean {
  if (!session || session.object !== "checkout.session") return false;
  if (session.mode && session.mode !== "payment") return false;
  if (session.payment_status !== "paid") return false;
  const source = session.metadata?.source;
  const cart = session.metadata?.cart;
  return source === "naturestickers" || (typeof cart === "string" && cart.length > 0);
}

export function rawEmailOnSession(session: any): string {
  const raw = session?.customer_details?.email || session?.customer_email || "";
  return String(raw).trim();
}

export function emailOnSession(session: any): string {
  return normalizeEmail(rawEmailOnSession(session));
}

export function originAllowed(originHeader: string | null, refererHeader: string | null): boolean {
  const raw = originHeader || originFromReferer(refererHeader);
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (local) return url.protocol === "http:" || url.protocol === "https:";
  if (url.protocol !== "https:") return false;
  if (host === "naturestickers.shop" || host === "www.naturestickers.shop") return true;
  if (host === "naturestickers.pages.dev" || host.endsWith(".naturestickers.pages.dev")) return true;
  return false;
}

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf && cf.trim()) return cf.trim().slice(0, 80);
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hop = xff.split(",")[0]?.trim();
    if (hop) return hop.slice(0, 80);
  }
  return "unknown";
}

export function rateLimitMaterial(query: string): string {
  const kind = classifyLookup(query);
  switch (kind.kind) {
    case "email":
      return `e:${kind.email}`;
    case "session":
      return `s:${kind.id}`;
    case "payment_intent":
      return `p:${kind.id}`;
    case "charge":
      return `c:${kind.id}`;
    case "receipt":
      return `r:${kind.number}`;
    case "fragment":
      return `f:${kind.fragment}`;
    default:
      return `x:${prepareLookupInput(query).slice(0, 200).toLowerCase()}`;
  }
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function consumeLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<boolean> {
  const raw = await store.get(key);
  let start = now;
  let n = 0;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.start === "number" &&
        typeof parsed.n === "number" &&
        now - parsed.start < windowMs
      ) {
        start = parsed.start;
        n = parsed.n;
      }
    } catch {
      /* treat a corrupt bucket as a fresh window */
    }
  }
  if (n >= limit) return false;
  const ttlSec = Math.max(60, Math.ceil(windowMs / 1000) + 120);
  await store.put(key, JSON.stringify({ start, n: n + 1 }), { expirationTtl: ttlSec });
  return true;
}

export function kvRateLimitStore(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}): RateLimitStore {
  return {
    get: (key) => kv.get(key),
    put: (key, value, options) => kv.put(key, value, options),
  };
}

const memoryBuckets = new Map<string, { value: string; exp: number }>();

/** Per-isolate fallback when Workers KV is not bound (local dev). */
export function memoryRateLimitStore(): RateLimitStore {
  return {
    async get(key) {
      const row = memoryBuckets.get(key);
      if (!row) return null;
      if (row.exp <= Date.now()) {
        memoryBuckets.delete(key);
        return null;
      }
      return row.value;
    },
    async put(key, value, options) {
      memoryBuckets.set(key, { value, exp: Date.now() + options.expirationTtl * 1000 });
      if (memoryBuckets.size > 5000) {
        const oldest = memoryBuckets.keys().next().value;
        if (oldest) memoryBuckets.delete(oldest);
      }
    },
  };
}

function wantsHtml(request: Request): boolean {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return false;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    if (c === "&") return "&amp;";
    if (c === "<") return "&lt;";
    if (c === ">") return "&gt;";
    if (c === '"') return "&quot;";
    return "&#39;";
  });
}

function respond(request: Request, status: number, message: PublicMessage, ok: boolean, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra,
  };
  if (wantsHtml(request)) {
    const safe = escapeHtml(message);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Order lookup — Nature Stickers</title>
<link rel="stylesheet" href="/src/style.css" />
<link rel="stylesheet" href="/src/night.css" />
</head>
<body class="page-night">
<main class="legal"><div class="wrap">
<p class="eyebrow">Order lookup</p>
<h1>Order lookup</h1>
<p>${safe}</p>
<p><a href="/order">Back to order lookup</a></p>
<p>Still need help? <a href="mailto:support@naturestickers.shop">support@naturestickers.shop</a></p>
</div></main>
</body>
</html>`;
    return new Response(html, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  }
  return new Response(JSON.stringify({ ok, message }), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}

type Submission = { kind: "empty" } | { kind: "invalid" } | { kind: "query"; query: string };

function submissionFromQuery(q: unknown): Submission {
  if (typeof q !== "string" || !q.trim()) return { kind: "empty" };
  if (q.length > 500) return { kind: "invalid" };
  return { kind: "query", query: q };
}

function readJson(text: string): Submission {
  if (text.length > 4000) return { kind: "invalid" };
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: "invalid" };
  }
  return submissionFromQuery(body?.query ?? body?.lookup);
}

async function readSubmission(request: Request): Promise<Submission> {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { kind: "invalid" };
    }
    return submissionFromQuery(form.get("query") ?? form.get("lookup"));
  }
  return readJson(await request.text());
}

async function underLimit(
  store: RateLimitStore,
  request: Request,
  material: string,
  limits: LookupLimits,
  now: number,
): Promise<boolean> {
  try {
    const ip = await sha256(`ip:${clientIp(request)}`);
    const key = await sha256(`key:${material}`);
    const ipOk = await consumeLimit(store, `order-lookup/v1/ip/${ip}`, limits.ipPerHour, limits.windowMs, now);
    if (!ipOk) return false;
    const keyOk = await consumeLimit(store, `order-lookup/v1/key/${key}`, limits.keyPerHour, limits.windowMs, now);
    return keyOk;
  } catch (err) {
    console.error("[order-lookup] rate limit unavailable", err instanceof Error ? err.name : "error");
    return true;
  }
}

function sessionsPath(params: Record<string, string>, expand?: string): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, v);
  if (expand) q.append("expand[]", expand);
  return `/v1/checkout/sessions?${q.toString()}`;
}

async function listSessions(
  stripe: StripeClient,
  params: Record<string, string>,
  expand?: string,
): Promise<{ ok: boolean; sessions: any[]; hasMore: boolean }> {
  const res = await stripe.get(sessionsPath(params, expand));
  if (!res.ok) return { ok: false, sessions: [], hasMore: false };
  const sessions = Array.isArray(res.data?.data) ? res.data.data : [];
  return { ok: true, sessions, hasMore: Boolean(res.data?.has_more) };
}

async function findByEmail(stripe: StripeClient, email: string): Promise<any[]> {
  const found: any[] = [];
  let startingAfter = "";
  for (let page = 0; page < EMAIL_PAGES && found.length < MAX_SENDS; page++) {
    const params: Record<string, string> = {
      status: "complete",
      limit: String(EMAIL_PAGE_SIZE),
      "customer_details[email]": email,
    };
    if (startingAfter) params.starting_after = startingAfter;
    const listed = await listSessions(stripe, params, "data.payment_intent.latest_charge");
    if (!listed.ok) break;
    for (const session of listed.sessions) {
      if (!isShopSession(session) || emailOnSession(session) !== email) continue;
      found.push(session);
      if (found.length >= MAX_SENDS) break;
    }
    if (!listed.hasMore || listed.sessions.length === 0) break;
    startingAfter = String(listed.sessions[listed.sessions.length - 1]?.id || "");
    if (!startingAfter) break;
  }
  return found;
}

async function findByFragment(stripe: StripeClient, fragment: string): Promise<any[]> {
  const matches: any[] = [];
  let startingAfter = "";
  for (let page = 0; page < SCAN_PAGES && matches.length < 2; page++) {
    const params: Record<string, string> = { status: "complete", limit: String(SCAN_PAGE_SIZE) };
    if (startingAfter) params.starting_after = startingAfter;
    const listed = await listSessions(stripe, params);
    if (!listed.ok) break;
    for (const session of listed.sessions) {
      if (!sessionMatchesFragment(String(session.id || ""), fragment)) continue;
      if (!isShopSession(session)) continue;
      matches.push(session);
      if (matches.length >= 2) break;
    }
    if (!listed.hasMore || listed.sessions.length === 0) break;
    startingAfter = String(listed.sessions[listed.sessions.length - 1]?.id || "");
    if (!startingAfter) break;
  }
  if (matches.length !== 1 || typeof matches[0]?.id !== "string") return [];
  const full = await stripe.get(
    `/v1/checkout/sessions/${encodeURIComponent(matches[0].id)}?expand[]=payment_intent.latest_charge`,
  );
  if (!full.ok || !isShopSession(full.data)) return [];
  return [full.data];
}

async function findBySessionId(stripe: StripeClient, id: string): Promise<any[]> {
  const full = await stripe.get(
    `/v1/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge`,
  );
  if (full.ok && isShopSession(full.data)) return [full.data];
  if (full.status === 404) return findByFragment(stripe, id);
  return [];
}

async function findByPaymentIntent(stripe: StripeClient, paymentIntentId: string): Promise<any[]> {
  const listed = await listSessions(
    stripe,
    { payment_intent: paymentIntentId, limit: "5" },
    "data.payment_intent.latest_charge",
  );
  if (!listed.ok) return [];
  return listed.sessions.filter((session) => isShopSession(session)).slice(0, 1);
}

async function findByCharge(stripe: StripeClient, chargeId: string): Promise<any[]> {
  const got = await stripe.get(`/v1/charges/${encodeURIComponent(chargeId)}`);
  if (!got.ok || got.data?.status !== "succeeded") return [];
  const pi = typeof got.data.payment_intent === "string" ? got.data.payment_intent : got.data.payment_intent?.id;
  if (typeof pi !== "string" || !pi) return [];
  return findByPaymentIntent(stripe, pi);
}

async function findByReceipt(stripe: StripeClient, number: string): Promise<any[]> {
  let startingAfter = "";
  for (let page = 0; page < SCAN_PAGES; page++) {
    const q = new URLSearchParams({ limit: String(SCAN_PAGE_SIZE) });
    if (startingAfter) q.set("starting_after", startingAfter);
    const res = await stripe.get(`/v1/charges?${q.toString()}`);
    if (!res.ok) return [];
    const data = Array.isArray(res.data?.data) ? res.data.data : [];
    for (const charge of data) {
      if (String(charge?.receipt_number || "") !== number) continue;
      if (charge?.status !== "succeeded") return [];
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (typeof pi !== "string" || !pi) return [];
      return findByPaymentIntent(stripe, pi);
    }
    if (!res.data?.has_more || data.length === 0) break;
    startingAfter = String(data[data.length - 1]?.id || "");
    if (!startingAfter) break;
  }
  return [];
}

function chargeIdOf(latest: any): string | null {
  if (typeof latest === "string" && latest) return latest;
  if (latest && typeof latest === "object" && typeof latest.id === "string") return latest.id;
  return null;
}

async function resolveChargeId(stripe: StripeClient, session: any): Promise<string | null> {
  const pi = session?.payment_intent;
  if (pi && typeof pi === "object") {
    const expanded = chargeIdOf(pi.latest_charge);
    if (expanded) return expanded;
    if (typeof pi.id === "string") return chargeIdFromPaymentIntent(stripe, pi.id);
  }
  if (typeof pi === "string") return chargeIdFromPaymentIntent(stripe, pi);
  return null;
}

async function chargeIdFromPaymentIntent(stripe: StripeClient, id: string): Promise<string | null> {
  const got = await stripe.get(`/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge`);
  if (!got.ok) return null;
  return chargeIdOf(got.data?.latest_charge);
}

/**
 * Ask Stripe to email a receipt to `destRaw`. `destRaw` must already be the
 * address on the checkout. If the charge receipt is aimed at someone else, skip.
 * Stripe only emails when receipt_email changes, so an address that is already
 * set is cleared and written back.
 */
export async function resendReceipt(
  stripe: StripeClient,
  chargeId: string,
  destNormalized: string,
  destRaw: string,
): Promise<"sent" | "skipped" | "failed"> {
  if (!destNormalized || normalizeEmail(destRaw) !== destNormalized) return "skipped";
  const got = await stripe.get(`/v1/charges/${encodeURIComponent(chargeId)}`);
  if (!got.ok || !got.data) return "failed";
  if (got.data.status !== "succeeded") return "skipped";
  const currentRaw = String(got.data.receipt_email || "").trim();
  const current = normalizeEmail(currentRaw);
  if (current && current !== destNormalized) return "skipped";
  const exact = currentRaw || destRaw;
  if (normalizeEmail(exact) !== destNormalized) return "skipped";
  const path = `/v1/charges/${encodeURIComponent(chargeId)}`;
  if (!current) {
    const set = await stripe.form(path, new URLSearchParams({ receipt_email: exact }));
    return set.ok ? "sent" : "failed";
  }
  const clear = await stripe.form(path, new URLSearchParams({ receipt_email: "" }));
  if (!clear.ok) return "failed";
  const set = await stripe.form(path, new URLSearchParams({ receipt_email: exact }));
  if (set.ok) return "sent";
  await stripe.form(path, new URLSearchParams({ receipt_email: exact }));
  return "failed";
}

async function sendForSessions(stripe: StripeClient, sessions: any[]): Promise<number> {
  let sent = 0;
  const seen = new Set<string>();
  for (const session of sessions.slice(0, MAX_SENDS)) {
    const dest = emailOnSession(session);
    const raw = rawEmailOnSession(session);
    if (!dest) continue;
    const chargeId = await resolveChargeId(stripe, session);
    if (!chargeId || seen.has(chargeId)) continue;
    seen.add(chargeId);
    const result = await resendReceipt(stripe, chargeId, dest, raw);
    if (result === "sent") sent += 1;
  }
  return sent;
}

async function lookup(stripe: StripeClient, kind: LookupKind): Promise<any[]> {
  switch (kind.kind) {
    case "email":
      return findByEmail(stripe, kind.email);
    case "session":
      return findBySessionId(stripe, kind.id);
    case "payment_intent":
      return findByPaymentIntent(stripe, kind.id);
    case "charge":
      return findByCharge(stripe, kind.id);
    case "receipt":
      return findByReceipt(stripe, kind.number);
    case "fragment":
      return findByFragment(stripe, kind.fragment);
    default:
      return [];
  }
}

export async function handleOrderLookup(
  request: Request,
  deps: {
    stripe: StripeClient | null;
    store: RateLimitStore;
    now?: number;
    limits?: LookupLimits;
  },
): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return respond(request, 405, FORBIDDEN_MESSAGE, false, { allow: "POST" });
    }
    if (!originAllowed(request.headers.get("origin"), request.headers.get("referer"))) {
      return respond(request, 403, FORBIDDEN_MESSAGE, false);
    }
    const parsed = await readSubmission(request);
    if (parsed.kind === "empty") return respond(request, 400, EMPTY_MESSAGE, false);

    const now = deps.now ?? Date.now();
    const limits = deps.limits ?? DEFAULT_LIMITS;
    const material = parsed.kind === "query" ? rateLimitMaterial(parsed.query) : "invalid";
    const allowed = await underLimit(deps.store, request, material, limits, now);
    if (!allowed) return respond(request, 429, RATE_LIMIT_MESSAGE, false, { "retry-after": "3600" });

    if (parsed.kind === "invalid") return respond(request, 200, GENERIC_MESSAGE, true);
    if (!deps.stripe) return respond(request, 503, UNAVAILABLE_MESSAGE, false);

    const kind = classifyLookup(parsed.query);
    if (kind.kind === "ignore") return respond(request, 200, GENERIC_MESSAGE, true);

    const sessions = await lookup(deps.stripe, kind);
    const sent = await sendForSessions(deps.stripe, sessions);
    console.log("[order-lookup]", kind.kind, "matched", sessions.length, "sent", sent);
    return respond(request, 200, GENERIC_MESSAGE, true);
  } catch (err) {
    console.error("[order-lookup] failed", err instanceof Error ? err.name : "error");
    return respond(request, 200, GENERIC_MESSAGE, true);
  }
}
