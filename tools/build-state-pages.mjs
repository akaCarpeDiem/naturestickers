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
// Image sources per sticker (Real Photo edition), transcribed from the saved per-state source records.
// A sticker gets a /sources/<key> page only when it has an entry here.
const sources = JSON.parse(read('src/data/state-sources.json'));
const hasSources = (key) => Array.isArray(sources[key]) && sources[key].length > 0;
let shopHtml = read('shop.html');

// Shipping for the Product structured data comes from the same constant checkout charges.
const shipCents = Number((read('functions/lib/stripe.ts').match(/FLAT_SHIPPING_CENTS\s*=\s*(\d+)/) || [])[1]);
if (!Number.isInteger(shipCents) || shipCents < 0) throw new Error('build-state-pages: FLAT_SHIPPING_CENTS not found in functions/lib/stripe.ts');
const SHIPPING = (shipCents / 100).toFixed(2);
// Defects only (matches /returns and Merchant Center): report within 14 days, refund or replace, keep the item.
const RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'US',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 14,
  returnFees: 'https://schema.org/FreeReturn',
  returnMethod: 'https://schema.org/KeepProduct',
  merchantReturnLink: `${ORIGIN}/returns`,
};
const SHIPPING_DETAILS = {
  '@type': 'OfferShippingDetails',
  shippingRate: { '@type': 'MonetaryAmount', value: SHIPPING, currency: 'USD' },
  shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'US' },
};

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
      {
        '@type': 'ProductGroup',
        '@id': `${url}#product`,
        name: `${name} State Sticker`,
        description: blurb,
        url,
        image: styles.map((s) => `${ORIGIN}${s.src}-1400.webp`),
        brand: { '@type': 'Brand', name: 'Nature Stickers' },
        productGroupID: key,
        variesBy: ['https://schema.org/pattern'],
        hasVariant: styles.map((s) => ({
          '@type': 'Product',
          '@id': `${url}#${s.key}`,
          name: `${name} State Sticker (${s.label})`,
          sku: `${key}-${s.key}`,
          image: `${ORIGIN}${s.src}-1400.webp`,
          description: blurb,
          brand: { '@type': 'Brand', name: 'Nature Stickers' },
          pattern: s.label,
          inProductGroupWithID: key,
          offers: {
            '@type': 'Offer',
            url: `${url}?style=${s.key}`,
            priceCurrency: 'USD',
            price: PRICE,
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition',
            shippingDetails: SHIPPING_DETAILS,
            hasMerchantReturnPolicy: RETURN_POLICY,
          },
        })),
      },
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
          </section>` : ''}${hasSources(key) ? `
          <p class="sp-sources"><a href="/sources/${esc(key)}">Image sources</a></p>` : ''}
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

/** Short list like "A, B and C". */
function andList(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The note at the top of a sources page. Only claims what every entry's saved rights record supports. */
function sourcesNote(rows) {
  const licensed = rows.some((r) => r.kind === 'license');
  const counts = new Map();
  for (const r of rows) counts.set(r.source, (counts.get(r.source) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
  const gov = rows.every((r) => r.rights === 'Public domain (U.S. government work)');
  const status = licensed
    ? 'Each one is in the public domain or is published under a free license that allows commercial use without credit (noted beside those photos).'
    : gov
      ? 'Each one is the work of a U.S. government agency and is in the public domain, free to use publicly and commercially.'
      : rows.some((r) => r.kind === 'policy')
        ? 'Each one is in the public domain or free to reuse, whether as the work of a U.S. government agency or through a public-domain release by its photographer (such as CC0), and is free to use publicly.'
        : 'Each one is in the public domain, whether as the work of a U.S. government agency or through a public-domain release by its photographer (such as CC0), and is free to use publicly and commercially.';
  return [
    `None of the photographs in this sticker require attribution. ${status}`,
    `But for anyone curious where the originals are located, every source is listed below. ${counts.size === 1 ? `They all come from ${top[0]}, a public collection.` : `They come from public collections and image libraries including ${andList(top)}.`} Photographers and agencies are named as a courtesy; naming them does not imply their endorsement.`,
  ];
}

function sourcesPage(key, entry) {
  const name = entry.name;
  const rows = sources[key];
  const url = `${ORIGIN}/sources/${key}`;
  const title = `${name} Sticker Image Sources | Nature Stickers`;
  const description = clip(`Where each photograph in the ${name} sticker comes from: ${rows.length} public-domain and freely licensed photos of protected lands, with links to the originals.`);
  const file = path.join(root, 'public/stickers/all', `${key}-photo.webp`);
  if (!fs.existsSync(file)) throw new Error(`build-state-pages: missing ${file}`);
  const size = webpSize(file);
  const src = `/stickers/all/${key}-photo`;
  const note = sourcesNote(rows);
  const items = rows
    .map(
      (r) => `
          <li class="src-item">
            <span class="src-letter" aria-hidden="true">${esc(r.letter)}</span>
            <div class="src-body">
              <p class="src-place"><span class="sr-only">${esc(r.letter)}: </span>${esc(r.place)}${r.area ? `<span class="src-area"> · ${esc(r.area)}</span>` : ''}</p>
              <dl class="src-meta">
                <div><dt>Photo</dt><dd>${esc(r.credit)}</dd></div>
                <div><dt>Source</dt><dd><a href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.source)}<span class="sr-only"> (opens in a new tab)</span></a><span class="src-sep" aria-hidden="true"> · </span><a href="${esc(r.original)}" rel="nofollow noopener" target="_blank">Original image<span class="sr-only"> for ${esc(r.letter)}, ${esc(r.place)} (opens in a new tab)</span></a></dd></div>
                <div><dt>Rights</dt><dd>${r.rightsUrl ? `<a href="${esc(r.rightsUrl)}" rel="nofollow noopener" target="_blank">${esc(r.rights)}<span class="sr-only"> (opens in a new tab)</span></a>` : esc(r.rights)}</dd></div>
              </dl>
            </div>
          </li>`,
    )
    .join('');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: `${ORIGIN}/shop` },
      { '@type': 'ListItem', position: 3, name, item: `${ORIGIN}/shop/${key}` },
      { '@type': 'ListItem', position: 4, name: 'Image sources', item: url },
    ],
  };
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
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Nature Stickers" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(`${name} sticker: image sources`)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(`${ORIGIN}${src}-1400.webp`)}" />
  <meta name="twitter:card" content="summary_large_image" />
${headLinks}
  <script type="application/ld+json">
${ldJson(ld)}
  </script>
</head>
<body class="page-night">
  <a class="skip" href="#main">Skip to content</a>

${header}

  <main id="main" class="sp src-page">
    <section class="hero on-night shop-top sp-top">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="wrap">
        <nav class="sp-crumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> <span aria-hidden="true">›</span> <a href="/shop/${esc(key)}">${esc(name)}</a> <span aria-hidden="true">›</span> <span aria-current="page">Image sources</span></nav>
        <h1 class="sp-title">${esc(name)} image sources</h1>
        <div class="sp-art">
          <figure class="sp-fig is-main">
            <img src="${src}.webp" srcset="${src}.webp 800w, ${src}-1400.webp 1400w" sizes="(max-width: 1100px) calc(100vw - 40px), 1000px" alt="${esc(`${name} sticker, Real Photo`)}" width="${size.w}" height="${size.h}" decoding="async" fetchpriority="high" />
          </figure>
        </div>
      </div>
    </section>

    <section class="section on-night sp-info src-info" aria-labelledby="src-h">
      <div class="wrap src-wrap">
        <div class="src-note">
          <h2 id="src-h" class="src-h">Where each photo comes from</h2>
          ${note.map((t) => `<p>${esc(t)}</p>`).join('\n          ')}
          <p class="src-scope">Listed letter by letter, left to right, for the Real Photo edition.</p>
        </div>
        <ol class="src-list">${items}
        </ol>
        <p class="src-back"><a class="btn btn-ghost" href="/shop/${esc(key)}">Back to the ${esc(name)} sticker</a></p>
      </div>
    </section>
  </main>

${footer}

  <script type="module" src="/src/main.js"></script>
  <script type="module" src="/src/cart-ui.js"></script>
</body>
</html>
`;
}

