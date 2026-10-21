// Writes one static page per sticker to shop/<key>.html (from src/data/state-info.json)
// and regenerates public/sitemap.xml. Runs before `vite build`; no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Must match the retail price set in Printful (the page shows it until /api/products loads).
const PRICE = '8.00';
const ORIGIN = 'https://naturestickers.shop';
const STYLES = [
  { key: 'real-photo', label: 'Real Photo', art: 'photo' },
  { key: 'stained-glass', label: 'Stained Glass', art: 'stained-glass' },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const info = JSON.parse(read('src/data/state-info.json'));
const shopHtml = read('shop.html');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
// Same as slug() in src/catalog-parse.js.
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// JSON inside <script>: escape the characters that could close the tag.
const ldJson = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/** Cut at a word boundary so the result (with "…") is at most max characters. */
function clip(text, max = 155) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,;:.—–-]+$/, '')}…`;
}

/** Pixel size of a .webp (VP8, VP8L or VP8X header), so <img> gets real width/height. */
function webpSize(file) {
  const b = fs.readFileSync(file);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`Unknown webp header in ${file}`);
}

/** Pull a block out of shop.html so every page shares its header, footer, fonts, icons and GA tag. */
function pick(re, what) {
  const m = shopHtml.match(re);
  if (!m) throw new Error(`build-state-pages: couldn't find the ${what} in shop.html`);
  return m[0];
}
const gaTag = pick(/<!-- Google tag[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/, 'Google Analytics tag');
const headLinks = pick(/  <link rel="icon"[\s\S]*?<link rel="stylesheet" href="\/src\/shop\.css" \/>/, 'icon/font/stylesheet links');
const header = pick(/  <header class="site-header[\s\S]*?<\/header>/, 'header')
  .replace('<a href="/shop" aria-current="page">Shop</a>', '<a href="/shop">Shop</a>')
  .replace('<a class="nav-cta" href="#cart">', '<a class="nav-cta" href="/shop#cart">');
const footer = pick(/  <footer class="site-footer">[\s\S]*?<\/footer>/, 'footer');
if (!header.includes('href="/shop#cart"')) throw new Error('build-state-pages: header cart link not found in shop.html');

/** Same split as show() in src/shop-modal.js: one column per word for two-word states. */
function letterColumns(state, letters) {
  const words = state.toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z]/g, '')).filter(Boolean);
  let groups = [];
  let at = 0;
  for (const w of words) { groups.push(letters.slice(at, at + w.length)); at += w.length; }
  if (at !== letters.length || groups.length > 2) groups = [letters]; // unexpected shape: one list
  const line = (l) => {
    const full = `${l.letter}: ${l.place}${l.area ? ` — ${l.area}` : ''}`;
    return `
              <li title="${esc(full)}">
                <span class="sx-d-letter" aria-hidden="true">${esc(l.letter)}</span>
                <span class="sx-d-line"><span class="sr-only">${esc(l.letter)}: </span><span class="sx-d-place">${esc(l.place)}</span>${l.area ? `<span class="sx-d-area"><span aria-hidden="true"> · </span><span class="sr-only">, </span>${esc(l.area)}</span>` : ''}</span>
              </li>`;
  };
  const two = groups.length === 2;
  return `<div class="sx-d-cols${two ? ' is-two' : ''}">${groups
    .map((g, i) => `
            <ol class="sx-d-list"${two ? ` aria-label="${esc(words[i])}"` : ''}>${g.map(line).join('')}
            </ol>`)
    .join('')}
          </div>`;
}

