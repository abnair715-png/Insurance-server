/**
 * Origin parsing for the CORS allow-list.
 *
 * Both CLIENT_URL and CORS_ADDITIONAL_ORIGINS accept a comma-separated list, so
 * one deployment can serve a production client, a staging client and preview
 * builds without code changes.
 */

/**
 * Normalises a single origin for comparison against the browser's `Origin`
 * header, which is always `scheme://host[:port]` — lowercase, no path, no
 * trailing slash. Hand-written env values rarely match that exactly, so
 * `https://App.Example.com/` and `https://app.example.com` must compare equal.
 *
 * Returns `null` when the value is not a usable absolute URL, so a typo is
 * dropped from the allow-list rather than silently widening it.
 */
export function normaliseOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // `url.origin` already drops any path, query, fragment and trailing slash.
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Splits a comma-separated list into normalised, de-duplicated origins.
 * Blank entries and trailing commas are ignored, so
 * `"https://a.com, https://b.com,"` yields two origins.
 */
export function parseOriginList(value: string | undefined): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  for (const part of value.split(',')) {
    const origin = normaliseOrigin(part);
    if (origin) seen.add(origin);
  }
  return [...seen];
}

/** Entries that are not usable origins — surfaced so a typo is visible in the
 *  logs at boot rather than as a mystery CORS failure in the browser. */
export function findInvalidOrigins(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && normaliseOrigin(part) === null);
}
