import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { applyToJSON } from '../../db/plugins';

/**
 * A document record is METADATA only — the PDF bytes are never stored.
 *
 * The PDF is rendered on demand from the quotation's immutable snapshots, so
 * the same reference always produces the same document. That removes the need
 * for blob storage entirely, which matters on Vercel where the filesystem is
 * ephemeral and per-invocation.
 *
 * No link token is stored either: it is an HMAC of (reference, version) under
 * DOCUMENT_LINK_SECRET, so a database dump alone cannot produce a working link,
 * and the agent can re-derive the link on any later page load.
 */
export interface DocumentRecord extends Document {
  _id: mongoose.Types.ObjectId;
  reference: string;
  quotationId: mongoose.Types.ObjectId;
  agentId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  type: 'QUOTATION';
  expiresAt: Date;
  generatedAt: Date;
  /** Incremented each time the agent regenerates the document. The public link
   *  token is derived from (reference, version), so bumping it revokes every
   *  link previously shared for this document. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const documentSchema = new Schema<DocumentRecord>(
  {
    reference: { type: String, required: true },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    type: { type: String, enum: ['QUOTATION'], default: 'QUOTATION', required: true },
    expiresAt: { type: Date, required: true },
    generatedAt: { type: Date, required: true, default: () => new Date() },
    version: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, collection: 'documents' },
);

documentSchema.index({ reference: 1 }, { unique: true, name: 'uniq_document_reference' });
// One document per quotation: regenerating rotates the token and bumps the
// version in place rather than accumulating orphaned links.
documentSchema.index({ quotationId: 1 }, { unique: true, name: 'uniq_document_quotation' });
documentSchema.index({ customerId: 1 }, { name: 'idx_document_customer' });

applyToJSON(documentSchema);

export const DocumentModel: Model<DocumentRecord> =
  (mongoose.models.DocumentRecord as Model<DocumentRecord>) ??
  mongoose.model<DocumentRecord>('DocumentRecord', documentSchema);