// —— /shop: plain <a href> links to every state page (shop.js swaps in the live grid) ——
const START = '<!-- state-links:start -->';
const END = '<!-- state-links:end -->';
const at = shopHtml.indexOf(START);
const to = shopHtml.indexOf(END);
if (at < 0 || to < at) throw new Error('build-state-pages: state-links markers not found in shop.html');
const links = Object.keys(info)
  .map((key) => [key, info[key].name])
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([key, name]) => `\n            <li><a href="/shop/${key}">${esc(name)}</a></li>`)
  .join('');
const nextShop = `${shopHtml.slice(0, at + START.length)}
          <ul class="sx-index" aria-label="All state stickers">${links}
          </ul>
          ${shopHtml.slice(to)}`;
if (nextShop !== shopHtml) {
  fs.writeFileSync(path.join(root, 'shop.html'), nextShop);
  shopHtml = nextShop;
}

// —— Pages ——
const outDir = path.join(root, 'shop');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const keys = Object.keys(info);
for (const key of keys) fs.writeFileSync(path.join(outDir, `${key}.html`), page(key, info[key]));
const srcDir = path.join(root, 'sources');
fs.rmSync(srcDir, { recursive: true, force: true });
fs.mkdirSync(srcDir, { recursive: true });
const srcKeys = keys.filter(hasSources);
for (const key of srcKeys) fs.writeFileSync(path.join(srcDir, `${key}.html`), sourcesPage(key, info[key]));

// —— Sitemap: keep the hand-written URLs, then one per state page ——
const sitemapFile = path.join(root, 'public/sitemap.xml');
const d = new Date(); // build date in local time
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const kept = (fs.readFileSync(sitemapFile, 'utf8').match(/^\s*<url>.*<\/url>\s*$/gm) || [])
  .map((l) => l.trim())
  .filter((l) => !/<loc>https:\/\/naturestickers\.shop\/(?:shop|sources)\/[^<]+<\/loc>/.test(l));
const stateUrls = [
  ...keys.map(
    (key) => `<url><loc>${ORIGIN}/shop/${key}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`,
  ),
  ...srcKeys.map(
    (key) => `<url><loc>${ORIGIN}/sources/${key}</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.4</priority></url>`,
  ),
];
fs.writeFileSync(
  sitemapFile,
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...kept, ...stateUrls].map((l) => `  ${l}`).join('\n')}
</urlset>
`,
);

console.log(`build-state-pages: wrote ${keys.length} pages to shop/, ${srcKeys.length} to sources/ and ${kept.length + stateUrls.length} URLs to public/sitemap.xml`);
