/**
 * Money representation
 * -------------------
 * Every monetary amount in this system is an INTEGER in the currency's MINOR
 * unit (paise for INR, cents for USD). Reasons:
 *   - no binary floating point rounding anywhere in the money path
 *   - Stripe's API expects minor units, so no conversion at the boundary
 *   - MongoDB stores it as a plain Int, which is safe to compare and index
 * Conversion to a display string happens only in the PDF, emails and the UI.
 */

export const toMinorUnits = (major: number): number => Math.round(major * 100);
export const toMajorUnits = (minor: number): number => minor / 100;

const CURRENCY_LOCALES: Record<string, string> = {
  inr: 'en-IN',
  usd: 'en-US',
  eur: 'de-DE',
  gbp: 'en-GB',
};

/** Formats a minor-unit integer as a localised currency string, e.g. 1234500 -> "₹12,345.00". */
export function formatMoney(minorUnits: number, currency = 'inr'): string {
  const locale = CURRENCY_LOCALES[currency.toLowerCase()] ?? 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMajorUnits(minorUnits));
}

/** Rounds a computed premium to whole currency units — quoted premiums are
 *  never fractional, and it keeps the number on the PDF tidy. */
export const roundToWholeUnits = (minorUnits: number): number => Math.round(minorUnits / 100) * 100;

/**
 * ASCII-safe money format, e.g. "INR 12,345.00".
 *
 * PDFKit's built-in fonts are WinAnsi-encoded and have no glyph for the rupee
 * sign (U+20B9), so the PDF and transactional emails use the ISO currency code
 * instead. Embedding a Unicode TTF would fix the symbol at the cost of shipping
 * and bundling a font file — see docs/technical-decisions.md.
 */
export function formatMoneyPlain(minorUnits: number, currency = 'inr'): string {
  const locale = CURRENCY_LOCALES[currency.toLowerCase()] ?? 'en-US';
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMajorUnits(minorUnits));
  return `${currency.toUpperCase()} ${amount}`;
}
