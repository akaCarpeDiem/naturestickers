/**
 * Cached, budgeted shop catalog.
 *
 * The Workers free plan allows 50 subrequests per invocation (fetch + Cache API
 * calls share that quota). Building the catalog naively costs 1 + N Printful calls,
 * which breaks past ~45 products. Instead:
 *   - the assembled catalog (plus per-product fetch times) lives in caches.default;
 *   - while it is fresh (CATALOG_TTL_MS) a request costs one cache read, no Printful calls;
 *   - when stale or incomplete, one rebuild lists every product id (paginated, 100/page)
 *     and refreshes at most the per-request budget of product details, missing ones first,
 *     then the oldest; the rest reuse the cached copy. A big store fills in over a few
 *     requests, and the response says `partial: true` until it has every product.
 *   - if Printful errors, the last cached catalog is served (stale fallback).
 *   - on a Printful 429 the rebuild stops and the cached copy records a short pause; until it
 *     passes, requests serve the cached list without calling Printful, leaving the shared
 *     120/min allowance for checkout and order creation.
 * Checkout always re-prices from Printful, so a briefly stale display price is never charged.
 *
 * Store: when the CATALOG_KV binding exists the catalog lives in Workers KV (one copy shared by
 * every data center, so one build serves the world); otherwise it falls back to caches.default,
 * which is per data center. With KV, a short lock key stops two data centers rebuilding at once.
 */
import type { Env } from "./http";
import { isHidden, listAllSummaries, printful, storeId, toCatalogProduct, type CatalogProduct } from "./printful";

export const CATALOG_TTL_MS = 10 * 60 * 1000; // refresh at most every 10 min
const STALE_KEEP_SEC = 7 * 24 * 60 * 60; // keep last good catalog a week for fallback
const SUBREQUEST_BUDGET = 45; // stay under the free plan's 50
const CACHE_OPS = 2; // one match + one put
const MAX_LIST_PAGES = 5; // up to 500 products
const DETAIL_CONCURRENCY = 5; // Workers allow 6 simultaneous connections
const RATE_LIMIT_PAUSE_MS = 60 * 1000; // Printful's limit is per rolling 60 s window
const LOCK_HOLD_MS = 20 * 1000; // a rebuild chunk takes a few seconds; after this others may rebuild
const KV_MIN_TTL_SEC = 60; // KV's minimum expirationTtl

type Entry = { p: CatalogProduct | null; at: number };
export type StoredCatalog = {
  v: 1;
  builtAt: number;
  complete: boolean;
  order: number[];
  byId: Record<string, Entry>;
  pausedUntil?: number; // set after a Printful 429: no Printful calls until then
};

export type CatalogResult = {
  ok: boolean;
  status: number;
  products: CatalogProduct[];
  partial: boolean;
  source: "cache" | "rebuilt" | "stale" | "error";
  error?: string;
};

export interface CatalogCache {
  read(): Promise<StoredCatalog | null>;
  write(c: StoredCatalog): Promise<void>;
  /** Subrequests this store spends per rebuild (reads + writes), taken out of the Printful budget. */
  ops?: number;
  /** Claim the rebuild; false when another request (any data center) is already rebuilding. */
  tryLock?(now: number): Promise<boolean>;
  /** Release the rebuild claim once the result is stored. */
  unlock?(): Promise<void>;
}

/** Workers KV store: one global catalog shared by every data center. */
export function kvCache(env: Env, kv: KVNamespace): CatalogCache {
  const key = `catalog/v1/${storeId(env)}`;
  const lockKey = `catalog-lock/v1/${storeId(env)}`;
  return {
    ops: 5, // catalog read, lock read + write + delete, catalog write
    async read() {
      try {
        const data = (await kv.get(key, "json")) as StoredCatalog | null;
        return data?.v === 1 ? data : null;
      } catch {
        return null;
      }
    },
    async write(c) {
      try {
        await kv.put(key, JSON.stringify(c), { expirationTtl: STALE_KEEP_SEC });
      } catch {
        /* best effort */
      }
    },
    async tryLock(now) {
      try {
        const held = (await kv.get(lockKey, "json")) as { until?: number } | null;
        if (held && Number(held.until) > now) return false;
        await kv.put(lockKey, JSON.stringify({ until: now + LOCK_HOLD_MS }), { expirationTtl: KV_MIN_TTL_SEC });
        return true;
      } catch {
        return true; // KV hiccup: rebuild rather than stall
      }
    },
    async unlock() {
      try {
        await kv.delete(lockKey);
      } catch {
        /* expires on its own */
      }
    },
  };
}

/** KV when bound, else today's per-data-center edge cache. */
export function catalogStore(env: Env, requestUrl: string): CatalogCache {
  return env.CATALOG_KV ? kvCache(env, env.CATALOG_KV) : edgeCache(env, requestUrl);
}

