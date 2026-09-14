import { findInvalidOrigins, normaliseOrigin, parseOriginList } from './origins';

describe('normaliseOrigin', () => {
  it('reduces a URL to the exact form a browser sends in the Origin header', () => {
    expect(normaliseOrigin('https://firsturl.com')).toBe('https://firsturl.com');
    expect(normaliseOrigin('https://firsturl.com/')).toBe('https://firsturl.com');
    expect(normaliseOrigin('https://firsturl.com/some/path?q=1#x')).toBe('https://firsturl.com');
    expect(normaliseOrigin('  https://firsturl.com  ')).toBe('https://firsturl.com');
  });

  it('lowercases the host so configuration casing does not matter', () => {
    expect(normaliseOrigin('https://FirstURL.com')).toBe('https://firsturl.com');
  });

  it('keeps a non-default port, because the browser sends it', () => {
    expect(normaliseOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normaliseOrigin('https://example.com:8443/')).toBe('https://example.com:8443');
  });

  it('rejects anything that is not an absolute http(s) origin', () => {
    // A bare host is the most common mistake — it would never match an Origin
    // header, so admitting it would silently produce a dead allow-list entry.
    expect(normaliseOrigin('firsturl.com')).toBeNull();
    expect(normaliseOrigin('www.firsturl.com')).toBeNull();
    expect(normaliseOrigin('ftp://firsturl.com')).toBeNull();
    expect(normaliseOrigin('javascript:alert(1)')).toBeNull();
    expect(normaliseOrigin('')).toBeNull();
    expect(normaliseOrigin('   ')).toBeNull();
  });
});

describe('parseOriginList', () => {
  it('splits a comma-separated list', () => {
    expect(parseOriginList('https://firsturl.com,https://secondurl.com')).toEqual([
      'https://firsturl.com',
      'https://secondurl.com',
    ]);
  });

  it('tolerates spaces, trailing commas and blank entries', () => {
    expect(parseOriginList(' https://firsturl.com ,  , https://secondurl.com , ')).toEqual([
      'https://firsturl.com',
      'https://secondurl.com',
    ]);
  });

  it('de-duplicates entries that normalise to the same origin', () => {
    expect(parseOriginList('https://firsturl.com,https://FirstURL.com/')).toEqual([
      'https://firsturl.com',
    ]);
  });

  it('drops unusable entries rather than widening the allow-list', () => {
    expect(parseOriginList('https://firsturl.com,not-a-url')).toEqual(['https://firsturl.com']);
  });

  it('returns an empty list for empty or missing input', () => {
    expect(parseOriginList('')).toEqual([]);
    expect(parseOriginList(undefined)).toEqual([]);
  });
});

describe('findInvalidOrigins', () => {
  it('reports entries that will be ignored, so a typo is visible at boot', () => {
    expect(findInvalidOrigins('https://firsturl.com, secondurl.com, ftp://x.com')).toEqual([
      'secondurl.com',
      'ftp://x.com',
    ]);
  });

  it('reports nothing for a well-formed list', () => {
    expect(findInvalidOrigins('https://firsturl.com,https://secondurl.com')).toEqual([]);
  });
});
