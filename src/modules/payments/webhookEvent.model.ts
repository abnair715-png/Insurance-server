import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { applyToJSON } from '../../db/plugins';

/**
 * Webhook delivery ledger.
 *
 * Stripe guarantees AT LEAST ONCE delivery: the same event can arrive several
 * times, out of order, and days late. Recording every event id under a unique
 * index turns the second and later deliveries into a cheap no-op.
 *
 * This is a fast path, not the correctness mechanism — the payment state
 * transition and the policy upsert are each independently idempotent, so even
 * if this collection were dropped the system would still activate exactly one
 * policy. See docs/payment-idempotency.md.
 */
export interface WebhookEventDocument extends Document {
  _id: mongoose.Types.ObjectId;
  /** Stripe's `evt_...` id. */
  eventId: string;
  type: string;
  status: 'PROCESSING' | 'PROCESSED' | 'FAILED';
  receivedAt: Date;
  processedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new Schema<WebhookEventDocument>(
  {
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    status: { type: String, enum: ['PROCESSING', 'PROCESSED', 'FAILED'], default: 'PROCESSING' },
    receivedAt: { type: Date, required: true, default: () => new Date() },
    processedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true, collection: 'webhook_events' },
);

webhookEventSchema.index({ eventId: 1 }, { unique: true, name: 'uniq_webhook_event_id' });

applyToJSON(webhookEventSchema);

export const WebhookEventModel: Model<WebhookEventDocument> =
  (mongoose.models.WebhookEvent as Model<WebhookEventDocument>) ??
  mongoose.model<WebhookEventDocument>('WebhookEvent', webhookEventSchema);
