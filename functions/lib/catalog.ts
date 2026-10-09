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
 * Checkout always re-prices from Printful, so a briefly stale display price is never charged.
 */
import type { Env } from "./http";
import { listAllSummaries, printful, storeId, toCatalogProduct, type CatalogProduct } from "./printful";

export const CATALOG_TTL_MS = 10 * 60 * 1000; // refresh at most every 10 min
const STALE_KEEP_SEC = 7 * 24 * 60 * 60; // keep last good catalog a week for fallback
const SUBREQUEST_BUDGET = 45; // stay under the free plan's 50
const CACHE_OPS = 2; // one match + one put
const MAX_LIST_PAGES = 5; // up to 500 products
const DETAIL_CONCURRENCY = 5; // Workers allow 6 simultaneous connections

type Entry = { p: CatalogProduct | null; at: number };
export type StoredCatalog = {
  v: 1;
  builtAt: number;
  complete: boolean;
  order: number[];
  byId: Record<string, Entry>;
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
    if (e?.p) out.push(e.p);
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

  const list = await listAllSummaries(env, MAX_LIST_PAGES);
  if (!list.ok) {
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
  const budget = Math.max(0, SUBREQUEST_BUDGET - CACHE_OPS - list.pages);
  const toFetch = [...missing, ...stale].slice(0, budget);

  const byId: Record<string, Entry> = {};
  for (const id of order) if (prev[String(id)]) byId[String(id)] = prev[String(id)];

  await inBatches(toFetch, DETAIL_CONCURRENCY, async (id) => {
    const res = await printful(env, `/store/products/${id}`);
    if (res.ok) byId[String(id)] = { p: toCatalogProduct(res.data?.result, summaryById.get(id)), at: now() };
    // on failure keep the previous copy (if any); a missing one is retried next request
  });

  const complete = order.every((id) => byId[String(id)]);
  const next: StoredCatalog = { v: 1, builtAt: complete ? t0 : 0, complete, order, byId };
  waitUntil(cache.write(next));
  return { ok: true, status: 200, products: productsOf(next), partial: !complete, source: "rebuilt" };
}
