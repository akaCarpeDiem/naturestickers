// Writes one static page per sticker to shop/<section>/<key>.html for every section in
// src/data/sections.json (states → shop/states/<key>, locations → shop/locations/<key>, …),
// the image-source pages (states and locations), the /shop/<state> → /shop/states/<state> redirects and
// public/sitemap.xml. Runs before `vite build`; no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://naturestickers.shop';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
// Sizes and prices per section must match the retail prices set in Printful
// (the pages show them until /api/products loads).
const SECTIONS = Object.entries(JSON.parse(read('src/data/sections.json'))).map(([key, s]) => ({
  key,
  ...s,
  info: JSON.parse(read(`src/data/${s.info}`)),
}));
const STATES = SECTIONS.find((s) => s.key === 'states');
if (!STATES) throw new Error('build-state-pages: sections.json needs a "states" section');
const info = STATES.info;
const pagePath = (sec, key) => `/${sec.path}/${key}`;
// Image sources per sticker (Real Photo edition), transcribed from the saved per-state and
// per-location source records. A sticker gets a /sources/<key> page only when it has an entry here.
const SOURCE_FILES = { states: 'src/data/state-sources.json', locations: 'src/data/location-sources.json' };
const SOURCES = Object.fromEntries(
  Object.entries(SOURCE_FILES).filter(([, f]) => fs.existsSync(path.join(root, f))).map(([k, f]) => [k, JSON.parse(read(f))]),
);
const sources = SOURCES.states || {};
const hasSources = (key, secKey = 'states') => {
  const rows = (SOURCES[secKey] || {})[key];
  return Array.isArray(rows) && rows.length > 0;
};
{
  // Source keys must be unique across sections: they share /sources/<key>.
  const seen = new Set();
  for (const sec of SECTIONS) for (const key of Object.keys(sec.info)) {
    if (!hasSources(key, sec.key)) continue;
    if (seen.has(key)) throw new Error(`build-state-pages: duplicate source key ${key}`);
    seen.add(key);
  }
}
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

