import crypto from 'node:crypto';

/** Crockford-style alphabet: no I, L, O or U, so references stay unambiguous
 *  when read aloud over the phone or retyped from a PDF. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomToken(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Human-facing identifiers. They are business references, not primary keys:
 * every collection still uses its ObjectId `_id` for relationships. Each is
 * backed by a unique index, and the (vanishingly unlikely) collision surfaces
 * as a duplicate-key error rather than silent overwrite.
 */
export const generateQuotationReference = () => `QTN-${new Date().getFullYear()}-${randomToken(8)}`;
export const generatePolicyNumber = () => `POL-${new Date().getFullYear()}-${randomToken(8)}`;
export const generateDocumentReference = () => `DOC-${new Date().getFullYear()}-${randomToken(8)}`;

/** Opaque, high-entropy token for public document links (never stored raw). */
export const generatePublicToken = () => crypto.randomBytes(32).toString('base64url');
