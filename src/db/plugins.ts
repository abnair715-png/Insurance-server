import type { Schema } from 'mongoose';

/**
 * Normalises every document that leaves the API:
 *   - `_id` becomes `id` (a string), `__v` is dropped
 *   - fields listed in the schema option `privateFields` are removed
 * Applied once per schema so no controller can accidentally leak a password
 * hash or a raw link token by serialising a model directly.
 */
export function applyToJSON(schema: Schema, privateFields: string[] = []) {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
      privateFields.forEach((field) => delete ret[field]);
      return ret;
    },
  });
  schema.set('toObject', { virtuals: true });
}
