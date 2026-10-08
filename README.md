# Nature Stickers

Marketing site for Nature Stickers, a nature-inspired die-cut vinyl sticker brand.

- **Public origin:** https://naturestickers.shop (www redirects to apex via `_redirects`)
- **Pages project:** `naturestickers` → https://naturestickers.pages.dev
- **Stack:** Vite static build → Cloudflare Pages (deployed with wrangler from the box)
- **Contact:** support@naturestickers.shop
- **Fonts (self-hosted, OFL):** Young Serif (display) + Instrument Sans (text) in `public/fonts/`
- **Brand assets:** `public/logo.svg` / `logo-light.svg` (outlined wordmark), `favicon.svg`, `og.png`.
  Regenerate the wordmark with `tools/make_brand.py`; OG image is rendered from `tools/og.html`.
- **Sticker art:** `public/stickers/*.svg`

Future: direct sales via Stripe Checkout + Printful API fulfillment (not built yet). Shopify is not used.

```bash
npm install
npm run dev
npm run build
npm run deploy   # wrangler pages deploy dist --project-name=naturestickers --branch=main
```
