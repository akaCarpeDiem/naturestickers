import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DIRECT_SESSION_MIN,
  GENERIC_MESSAGE,
  MAX_SENDS,
  PACKING_SLIP_TAIL,
  SCAN_PAGES,
  classifyLookup,
  handleOrderLookup,
  isShopSession,
  sessionMatchesFragment,
  type RateLimitStore,
  type StripeClient,
  type StripeResult,
} from "./order-lookup.ts";

const EMAIL = "buyer-fixture@example.com";
const RAW_EMAIL = "Buyer-Fixture@Example.com";
const NAME = "Fixture Name";
const ADDR = "100 Fixture Road";
const PHONE = "+15555550199";
const RECEIPT_URL = "https://pay.stripe.com/receipts/payment/FIXTURETOKEN";
const LAST4 = "9876";
const TAIL = "0123456789abcdefghij";
const OTHER = "other-fixture@example.com";

function sessionId(mid: string, tail = TAIL): string {
  assert.equal(tail.length, PACKING_SLIP_TAIL);
  assert.equal(mid.length, 1);
  const id = `cs_live_${mid.repeat(38)}${tail}`;
  assert.equal(id.length, 66);
  assert.ok(id.length >= DIRECT_SESSION_MIN);
  return id;
}

const SID = sessionId("Q");

function piiCharge(id: string, receiptEmail: string | null) {
  return {
    id,
    object: "charge",
    status: "succeeded",
    paid: true,
    receipt_email: receiptEmail,
    receipt_url: RECEIPT_URL,
    receipt_number: "1111-2222",
    billing_details: { name: NAME, email: EMAIL, phone: PHONE, address: { line1: ADDR } },
    payment_method_details: { card: { last4: LAST4 } },
    payment_intent: "pi_fixtureintent0123456",
  };
}

function shopSession(overrides: Record<string, any> = {}) {
  const charge = piiCharge("ch_fixturecharge012345", RAW_EMAIL);
  return {
    id: SID,
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    metadata: { source: "naturestickers", cart: "557x1" },
    customer_details: {
      email: RAW_EMAIL,
      name: NAME,
      phone: PHONE,
      address: { line1: ADDR, city: "Hidden", state: "WA", postal_code: "00000", country: "US" },
    },
    payment_intent: { id: "pi_fixtureintent0123456", latest_charge: charge },
    ...overrides,
  };
}

type Call = { method: "GET" | "POST"; path: string; body?: string };

function store(): RateLimitStore {
  const rows = new Map<string, string>();
  return {
    get: async (key) => rows.get(key) ?? null,
    put: async (key, value) => {
      rows.set(key, value);
    },
  };
}

function client(route: (call: Call) => StripeResult): { stripe: StripeClient; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    stripe: {
      async get(path) {
        const call = { method: "GET" as const, path };
        calls.push(call);
        return route(call);
      },
      async form(path, params) {
        const call = { method: "POST" as const, path, body: params.toString() };
        calls.push(call);
        return route(call);
      },
    },
  };
}

function post(query: string, headers: Record<string, string> = {}) {
  return new Request("https://naturestickers.shop/api/order-lookup", {
    method: "POST",
    headers: {
      origin: "https://naturestickers.shop",
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.10",
      ...headers,
    },
    body: JSON.stringify({ query }),
  });
}

const openLimits = { ipPerHour: 30, keyPerHour: 30, windowMs: 60 * 60 * 1000 };
const now = 1_700_000_000_000;

function run(request: Request, stripe: StripeClient | null, limits = openLimits, rate = store()) {
  return handleOrderLookup(request, { stripe, store: rate, now, limits });
}

async function bodyText(res: Response): Promise<string> {
  const text = await res.text();
  const banned = [
    EMAIL,
    RAW_EMAIL,
    OTHER,
    NAME,
    ADDR,
    PHONE,
    "FIXTURETOKEN",
    LAST4,
    "1111-2222",
    TAIL,
    "cs_live_",
    "pi_fixture",
    "ch_fixture",
    "receipt_url",
    "customer_details",
    "billing_details",
    "line1",
    "Hidden",
  ];
  for (const secret of banned) {
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `response leaked ${secret}: ${text}`);
  }
  return text;
}

function posts(calls: Call[]): URLSearchParams[] {
  return calls.filter((c) => c.method === "POST").map((c) => new URLSearchParams(c.body || ""));
}

