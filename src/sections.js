// Shop sections (states, locations, …) from src/data/sections.json.
// Each section names its own data file in src/data/; a Printful product is shown only when its
// page key is in one of those files, so new products stay hidden until their page exists.
// Adding a section (e.g. cities) = a new entry in sections.json + its <name>-info.json.
import config from './data/sections.json';

const files = import.meta.glob('./data/*-info.json', { eager: true, import: 'default' });

export const SECTIONS = Object.entries(config).map(([key, s]) => ({
  key,
  ...s,
  info: files[`./data/${s.info}`] || {},
  minPrice: Math.min(...s.sizes.map((z) => Number(z.price))),
}));

export const sectionByKey = (key) => SECTIONS.find((s) => s.key === key) || null;

/** Section whose data file has this page key, or null (= not shown on the site). */
export const sectionFor = (pageKey) => SECTIONS.find((s) => Object.hasOwn(s.info, pageKey)) || null;

/** Info record for a page key; edition records (new-york-stacked) fall back to the base state. */
export function infoFor(section, pageKey, baseKey) {
  if (!section) return {};
  return { ...(section.info[baseKey] || {}), ...(section.info[pageKey] || {}) };
}

export const pageUrl = (section, pageKey) => `/${section.path}/${pageKey}`;

/** "3″×3″" / "3x3" / "3″ × 3″" → "3x3" (matches the size keys in sections.json). */
export const sizeKey = (size) => (String(size || '').match(/\d+(?:\.\d+)?/g) || []).join('x');

/** "From $5.75" text for a multi-size section, "" for single-size ones. */
export const sizesBlurb = (section) =>
  section.sizes.length > 1 ? section.sizes.map((z) => z.label.split(/\s*×\s*/)[0]).join(' or ') : '';
