/**
 * Canonical host: 301 www → https://naturestickers.shop (keep path+query)
 * Matches promptshare/marketcheck Pages middleware approach.
 */

const CANONICAL_HOST = "naturestickers.shop";

export async function onRequest(context: {
  request: Request;
  next: () => Promise<Response>;
}): Promise<Response> {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();

  if (host === `www.${CANONICAL_HOST}`) {
    const dest = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
    return Response.redirect(dest, 301);
  }

  return context.next();
}