describe("classify and match", () => {
  it("recognizes the packing-slip tail, a session prefix, a receipt number, and an email", () => {
    assert.equal(PACKING_SLIP_TAIL, 20);
    assert.equal(classifyLookup(TAIL).kind, "fragment");
    assert.equal(classifyLookup(SID).kind, "session");
    // A 64-character cs_ prefix is long enough to try a direct retrieve, then a scan if Stripe 404s.
    assert.equal(classifyLookup(SID.slice(0, 64)).kind, "session");
    assert.equal(classifyLookup("Receipt #1111-2222").kind, "receipt");
    assert.equal(classifyLookup(`  ${RAW_EMAIL} `).kind, "email");
    assert.deepEqual(classifyLookup(`https://naturestickers.shop/thanks?session_id=${SID}`), {
      kind: "session",
      id: SID,
    });
    assert.equal(classifyLookup("nope").kind, "ignore");
    assert.equal(sessionMatchesFragment(SID, TAIL), true);
    assert.equal(sessionMatchesFragment(SID, SID.slice(0, 64)), true);
    assert.equal(sessionMatchesFragment(SID, SID), true);
    assert.equal(sessionMatchesFragment(SID, "short"), false);
    assert.equal(sessionMatchesFragment(sessionId("Z", "zzzzzzzzzzzzzzzzzzzz"), TAIL), false);
  });

  it("treats paid shop checkouts as ours and ignores everything else", () => {
    assert.equal(isShopSession(shopSession()), true);
    assert.equal(isShopSession(shopSession({ metadata: { cart: "1x1" } })), true);
    assert.equal(isShopSession(shopSession({ metadata: { source: "other" } })), false);
    assert.equal(isShopSession(shopSession({ payment_status: "unpaid" })), false);
  });
});