function page(key, entry) {
  // Edition records (e.g. new-york-stacked) fall back to the state's own blurb, like the popup.
  const name = entry.name;
  const state = name.replace(/\s*\([^)]*\)\s*$/, '');
  const base = info[slug(state)] || {};
  const blurb = entry.blurb || base.blurb || '';
  const letters = (Array.isArray(entry.letters) ? entry.letters : []).filter((l) => l && l.letter && l.place);
  const url = `${ORIGIN}/shop/${key}`;
  const title = `${name} State Sticker: National Parks & Protected Lands | Nature Stickers`;
  const ogTitle = `${name} sticker: every letter a wild place`;
  const description = clip(blurb);
  const ogImage = `${ORIGIN}/stickers/all/${key}-stained-glass-1400.webp`;

  const styles = STYLES.map((s) => {
    const file = path.join(root, 'public/stickers/all', `${key}-${s.art}.webp`);
    if (!fs.existsSync(file)) throw new Error(`build-state-pages: missing ${file}`);
    return { ...s, src: `/stickers/all/${key}-${s.art}`, size: webpSize(file) };
  });

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Shop', item: `${ORIGIN}/shop` },
          { '@type': 'ListItem', position: 3, name, item: url },
        ],
      },
      ...styles.map((s) => ({
        '@type': 'Product',
        name: `${name} State Sticker (${s.label})`,
        image: `${ORIGIN}${s.src}-1400.webp`,
        description: blurb,
        brand: { '@type': 'Brand', name: 'Nature Stickers' },
        offers: {
          '@type': 'Offer',
          priceCurrency: 'USD',
          price: PRICE,
          availability: 'https://schema.org/InStock',
          url,
        },
      })),
    ],
  };

  const figures = styles
    .map(
      (s, i) => `
          <figure class="sp-fig${i === 0 ? ' is-main' : ''}" data-style="${s.key}">
            <img src="${s.src}.webp" srcset="${s.src}.webp 800w, ${s.src}-1400.webp 1400w" sizes="(max-width: 1100px) calc(100vw - 40px), 1000px" alt="${esc(`${name} sticker, ${s.label}: each letter frames a ${state} landscape`)}" width="${s.size.w}" height="${s.size.h}" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} />
            <figcaption>${s.label}</figcaption>
          </figure>`,
    )
    .join('');
  const seg = styles
    .map((s, i) => `<button type="button" class="seg-btn" role="radio" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-style="${s.key}">${s.label}</button>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
${gaTag}
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="theme-color" content="#0C1510" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="Nature Stickers" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(ogTitle)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:image:alt" content="${esc(`${name} sticker, Stained Glass`)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(ogTitle)}" />
  <meta name="twitter:image" content="${esc(ogImage)}" />
${headLinks}
  <script type="application/ld+json">
${ldJson(ld)}
  </script>
</head>
<body class="page-night">
  <a class="skip" href="#main">Skip to content</a>

${header}

  <main id="main" class="sp" data-key="${esc(key)}">
    <section class="hero on-night shop-top sp-top">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="wrap">
        <nav class="sp-crumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> <span aria-hidden="true">›</span> <span aria-current="page">${esc(name)}</span></nav>
        <h1 class="sp-title">${esc(name)}</h1>
        <div class="sx-d-toggle sp-toggle">
          <span class="sx-label" id="sp-style-label">Style</span>
          <div class="seg sx-d-seg" role="radiogroup" aria-labelledby="sp-style-label">${seg}</div>
        </div>
        <div class="sp-art">${figures}
        </div>
      </div>
    </section>

    <section class="section on-night sp-info" aria-labelledby="sp-about">
      <div class="wrap sp-grid">
        <div class="sp-buy">
          <h2 id="sp-about" class="sr-only">About the ${esc(name)} sticker</h2>
          <p class="sp-price"><span class="sx-d-price" id="sp-price">$${PRICE}</span> <span class="sp-style-name" id="sp-style-name">${styles[0].label}</span></p>
          <p class="sp-size">6″ wide; height varies with the state name</p>
          <button type="button" class="btn btn-primary sx-add" id="sp-add" disabled>Loading…</button>
          <p class="sp-status" id="sp-status" role="status" aria-live="polite"></p>
          <a class="btn btn-ghost sp-browse" href="/shop">Browse all 50 states</a>
        </div>
        <div class="sp-about">
          <p class="sx-d-blurb">${esc(blurb)}</p>${letters.length ? `
          <section class="sx-d-letters" aria-labelledby="sp-letters-h">
            <h3 id="sp-letters-h" class="sx-label">In every letter</h3>
            ${letterColumns(state, letters)}
          </section>` : ''}
        </div>
      </div>
    </section>
  </main>

${footer}

  <script type="module" src="/src/state-page.js"></script>
</body>
</html>
`;
}

// —— Pages ——
const outDir = path.join(root, 'shop');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const keys = Object.keys(info);
for (const key of keys) fs.writeFileSync(path.join(outDir, `${key}.html`), page(key, info[key]));

// —— Sitemap: keep the hand-written URLs, then one per state page ——
const sitemapFile = path.join(root, 'public/sitemap.xml');
const d = new Date(); // build date in local time
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const kept = (fs.readFileSync(sitemapFile, 'utf8').match(/^\s*<url>.*<\/url>\s*$/gm) || [])
  .map((l) => l.trim())
  .filter((l) => !/<loc>https:\/\/naturestickers\.shop\/shop\/[^<]+<\/loc>/.test(l));
const stateUrls = keys.map(
  (key) => `<url><loc>${ORIGIN}/shop/${key}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`,
);
fs.writeFileSync(
  sitemapFile,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...kept, ...stateUrls].map((l) => `  ${l}`).join('\n')}
</urlset>
`,
);

console.log(`build-state-pages: wrote ${keys.length} pages to shop/ and ${kept.length + stateUrls.length} URLs to public/sitemap.xml`);
