/**
 * Customer-facing size wording. Printful's product is still the 6″×6″ blank
 * (that stays in the catalog data); every die-cut sticker is exactly 6″ wide
 * and its height varies with the state name, so we show "6″ wide".
 */
const SIX_BY_SIX = /6\s*(?:″|”|"|in\.?)?\s*[x×X]\s*6\s*(?:″|”|"|in\.?)?/g;

export const SIZE_NOTE = 'Always 6″ wide; height varies with the state name.';

/** Display label for a Printful size value ("6″×6″" → "6″ wide"). */
export function sizeLabel(size) {
  const s = String(size || '').trim();
  if (!s) return '';
  return s.replace(SIX_BY_SIX, '') !== s ? '6″ wide' : s;
}

/** Rewrite any "6″×6″" inside free text (e.g. a stored cart line name). */
export function cleanSizeText(text) {
  return String(text || '').replace(SIX_BY_SIX, '6″ wide');
}
