# DNS for naturestickers.shop

Pages project: `naturestickers` → https://naturestickers.pages.dev (created 2026-10-07; old project `naturevinyls` still serves naturevinyls.com).

The naturestickers.shop zone is on the Cloudflare account (nameservers dan/khloe.ns.cloudflare.com).
Custom domains `naturestickers.shop` and `www.naturestickers.shop` were added to the `naturestickers`
Pages project on 2026-10-07 and stay **pending** until these records exist (the box API token has no Zone DNS permission):

| Type  | Name  | Target                     | Proxy                  |
|-------|-------|----------------------------|------------------------|
| CNAME | `@`   | `naturestickers.pages.dev` | Proxied (orange cloud) |
| CNAME | `www` | `naturestickers.pages.dev` | Proxied (orange cloud) |
