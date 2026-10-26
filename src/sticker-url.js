/** One-time edge cache bust for location Real Photo files that kept their path
 *  across the Oct 2026 art redeploy. The custom domain was still serving the
 *  previous file (cf-cache-status HIT, max-age 7d). `?v=20261026` is a new
 *  cache key; the same query already returns the new bytes on naturestickers.shop.
 *  Stained glass and state art are left alone. */
export const LOCATION_PHOTO_BUST = '20261026';

/**
 * @param {string} sectionKey shop section (`locations`, `states`, …)
 * @param {string} url site path or absolute URL ending in `<key>-photo.webp` or `<key>-photo-1400.webp`
 */
export function locationPhotoSrc(sectionKey, url) {
  if (sectionKey !== 'locations' || !url || /[?#]/.test(url)) return url;
  if (!/-photo(?:-1400)?\.webp$/.test(url)) return url;
  return `${url}?v=${LOCATION_PHOTO_BUST}`;
}
