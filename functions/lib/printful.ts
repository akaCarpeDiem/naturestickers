import type { Env } from "./http";

const PRINTFUL_BASE = "https://api.printful.com";

export function storeId(env: Env): string {
  return (env.PRINTFUL_STORE_ID || "18863620").trim();
}

export async function printful(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  if (!env.PRINTFUL_TOKEN) {
    return { ok: false, status: 503, data: { error: "PRINTFUL_TOKEN not configured" } };
  }
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${env.PRINTFUL_TOKEN}`);
  headers.set("X-PF-Store-Id", storeId(env));
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${PRINTFUL_BASE}${path}`, { ...init, headers });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = { error: "Invalid Printful response" };
  }
  return { ok: res.ok, status: res.status, data };
}

export type CatalogVariant = {
  sync_variant_id: number;
  sync_product_id: number;
  name: string;
  variant_name: string;
  size: string | null;
  color: string | null;
  thumbnail: string | null;
  retail_price: string;
  currency: string;
};

export type CatalogProduct = {
  id: number;
  name: string;
  thumbnail: string | null;
  variants: CatalogVariant[];
};

/** List sync products with variant retail prices. Empty store → []. */
export async function listCatalog(env: Env): Promise<{ ok: boolean; status: number; products: CatalogProduct[]; error?: string }> {
  const list = await printful(env, "/store/products?limit=100");
  if (!list.ok) {
    return {
      ok: false,
      status: list.status,
      products: [],
      error: list.data?.error?.message || list.data?.result || "Printful error",
    };
  }
  const summaries = Array.isArray(list.data?.result) ? list.data.result : [];
  const products: CatalogProduct[] = [];

  for (const summary of summaries) {
    const detail = await printful(env, `/store/products/${summary.id}`);
    if (!detail.ok) continue;
    const sp = detail.data?.result?.sync_product || summary;
    const variantsRaw = detail.data?.result?.sync_variants || [];
    const variants: CatalogVariant[] = [];
    for (const v of variantsRaw) {
      if (v?.is_ignored) continue;
      const retail = v?.retail_price != null ? String(v.retail_price) : "";
      if (!retail || Number(retail) <= 0) continue; // skip unsellable without retail
      variants.push({
        sync_variant_id: Number(v.id),
        sync_product_id: Number(sp.id),
        name: String(sp.name || v.name || "Product"),
        variant_name: String(v.name || sp.name || "Variant"),
        size: v.size ?? null,
        color: v.color ?? null,
        thumbnail:
          (v.files || []).find((f: any) => f.type === "preview")?.preview_url ||
          (v.files || []).find((f: any) => f.preview_url)?.preview_url ||
          sp.thumbnail_url ||
          null,
        retail_price: retail,
        currency: String(v.currency || "USD"),
      });
    }
    if (variants.length === 0) continue;
    products.push({
      id: Number(sp.id),
      name: String(sp.name || "Product"),
      thumbnail: sp.thumbnail_url || variants[0]?.thumbnail || null,
      variants,
    });
  }

  return { ok: true, status: 200, products };
}

/** Look up a single sync variant's retail price (server-side reprice). */
export async function getSyncVariant(
  env: Env,
  syncVariantId: number,
): Promise<{ ok: boolean; status: number; variant?: any; error?: string }> {
  const res = await printful(env, `/store/variants/${syncVariantId}`);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: res.data?.error?.message || res.data?.result || "Variant not found",
    };
  }
  return { ok: true, status: 200, variant: res.data?.result };
}

/** Deterministic Printful external_id (max 32 chars) from Stripe session id. */
export async function externalIdFromSession(sessionId: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionId));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
