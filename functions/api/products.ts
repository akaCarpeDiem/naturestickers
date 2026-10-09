import { json, methodNotAllowed, type Env } from "../lib/http";
import { edgeCache, getCatalog } from "../lib/catalog";

const CACHE_TTL_SEC = 60; // brief browser/edge cache of the response itself

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const catalog = await getCatalog(
    context.env,
    edgeCache(context.env, context.request.url),
    (p) => context.waitUntil(p),
  );
  if (!catalog.ok) {
    return json(
      { products: [], error: catalog.error || "Failed to load products" },
      catalog.status >= 400 ? catalog.status : 502,
    );
  }
  const body: Record<string, unknown> = { products: catalog.products };
  if (catalog.partial) body.partial = true; // shop page re-polls until complete
  return json(body, 200, {
    "cache-control": catalog.partial
      ? "no-store"
      : `public, max-age=${CACHE_TTL_SEC}, s-maxage=${CACHE_TTL_SEC}`,
    "x-catalog-source": catalog.source,
  });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed("GET");
};
