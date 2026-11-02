import { methodNotAllowed, type Env } from "../lib/http";
import {
  handleOrderLookup,
  kvRateLimitStore,
  memoryRateLimitStore,
  type StripeClient,
} from "../lib/order-lookup";
import { stripeForm, stripeGet } from "../lib/stripe";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const env = context.env;
  const stripe: StripeClient | null = env.STRIPE_SECRET_KEY
    ? {
        get: (path) => stripeGet(env, path),
        form: (path, params) => stripeForm(env, path, params),
      }
    : null;
  const store = env.CATALOG_KV ? kvRateLimitStore(env.CATALOG_KV) : memoryRateLimitStore();
  return handleOrderLookup(context.request, { stripe, store });
};

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed("POST");
};