/** caches.default store keyed per Printful store id (falls back to no-op if unavailable). */
export function edgeCache(env: Env, requestUrl: string): CatalogCache {
  const key = new Request(`${new URL(requestUrl).origin}/__catalog-cache/v1/${storeId(env)}`);
  const cache: Cache | undefined = (globalThis as any).caches?.default;
  return {
    async read() {
      if (!cache) return null;
      try {
        const hit = await cache.match(key);
        if (!hit) return null;
        const data = (await hit.json()) as StoredCatalog;
        return data?.v === 1 ? data : null;
      } catch {
        return null;
      }
    },
    async write(c) {
      if (!cache) return;
      try {
        await cache.put(
          key,
          new Response(JSON.stringify(c), {
            headers: { "content-type": "application/json", "cache-control": `max-age=${STALE_KEEP_SEC}` },
          }),
        );
      } catch {
        /* cache is best effort */
      }
    },
  };
}

function productsOf(c: StoredCatalog): CatalogProduct[] {
  const out: CatalogProduct[] = [];
  for (const id of c.order) {
    const e = c.byId[String(id)];
    if (e?.p && !isHidden(e.p.id)) out.push(e.p);
  }
  return out;
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** Cached list while paused; with nothing cached yet it's an error, like a failed first build. */
function pausedResult(c: StoredCatalog): CatalogResult {
  const products = productsOf(c);
  if (!products.length) {
    return { ok: false, status: 503, products: [], partial: false, source: "error", error: "Printful is busy, try again in a minute" };
  }
  return { ok: true, status: 200, products, partial: !c.complete, source: "stale" };
}

export async function getCatalog(
  env: Env,
  cache: CatalogCache,
  waitUntil: (p: Promise<unknown>) => void = () => {},
  now: () => number = Date.now,
): Promise<CatalogResult> {
  const stored = await cache.read();
  const t0 = now();
  if (stored && stored.complete && t0 - stored.builtAt < CATALOG_TTL_MS) {
    return { ok: true, status: 200, products: productsOf(stored), partial: false, source: "cache" };
  }
  // Printful rate-limited a recent rebuild: serve the cached list without calling it.
  if (stored && (stored.pausedUntil || 0) > t0) return pausedResult(stored);
  // Another request is already rebuilding: serve what's stored (partial makes the shop re-poll).
  if (cache.tryLock && !(await cache.tryLock(t0))) {
    const products = stored ? productsOf(stored) : [];
    const complete = !!stored?.complete;
    return { ok: true, status: 200, products, partial: !complete, source: "stale" };
  }

  const save = (c: StoredCatalog | null) =>
    waitUntil((c ? cache.write(c) : Promise.resolve()).then(() => cache.unlock?.()));

  const list = await listAllSummaries(env, MAX_LIST_PAGES);
  if (!list.ok && list.status === 429) {
    console.warn("[catalog] Printful 429, pausing rebuild", "(product list)");
    const paused: StoredCatalog = stored
      ? { ...stored, pausedUntil: t0 + RATE_LIMIT_PAUSE_MS }
      : { v: 1, builtAt: 0, complete: false, order: [], byId: {}, pausedUntil: t0 + RATE_LIMIT_PAUSE_MS };
    save(paused);
    return pausedResult(paused);
  }
  if (!list.ok) {
    save(null);
    if (stored) {
      return { ok: true, status: 200, products: productsOf(stored), partial: !stored.complete, source: "stale" };
    }
    return { ok: false, status: list.status, products: [], partial: false, source: "error", error: list.error };
  }

  const summaries = list.summaries.filter((s) => s && !s.is_ignored && Number(s.id) > 0);
  const order = summaries.map((s) => Number(s.id));
  const summaryById = new Map(summaries.map((s) => [Number(s.id), s]));
  const prev = stored?.byId || {};

  // Missing products first, then the oldest refreshed, but only those past the TTL.
  const missing = order.filter((id) => !prev[String(id)]);
  const stale = order
    .filter((id) => prev[String(id)] && t0 - prev[String(id)].at >= CATALOG_TTL_MS)
    .sort((a, b) => prev[String(a)].at - prev[String(b)].at);
  const budget = Math.max(0, SUBREQUEST_BUDGET - (cache.ops ?? CACHE_OPS) - list.pages);
  const toFetch = [...missing, ...stale].slice(0, budget);

  const byId: Record<string, Entry> = {};
  for (const id of order) if (prev[String(id)]) byId[String(id)] = prev[String(id)];

  let rateLimited = false;
  await inBatches(toFetch, DETAIL_CONCURRENCY, async (id) => {
    if (rateLimited) return; // stop spending calls once Printful says 429
    const res = await printful(env, `/store/products/${id}`);
    if (res.ok) byId[String(id)] = { p: toCatalogProduct(res.data?.result, summaryById.get(id)), at: now() };
    else if (res.status === 429) rateLimited = true;
    // on failure keep the previous copy (if any); a missing one is retried next request
  });
  if (rateLimited) console.warn("[catalog] Printful 429, pausing rebuild", "(product details)");

  const complete = order.every((id) => byId[String(id)]);
  const next: StoredCatalog = { v: 1, builtAt: complete ? t0 : 0, complete, order, byId };
  if (rateLimited) next.pausedUntil = now() + RATE_LIMIT_PAUSE_MS;
  save(next);
  return { ok: true, status: 200, products: productsOf(next), partial: !complete, source: "rebuilt" };
}
