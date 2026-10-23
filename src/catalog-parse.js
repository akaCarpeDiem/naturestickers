// Shared Printful title parsing for /shop and the sticker pages (/shop/<section>/<key>).
import { infoFor, sectionFor, sizeKey } from './sections.js';

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * "New York Protected Lands Sticker (Stacked) — Real Photo"
 *   → { state: "New York", edition: "Stacked", style: "Real Photo" }
 * "Yosemite Half Dome Sticker — Stained Glass" → { state: "Yosemite Half Dome", … } (a location)
 * Styles come from the title suffix after the dash, so a new style in Printful
 * automatically becomes a new filter chip.
 */
export function parse(p) {
  const name = String(p.name || '');
  const m = name.match(/^(.*?)\s+[—–-]\s+([^—–]+)$/);
  const base = (m ? m[1] : name).trim();
  const style = m ? m[2].trim() : 'Original';
  const edition = (base.match(/\(([^)]+)\)\s*$/) || [])[1] || '';
  const state = base.replace(/\([^)]*\)\s*$/, '').replace(/\s+Protected Lands Sticker\s*$/i, '').replace(/\s+Sticker\s*$/i, '').trim();
  // Sizes cheapest first; `v` (the default) is the cheapest.
  const vs = (p.variants || [])
    .filter((x) => Number(x.retail_price) > 0)
    .sort((a, b) => Number(a.retail_price) - Number(b.retail_price));
  const v = vs[0] || (p.variants || [])[0];
  const it = { p, v, vs, state, edition, style, styleKey: slug(style), thumb: p.thumbnail || v?.thumbnail || '' };
  return withSection(it);
}

/** Attach section, display title and id. `section` is null for products without a page (hidden). */
export function withSection(it) {
  const key = groupKey(it);
  const section = sectionFor(key);
  const data = infoFor(section, key, slug(it.state));
  it.key = key;
  it.section = section;
  it.data = data;
  it.title = section?.key === 'states' || !data.name ? `${it.state}${it.edition ? ` (${it.edition})` : ''}` : data.name;
  it.sub = data.park ? `${data.park}${data.region ? `, ${data.region}` : ''}` : '';
  it.id = it.v ? String(it.v.sync_variant_id) : `${key}-${it.styleKey}`;
  return it;
}

/** Placeholder for a sticker whose page exists but whose Printful product doesn't yet. */
export function placeholder(section, key, style) {
  return withSection({ p: null, v: null, vs: [], state: key, edition: '', style: style.label, styleKey: style.key, thumb: '', placeholder: true, fixedKey: key });
}

/** The variant for a size key ("3x3"); null if that size isn't live. No size → the only/cheapest one. */
export const variantFor = (it, size) => (size ? it.vs.find((x) => sizeKey(x.size) === size) || null : it.v || null);

/** Transparent site art keyed like the Printful external_id: <key>-<photo|stained-glass>. */
export function artKey(it) {
  const style = it.styleKey === 'real-photo' ? 'photo' : it.styleKey;
  return `${groupKey(it)}-${style}`;
}

/** Page key, same as the keys in data/*-info.json: <state>[-<edition>]. */
export const groupKey = (it) => it.fixedKey || [slug(it.state), it.edition ? slug(it.edition) : ''].filter(Boolean).join('-');
