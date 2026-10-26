/** One-time edge cache bust for location sticker art replaced in place.
 *  Real Photo shipped first. Stained Glass on the eight returning locations
 *  reused `-stained-glass.webp`, and the custom-domain edge kept the previous
 *  file under the old 7-day object. The same `?v=20261026` query is applied to
 *  every location Real Photo and Stained Glass URL. State art is left alone. */
export const LOCATION_ART_BUST = '20261026';

const LOCATION_ART_FILE = /-(?:photo|stained-glass)(?:-1400)?\.webp$/;

/**
 * @param {string} sectionKey shop section (`locations`, `states`, …)
 * @param {string} url site path or absolute URL for a location sticker webp
 *   (`<key>-photo.webp`, `<key>-stained-glass.webp`, or the `-1400` variant)
 */
export function locationArtSrc(sectionKey, url) {
  if (sectionKey !== 'locations' || !url || /[?#]/.test(url)) return url;
  if (!LOCATION_ART_FILE.test(url)) return url;
  return `${url}?v=${LOCATION_ART_BUST}`;
}
