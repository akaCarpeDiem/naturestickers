// Shared Printful title parsing for /shop and the per-state pages (/shop/<key>).

export const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * "New York Protected Lands Sticker (Stacked) — Real Photo"
 *   → { state: "New York", edition: "Stacked", style: "Real Photo" }
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
  const v = (p.variants || [])[0];
  return { p, v, state, edition, style, styleKey: slug(style), thumb: p.thumbnail || v?.thumbnail || '' };
}

/** Transparent site art keyed like the Printful external_id: <state>[-<edition>]-<photo|stained-glass>. */
export function artKey(it) {
  const style = it.styleKey === 'real-photo' ? 'photo' : it.styleKey;
  return [slug(it.state), it.edition ? slug(it.edition) : '', style].filter(Boolean).join('-');
}

/** State page key, same as the keys in data/state-info.json: <state>[-<edition>]. */
export const groupKey = (it) => [slug(it.state), it.edition ? slug(it.edition) : ''].filter(Boolean).join('-');