function page(sec, key, entry) {
  const isState = sec.key === 'states';
  // Edition records (e.g. new-york-stacked) fall back to the state's own blurb, like the popup.
  const name = entry.name;
  const state = name.replace(/\s*\([^)]*\)\s*$/, '');
  const base = sec.info[slug(state)] || {};
  const blurb = entry.blurb || base.blurb || '';
  const letters = (Array.isArray(entry.letters) ? entry.letters : []).filter((l) => l && l.letter && l.place);
  const where = [entry.park, entry.region].filter(Boolean).join(', ');
  const url = `${ORIGIN}${pagePath(sec, key)}`;
  const title = isState
    ? `${name} State Sticker: National Parks & Protected Lands | Nature Stickers`
    : `${name} Sticker${entry.park ? `, ${entry.park}` : ''} | Nature Stickers`;
  const ogTitle = isState ? `${name} sticker: every letter a wild place` : `${name} sticker${entry.park ? `: ${entry.park}` : ''}`;
  const productName = isState ? `${name} State Sticker` : `${name} Sticker`;
  const description = clip(blurb);
  const ogImage = `${ORIGIN}/stickers/all/${key}-stained-glass-1400.webp`;
  const altFor = (label) => (isState ? `${name} sticker, ${label}: each letter frames a ${state} landscape` : `${name} sticker, ${label}${entry.spot ? `: ${entry.spot}` : ''}`);
  const sizes = sec.sizes;
  const multi = sizes.length > 1;
  const square = sec.art === 'square';

  const styles = sec.styles.map((s) => {
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
          { '@type': 'ListItem', position: 3, name: sec.label, item: `${ORIGIN}/shop?section=${sec.key}` },
          { '@type': 'ListItem', position: 4, name, item: url },
        ],
      },
      {
        '@type': 'ProductGroup',
        '@id': `${url}#product`,
        name: productName,
        description: blurb,
        url,
        image: styles.map((s) => `${ORIGIN}${s.src}-1400.webp`),
        brand: { '@type': 'Brand', name: 'Nature Stickers' },
        productGroupID: key,
        variesBy: multi ? ['https://schema.org/pattern', 'https://schema.org/size'] : ['https://schema.org/pattern'],
        hasVariant: styles.flatMap((s) => sizes.map((z) => ({
          '@type': 'Product',
          '@id': multi ? `${url}#${s.key}-${z.key}` : `${url}#${s.key}`,
          name: multi ? `${productName} (${s.label}, ${z.label})` : `${productName} (${s.label})`,
          sku: multi ? `${key}-${s.key}-${z.key}` : `${key}-${s.key}`,
          image: `${ORIGIN}${s.src}-1400.webp`,
          description: blurb,
          brand: { '@type': 'Brand', name: 'Nature Stickers' },
          pattern: s.label,
          ...(multi ? { size: z.label } : {}),
          inProductGroupWithID: key,
          offers: {
            '@type': 'Offer',
            url: multi ? `${url}?style=${s.key}&size=${z.key}` : `${url}?style=${s.key}`,
            priceCurrency: 'USD',
            price: z.price,
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition',
            shippingDetails: SHIPPING_DETAILS,
            hasMerchantReturnPolicy: RETURN_POLICY,
          },
        }))),
      },
    ],
  };

  const figures = styles
    .map(
      (s, i) => `
          <figure class="sp-fig${i === 0 ? ' is-main' : ''}" data-style="${s.key}">
            <img src="${s.src}.webp" srcset="${s.src}.webp 800w, ${s.src}-1400.webp 1400w" sizes="${square ? '(max-width: 600px) calc(100vw - 40px), 560px' : '(max-width: 1100px) calc(100vw - 40px), 1000px'}" alt="${esc(altFor(s.label))}" width="${s.size.w}" height="${s.size.h}" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'} />
            <figcaption>${s.label}</figcaption>
          </figure>`,
    )
    .join('');
  const seg = styles
    .map((s, i) => `<button type="button" class="seg-btn" role="radio" aria-checked="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-style="${s.key}">${s.label}</button>`)
    .join('');
  const sizePicker = multi
    ? `
          <fieldset class="sx-sizes sp-sizes" id="sp-sizes" data-size-picker>
            <legend class="sx-label">Size</legend>
            <div class="sx-sizes-opts">${sizes
              .map(
                (z, i) => `
              <label class="sx-size-opt"><input type="radio" name="sp-size" value="${esc(z.key)}" data-price="${esc(z.price)}"${i === 0 ? ' checked' : ''} /><span class="sx-size-label">${esc(z.label)}</span><span class="sx-size-price">$${esc(z.price)}</span></label>`,
              )
              .join('')}
            </div>
          </fieldset>`
    : `
          <p class="sp-size">${esc(sizes[0].note || sizes[0].label)}</p>`;
  const browse = isState ? 'Browse all 50 states' : `Browse all ${sec.label.toLowerCase()}`;

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

  <main id="main" class="sp sp--${esc(sec.key)}" data-key="${esc(key)}" data-section="${esc(sec.key)}">
    <section class="hero on-night shop-top sp-top">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="wrap">
        <nav class="sp-crumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> <span aria-hidden="true">›</span> <a href="/shop?section=${esc(sec.key)}">${esc(sec.label)}</a> <span aria-hidden="true">›</span> <span aria-current="page">${esc(name)}</span></nav>
        <h1 class="sp-title">${esc(name)}</h1>${!isState && where ? `
        <p class="sp-where">${esc(where)}</p>` : ''}
        <div class="sx-d-toggle sp-toggle">
          <span class="sx-label" id="sp-style-label">Style</span>
          <div class="seg sx-d-seg" role="radiogroup" aria-labelledby="sp-style-label">${seg}</div>
        </div>
        <div class="sp-art${square ? ' is-square' : ''}">${figures}
        </div>
      </div>
    </section>

    <section class="section on-night sp-info" aria-labelledby="sp-about">
      <div class="wrap sp-grid">
        <div class="sp-buy">
          <h2 id="sp-about" class="sr-only">About the ${esc(name)} sticker</h2>
          <p class="sp-price"><span class="sx-d-price" id="sp-price">$${sizes[0].price}</span> <span class="sp-style-name" id="sp-style-name">${styles[0].label}</span></p>${sizePicker}
          <button type="button" class="btn btn-primary sx-add" id="sp-add" disabled>Loading…</button>
          <p class="sp-status" id="sp-status" role="status" aria-live="polite"></p>
          <a class="btn btn-ghost sp-browse" href="${isState ? '/shop' : `/shop?section=${esc(sec.key)}`}">${esc(browse)}</a>
        </div>
        <div class="sp-about">
          <p class="sx-d-blurb">${esc(blurb)}</p>${letters.length ? `
          <section class="sx-d-letters" aria-labelledby="sp-letters-h">
            <h3 id="sp-letters-h" class="sx-label">In every letter</h3>
            ${letterColumns(state, letters)}
          </section>` : ''}${entry.spot ? `
          <p class="sx-d-spot"><span class="sx-label">Where it is</span> ${esc(entry.spot)}</p>` : ''}${hasSources(key, sec.key) ? `
          <p class="sp-sources"><a href="/sources/${esc(key)}">${isState ? 'Image sources' : 'Image source'}</a></p>` : ''}
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
                <div><dt>Source</dt><dd><a href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.source)}<span class="sr-only"> (opens in a new tab)</span></a>${r.original ? `<span class="src-sep" aria-hidden="true"> · </span><a href="${esc(r.original)}" rel="nofollow noopener" target="_blank">Original image<span class="sr-only"> for ${esc(r.letter)}, ${esc(r.place)} (opens in a new tab)</span></a>` : ''}</dd></div>
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
      { '@type': 'ListItem', position: 3, name: STATES.label, item: `${ORIGIN}/shop?section=states` },
      { '@type': 'ListItem', position: 4, name, item: `${ORIGIN}${pagePath(STATES, key)}` },
      { '@type': 'ListItem', position: 5, name: 'Image sources', item: url },
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
        <nav class="sp-crumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> <span aria-hidden="true">›</span> <a href="/shop?section=states">${esc(STATES.label)}</a> <span aria-hidden="true">›</span> <a href="${pagePath(STATES, key)}">${esc(name)}</a> <span aria-hidden="true">›</span> <span aria-current="page">Image sources</span></nav>
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
        <p class="src-back"><a class="btn btn-ghost" href="${pagePath(STATES, key)}">Back to the ${esc(name)} sticker</a></p>
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

