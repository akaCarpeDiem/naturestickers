import { json, methodNotAllowed, type Env } from "../lib/http";

/**
 * Optional Printful webhook (package_shipped, etc.).
 * Printful already emails tracking when shipping notifications are on —
 * this handler just logs for now.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: any = null;
  try {
    body = await context.request.json();
  } catch {
    body = null;
  }
  const type = body?.type || body?.event || "unknown";
  const orderId = body?.data?.order?.id || body?.data?.shipment?.id || null;
  console.log("[printful-webhook]", type, "order/shipment=", orderId);
  return json({ received: true });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
};