describe("handleOrderLookup", () => {
  it("returns the same public JSON when an email matches and when it does not", async () => {
    const found = client((call) => {
      if (call.method === "GET" && call.path.includes("/v1/checkout/sessions?")) {
        return { ok: true, status: 200, data: { data: [shopSession()], has_more: false } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        return { ok: true, status: 200, data: piiCharge("ch_fixturecharge012345", RAW_EMAIL) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: { receipt_email: RAW_EMAIL, receipt_url: RECEIPT_URL } };
      return { ok: false, status: 404, data: { error: { message: EMAIL } } };
    });
    const missing = client((call) => {
      if (call.path.includes("/v1/checkout/sessions?")) return { ok: true, status: 200, data: { data: [], has_more: false } };
      return { ok: false, status: 500, data: { error: { message: NAME } } };
    });

    const yes = await run(post(RAW_EMAIL), found.stripe);
    const no = await run(post("missing-fixture@example.com"), missing.stripe);
    assert.equal(yes.status, 200);
    assert.equal(no.status, 200);
    const yesText = await bodyText(yes);
    const noText = await bodyText(no);
    assert.equal(yesText, noText);
    assert.equal(noText.includes("missing-fixture"), false);
    assert.deepEqual(JSON.parse(yesText), { ok: true, message: GENERIC_MESSAGE });
    assert.equal(yes.headers.get("cache-control"), "no-store");

    const sets = posts(found.calls).map((p) => p.get("receipt_email"));
    assert.deepEqual(sets, ["", RAW_EMAIL]);
    assert.equal(missing.calls.some((c) => c.method === "POST"), false);
  });

  it("sets receipt_email once when Stripe has not stored one yet", async () => {
    const api = client((call) => {
      if (call.method === "GET" && call.path.includes("/v1/checkout/sessions?")) {
        const session = shopSession();
        session.payment_intent.latest_charge.receipt_email = null;
        return { ok: true, status: 200, data: { data: [session], has_more: false } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        return { ok: true, status: 200, data: piiCharge("ch_fixturecharge012345", null) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: {} };
      return { ok: false, status: 404, data: {} };
    });
    const res = await run(post(EMAIL), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    assert.deepEqual(posts(api.calls).map((p) => p.get("receipt_email")), [RAW_EMAIL]);
  });

  it("does not retarget a charge whose receipt email is different", async () => {
    const api = client((call) => {
      if (call.method === "GET" && call.path.includes("/v1/checkout/sessions/" + encodeURIComponent(SID))) {
        return { ok: true, status: 200, data: shopSession() };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        return { ok: true, status: 200, data: piiCharge("ch_fixturecharge012345", OTHER) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: {} };
      return { ok: false, status: 404, data: {} };
    });
    const res = await run(post(SID), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    assert.equal(api.calls.some((c) => c.method === "POST"), false);
  });

  it("matches a packing-slip tail and a thanks-page session id without echoing them", async () => {
    const full = shopSession();
    const route = (call: Call): StripeResult => {
      if (call.method === "GET" && call.path.startsWith("/v1/checkout/sessions/" + encodeURIComponent(SID))) {
        return { ok: true, status: 200, data: full };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/checkout/sessions?")) {
        return { ok: true, status: 200, data: { data: [shopSession()], has_more: false } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        return { ok: true, status: 200, data: piiCharge("ch_fixturecharge012345", RAW_EMAIL) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: {} };
      return { ok: false, status: 404, data: {} };
    };
    const byTail = client(route);
    const tailRes = await run(post(TAIL), byTail.stripe);
    assert.equal(tailRes.status, 200);
    await bodyText(tailRes);
    assert.equal(byTail.calls.some((c) => c.path.startsWith("/v1/checkout/sessions/" + encodeURIComponent(SID))), true);
    assert.equal(posts(byTail.calls).length, 2);

    const byUrl = client(route);
    const urlRes = await run(post(`https://naturestickers.shop/thanks?session_id=${SID}`), byUrl.stripe);
    assert.equal(urlRes.status, 200);
    await bodyText(urlRes);
    assert.equal(byUrl.calls.some((c) => c.path.startsWith("/v1/checkout/sessions?")), false);
    assert.equal(posts(byUrl.calls).length, 2);
  });

  it("scans for a long session prefix when the direct retrieve 404s", async () => {
    const prefix = SID.slice(0, 64);
    const api = client((call) => {
      if (call.method === "GET" && call.path.startsWith(`/v1/checkout/sessions/${SID}`)) {
        return { ok: true, status: 200, data: shopSession() };
      }
      if (call.method === "GET" && call.path.startsWith(`/v1/checkout/sessions/${prefix}`)) {
        return { ok: false, status: 404, data: { error: { message: NAME } } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/checkout/sessions?")) {
        return { ok: true, status: 200, data: { data: [shopSession()], has_more: false } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        return { ok: true, status: 200, data: piiCharge("ch_fixturecharge012345", RAW_EMAIL) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: {} };
      return { ok: false, status: 404, data: {} };
    });
    const res = await run(post(prefix), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    assert.equal(posts(api.calls).length, 2);
  });

  it("sends nothing when two sessions share a fragment", async () => {
    const tail = "abcdefghabcdefghabcd";
    const a = shopSession({ id: sessionId("A", tail) });
    const b = shopSession({ id: sessionId("B", tail) });
    const api = client((call) => {
      if (call.path.startsWith("/v1/checkout/sessions?")) {
        return { ok: true, status: 200, data: { data: [a, b], has_more: false } };
      }
      return { ok: true, status: 200, data: {} };
    });
    const res = await run(post(tail), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    assert.equal(api.calls.some((c) => c.method === "POST" || c.path.includes("/v1/charges/")), false);
  });

  it("stops scanning after the page cap", async () => {
    const api = client((call) => {
      if (call.path.startsWith("/v1/checkout/sessions?")) {
        const page = api.calls.filter((c) => c.path.startsWith("/v1/checkout/sessions?")).length;
        return {
          ok: true,
          status: 200,
          data: {
            data: [shopSession({ id: sessionId("Z", `${"m".repeat(19)}${page}`) })],
            has_more: true,
          },
        };
      }
      return { ok: true, status: 200, data: {} };
    });
    const res = await run(post(TAIL), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    const lists = api.calls.filter((c) => c.path.startsWith("/v1/checkout/sessions?"));
    assert.equal(lists.length, SCAN_PAGES);
    assert.equal(api.calls.some((c) => c.method === "POST"), false);
  });

  it("emails at most the most recent shop checkouts for an address", async () => {
    const sessions = Array.from({ length: MAX_SENDS + 1 }, (_, i) => {
      const chargeId = `ch_fixturecharge01234${i}`;
      return shopSession({
        id: sessionId(String(i), `tailtailtailtail${String(i).padStart(4, "0")}`),
        payment_intent: { id: `pi_fixtureintent012345${i}`, latest_charge: piiCharge(chargeId, RAW_EMAIL) },
      });
    });
    const api = client((call) => {
      if (call.method === "GET" && call.path.includes("customer_details")) {
        return { ok: true, status: 200, data: { data: sessions, has_more: false } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        const id = call.path.split("/v1/charges/")[1];
        return { ok: true, status: 200, data: piiCharge(id, RAW_EMAIL) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: {} };
      return { ok: false, status: 404, data: {} };
    });
    const res = await run(post(EMAIL), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    const chargePosts = api.calls.filter((c) => c.method === "POST");
    const chargeIds = new Set(chargePosts.map((c) => c.path.split("/").pop()));
    assert.equal(chargeIds.size, MAX_SENDS);
  });

  it("looks up a Stripe receipt number, then only emails the shop checkout", async () => {
    const api = client((call) => {
      if (call.method === "GET" && call.path.startsWith("/v1/charges?")) {
        return {
          ok: true,
          status: 200,
          data: { data: [piiCharge("ch_fixturecharge012345", RAW_EMAIL)], has_more: false },
        };
      }
      if (call.method === "GET" && call.path.includes("payment_intent=")) {
        return { ok: true, status: 200, data: { data: [shopSession()], has_more: false } };
      }
      if (call.method === "GET" && call.path.startsWith("/v1/charges/")) {
        return { ok: true, status: 200, data: piiCharge("ch_fixturecharge012345", RAW_EMAIL) };
      }
      if (call.method === "POST") return { ok: true, status: 200, data: {} };
      return { ok: false, status: 404, data: {} };
    });
    const res = await run(post("Receipt #1111-2222"), api.stripe);
    assert.equal(res.status, 200);
    await bodyText(res);
    assert.equal(posts(api.calls).map((p) => p.get("receipt_email")).includes(RAW_EMAIL), true);
  });

  it("rate limits per lookup key and per IP without confirming a match", async () => {
    const limits = { ipPerHour: 5, keyPerHour: 2, windowMs: 60_000 };
    const rate = store();
    const api = client(() => ({ ok: true, status: 200, data: { data: [], has_more: false } }));
    const first = await run(post(EMAIL, { "cf-connecting-ip": "203.0.113.4" }), api.stripe, limits, rate);
    const second = await run(post(RAW_EMAIL, { "cf-connecting-ip": "203.0.113.4" }), api.stripe, limits, rate);
    const third = await run(post(EMAIL, { "cf-connecting-ip": "203.0.113.8" }), api.stripe, limits, rate);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    const text = await bodyText(third);
    assert.equal(JSON.parse(text).ok, false);
    assert.equal(text.includes(EMAIL), false);
    assert.equal(third.headers.get("retry-after"), "3600");

    const ipLimited = store();
    const ipApi = client(() => ({ ok: true, status: 200, data: { data: [], has_more: false } }));
    const ipLimits = { ipPerHour: 2, keyPerHour: 10, windowMs: 60_000 };
    await run(post("one-fixture@example.com"), ipApi.stripe, ipLimits, ipLimited);
    await run(post("two-fixture@example.com"), ipApi.stripe, ipLimits, ipLimited);
    const blocked = await run(post("three-fixture@example.com"), ipApi.stripe, ipLimits, ipLimited);
    assert.equal(blocked.status, 429);
    await bodyText(blocked);
  });

  it("allows the same key again after the window", async () => {
    const limits = { ipPerHour: 5, keyPerHour: 1, windowMs: 1000 };
    const rate = store();
    const api = client(() => ({ ok: true, status: 200, data: { data: [], has_more: false } }));
    const a = await handleOrderLookup(post(EMAIL), { stripe: api.stripe, store: rate, now: 10_000, limits });
    const b = await handleOrderLookup(post(EMAIL), { stripe: api.stripe, store: rate, now: 10_500, limits });
    const c = await handleOrderLookup(post(EMAIL), { stripe: api.stripe, store: rate, now: 11_000, limits });
    assert.equal(a.status, 200);
    assert.equal(b.status, 429);
    assert.equal(c.status, 200);
  });

  it("rejects a foreign origin before talking to Stripe", async () => {
    const api = client(() => ({ ok: true, status: 200, data: {} }));
    const res = await run(post(EMAIL, { origin: "https://evil.example" }), api.stripe);
    assert.equal(res.status, 403);
    await bodyText(res);
    assert.equal(api.calls.length, 0);

    const preview = await run(
      post(EMAIL, { origin: "https://feat.naturestickers.pages.dev" }),
      client(() => ({ ok: true, status: 200, data: { data: [], has_more: false } })).stripe,
    );
    assert.equal(preview.status, 200);
  });

  it("renders the same generic HTML for a no-JS form post and does not reflect the field", async () => {
    const empty = client(() => ({ ok: true, status: 200, data: { data: [], has_more: false } }));
    const req = new Request("https://naturestickers.shop/api/order-lookup", {
      method: "POST",
      headers: {
        origin: "https://naturestickers.shop",
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
        "cf-connecting-ip": "203.0.113.10",
      },
      body: new URLSearchParams({ query: EMAIL }).toString(),
    });
    const res = await run(req, empty.stripe);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const text = await bodyText(res);
    assert.match(text, /If we find a matching order/);
    assert.equal(text.includes(EMAIL), false);
  });

  it("asks for a value when the field is empty and stays quiet when Stripe is not configured", async () => {
    const empty = await run(post("   "), client(() => ({ ok: true, status: 200, data: {} })).stripe);
    assert.equal(empty.status, 400);
    const emptyText = await bodyText(empty);
    assert.match(emptyText, /Enter an order number/);

    const down = await run(post(EMAIL), null);
    assert.equal(down.status, 503);
    const downText = await bodyText(down);
    assert.match(downText, /support@naturestickers\.shop/);
    assert.equal(downText.includes(EMAIL), false);
  });
});