/** The note at the top of a location's source page (one photograph). Only claims what its saved rights record supports. */
function locationSourceNote(r) {
  const status = /CC0/.test(r.rights)
    ? 'Its photographer released it into the public domain with a CC0 dedication, so it is free to use publicly and commercially.'
    : r.rights === 'Public domain (U.S. government work)'
      ? 'It is the work of a U.S. government agency and is in the public domain, free to use publicly and commercially.'
      : r.kind === 'license'
        ? 'It is published under a free license that allows commercial use without credit (noted beside the photo).'
        : 'Its catalog record marks it as public domain, free to use publicly and commercially.';
  return [
    `The photograph in this sticker doesn't require attribution. ${status}`,
    `But for anyone curious where the original is located, its source is listed below. It comes from ${r.source}, a public collection. The photographer or agency is named as a courtesy; naming them does not imply their endorsement.`,
  ];
}

/** Image-source page for a non-state sticker (e.g. a location): same layout as the state pages, one photo. */
function sectionSourcesPage(sec, key, entry) {
  const name = entry.name;
  const rows = SOURCES[sec.key][key];
  const url = `${ORIGIN}/sources/${key}`;
  const back = pagePath(sec, key);
  const single = rows.length === 1;
  const title = `${name} Sticker Image ${single ? 'Source' : 'Sources'} | Nature Stickers`;
  const description = clip(
    single
      ? `Where the photograph in the ${name} sticker${entry.park ? ` (${entry.park})` : ''} comes from: a public-domain photo, with links to the source and the original image.`
      : `Where each photograph in the ${name} sticker comes from: ${rows.length} public-domain and freely licensed photos, with links to the originals.`,
  );
  const file = path.join(root, 'public/stickers/all', `${key}-photo.webp`);
  if (!fs.existsSync(file)) throw new Error(`build-state-pages: missing ${file}`);
  const size = webpSize(file);
  const src = `/stickers/all/${key}-photo`;
  const square = sec.art === 'square';
  const note = single ? locationSourceNote(rows[0]) : sourcesNote(rows);
  const label = single ? 'Image source' : 'Image sources';
  const items = rows
    .map(
      (r) => `
          <li class="src-item">
            <span class="src-letter" aria-hidden="true">${esc(r.letter || '')}</span>
            <div class="src-body">
              <p class="src-place">${esc(r.place)}${r.area ? `<span class="src-area"> · ${esc(r.area)}</span>` : ''}</p>
              <dl class="src-meta">
                <div><dt>Photo</dt><dd>${esc(r.credit)}</dd></div>
                <div><dt>Source</dt><dd><a href="${esc(r.url)}" rel="nofollow noopener" target="_blank">${esc(r.source)}<span class="sr-only"> (opens in a new tab)</span></a>${r.original ? `<span class="src-sep" aria-hidden="true"> · </span><a href="${esc(r.original)}" rel="nofollow noopener" target="_blank">Original image<span class="sr-only"> for ${esc(r.place)} (opens in a new tab)</span></a>` : ''}</dd></div>
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
      { '@type': 'ListItem', position: 3, name: sec.label, item: `${ORIGIN}/shop?section=${sec.key}` },
      { '@type': 'ListItem', position: 4, name, item: `${ORIGIN}${back}` },
      { '@type': 'ListItem', position: 5, name: label, item: url },
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
  <meta property="og:title" content="${esc(`${name} sticker: image ${single ? 'source' : 'sources'}`)}" />
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

  <main id="main" class="sp src-page sp--${esc(sec.key)}">
    <section class="hero on-night shop-top sp-top">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="wrap">
        <nav class="sp-crumb" aria-label="Breadcrumb"><a href="/shop">Shop</a> <span aria-hidden="true">›</span> <a href="/shop?section=${esc(sec.key)}">${esc(sec.label)}</a> <span aria-hidden="true">›</span> <a href="${back}">${esc(name)}</a> <span aria-hidden="true">›</span> <span aria-current="page">${label}</span></nav>
        <h1 class="sp-title">${esc(name)} image ${single ? 'source' : 'sources'}</h1>${entry.park || entry.region ? `
        <p class="sp-where">${esc([entry.park, entry.region].filter(Boolean).join(', '))}</p>` : ''}
        <div class="sp-art${square ? ' is-square' : ''}">
          <figure class="sp-fig is-main">
            <img src="${src}.webp" srcset="${src}.webp 800w, ${src}-1400.webp 1400w" sizes="${square ? '(max-width: 600px) calc(100vw - 40px), 560px' : '(max-width: 1100px) calc(100vw - 40px), 1000px'}" alt="${esc(`${name} sticker, Real Photo`)}" width="${size.w}" height="${size.h}" decoding="async" fetchpriority="high" />
          </figure>
        </div>
      </div>
    </section>

    <section class="section on-night sp-info src-info" aria-labelledby="src-h">
      <div class="wrap src-wrap">
        <div class="src-note">
          <h2 id="src-h" class="src-h">${single ? 'Where the photo comes from' : 'Where each photo comes from'}</h2>
          ${note.map((t) => `<p>${esc(t)}</p>`).join('\n          ')}
          <p class="src-scope">${single ? 'For the Real Photo edition.' : 'Listed for the Real Photo edition.'}</p>
        </div>
        <ol class="src-list">${items}
        </ol>
        <p class="src-back"><a class="btn btn-ghost" href="${back}">Back to the ${esc(name)} sticker</a></p>
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

// —— /shop: plain <a href> links to every sticker page, per section (shop.js swaps in the live grid) ——
const START = '<!-- state-links:start -->';
const END = '<!-- state-links:end -->';
const at = shopHtml.indexOf(START);
const to = shopHtml.indexOf(END);
if (at < 0 || to < at) throw new Error('build-state-pages: state-links markers not found in shop.html');
// Sections with no stickers yet (e.g. locations between design rounds) get no index list.
const lists = SECTIONS.filter((sec) => Object.keys(sec.info).length).map((sec) => {
  const links = Object.keys(sec.info)
    .map((key) => [key, sec.info[key].name])
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key, name]) => `\n              <li><a href="${pagePath(sec, key)}">${esc(name)}</a></li>`)
    .join('');
  return `
          <section class="sx-sec" aria-label="${esc(sec.heading)}">
            <h2 class="sx-sec-h">${esc(sec.heading)}</h2>
            <ul class="sx-index" aria-label="All ${esc(sec.heading.toLowerCase())}">${links}
            </ul>
          </section>`;
}).join('');
const nextShop = `${shopHtml.slice(0, at + START.length)}${lists}
          ${shopHtml.slice(to)}`;
if (nextShop !== shopHtml) {
  fs.writeFileSync(path.join(root, 'shop.html'), nextShop);
  shopHtml = nextShop;
}

// —— Pages: shop/<section path>/<key>.html ——
const outDir = path.join(root, 'shop');
fs.rmSync(outDir, { recursive: true, force: true });
let pageCount = 0;
for (const sec of SECTIONS) {
  const dir = path.join(root, sec.path);
  fs.mkdirSync(dir, { recursive: true });
  for (const key of Object.keys(sec.info)) {
    fs.writeFileSync(path.join(dir, `${key}.html`), page(sec, key, sec.info[key]));
    pageCount += 1;
  }
}
const keys = Object.keys(info);
const srcDir = path.join(root, 'sources');
fs.rmSync(srcDir, { recursive: true, force: true });
fs.mkdirSync(srcDir, { recursive: true });
const srcKeys = keys.filter((key) => hasSources(key));
for (const key of srcKeys) fs.writeFileSync(path.join(srcDir, `${key}.html`), sourcesPage(key, info[key]));
// Other sections (locations, …) that have saved source records.
for (const sec of SECTIONS) {
  if (sec.key === 'states') continue;
  for (const key of Object.keys(sec.info).filter((k) => hasSources(k, sec.key))) {
    fs.writeFileSync(path.join(srcDir, `${key}.html`), sectionSourcesPage(sec, key, sec.info[key]));
    srcKeys.push(key);
  }
}

// —— Redirects: the old /shop/<state> URLs moved to /shop/states/<state> ——
const redirectsFile = path.join(root, 'public/_redirects');
const R_START = '# state-pages:start (generated by tools/build-state-pages.mjs)';
const R_END = '# state-pages:end';
const redirects = fs.readFileSync(redirectsFile, 'utf8');
const block = [
  R_START,
  // Section landing URLs open /shop filtered to that section (302: real index pages may come later).
  ...SECTIONS.flatMap((sec) => [`/${sec.path} /shop?section=${sec.key} 302`, `/${sec.path}/ /shop?section=${sec.key} 302`]),
  ...keys.flatMap((key) => [`/shop/${key} ${pagePath(STATES, key)} 301`, `/shop/${key}/ ${pagePath(STATES, key)} 301`]),
  R_END,
].join('\n');
const ra = redirects.indexOf(R_START);
const rb = redirects.indexOf(R_END);
const nextRedirects = ra >= 0 && rb > ra
  ? `${redirects.slice(0, ra)}${block}${redirects.slice(rb + R_END.length)}`
  : `${redirects.replace(/\s*$/, '\n')}${block}\n`;
if (nextRedirects !== redirects) fs.writeFileSync(redirectsFile, nextRedirects);

// —— Sitemap: keep the hand-written URLs, then one per sticker page ——
const sitemapFile = path.join(root, 'public/sitemap.xml');
const d = new Date(); // build date in local time
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const kept = (fs.readFileSync(sitemapFile, 'utf8').match(/^\s*<url>.*<\/url>\s*$/gm) || [])
  .map((l) => l.trim())
  .filter((l) => !/<loc>https:\/\/naturestickers\.shop\/(?:shop|sources)\/[^<]+<\/loc>/.test(l));
const stateUrls = [
  ...SECTIONS.flatMap((sec) =>
    Object.keys(sec.info).map(
      (key) => `<url><loc>${ORIGIN}${pagePath(sec, key)}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`,
    ),
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

console.log(`build-state-pages: wrote ${pageCount} pages to shop/ (${SECTIONS.map((s) => `${Object.keys(s.info).length} ${s.key}`).join(', ')}), ${srcKeys.length} to sources/, ${keys.length * 2} redirects and ${kept.length + stateUrls.length} URLs to public/sitemap.xml`);
