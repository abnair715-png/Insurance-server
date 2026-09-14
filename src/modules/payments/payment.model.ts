import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { PAYMENT_STATUSES, type PaymentStatus } from '../../config/constants';
import { applyToJSON } from '../../db/plugins';

export interface PaymentDocument extends Document {
  _id: mongoose.Types.ObjectId;
  /**
   * The logical identity of this payment attempt: `pay_<quotationRef>_<attempt>`.
   * Deterministic, so a retried create-link request produces the same key and
   * the unique index below collapses it onto the same row. The same string is
   * also sent to Stripe as its request idempotency key.
   */
  idempotencyKey: string;
  quotationId: mongoose.Types.ObjectId;
  quotationReference: string;
  customerId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  agentId: mongoose.Types.ObjectId;
  /** Attempt number for this quotation, starting at 1. */
  attempt: number;
  /** Amount charged, minor currency units. Copied from the quotation — never
   *  from the client — and frozen once the checkout session is created. */
  amount: number;
  currency: string;
  status: PaymentStatus;
  /** Denormalised `status ∈ {CREATED, PENDING}`. Exists purely so a partial
   *  unique index can enforce "at most one OPEN payment per quotation";
   *  partialFilterExpression only supports equality, not `$in`. */
  isOpen: boolean;
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  checkoutUrl?: string;
  /** Set when the session created at Stripe stops accepting payment. */
  checkoutExpiresAt?: Date;
  paidAt?: Date;
  failureReason?: string;
  /** Stripe event that drove the last status change — the audit trail for a
   *  "why is this payment SUCCEEDED?" question. */
  lastStripeEventId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<PaymentDocument>(
  {
    idempotencyKey: { type: String, required: true },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', required: true },
    quotationReference: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    attempt: { type: Number, required: true, min: 1, default: 1 },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, lowercase: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true, default: 'CREATED' },
    isOpen: { type: Boolean, required: true, default: true },
    stripeSessionId: { type: String },
    stripePaymentIntentId: { type: String },
    checkoutUrl: { type: String },
    checkoutExpiresAt: { type: Date },
    paidAt: { type: Date },
    failureReason: { type: String },
    lastStripeEventId: { type: String },
  },
  { timestamps: true, collection: 'payments' },
);

/**
 * Duplicate-payment defence, layer 1.
 * Two concurrent create-link requests derive the same key; exactly one insert
 * survives and the loser reads back the winner.
 */
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, name: 'uniq_payment_idempotency_key' });

/**
 * Duplicate-payment defence, layer 2.
 * At most ONE OPEN payment per quotation. This is what makes concurrent
 * "generate payment link" requests safe: the attempt counter they each read is
 * inherently racy, but only one of them can insert an open payment row, and the
 * losers read back the winner.
 */
paymentSchema.index(
  { quotationId: 1 },
  {
    unique: true,
    name: 'uniq_open_payment_per_quotation',
    partialFilterExpression: { isOpen: true },
  },
);

/**
 * Duplicate-payment defence, layer 3.
 * At most ONE successful payment may ever exist per quotation, enforced by the
 * database rather than by application logic. Even a bug in the webhook handler
 * cannot record a second successful charge against the same quotation.
 */
paymentSchema.index(
  { quotationId: 1 },
  {
    unique: true,
    name: 'uniq_succeeded_payment_per_quotation',
    partialFilterExpression: { status: 'SUCCEEDED' },
  },
);

/** The webhook looks a payment up by its Stripe session id on every delivery. */
paymentSchema.index(
  { stripeSessionId: 1 },
  { unique: true, sparse: true, name: 'uniq_payment_stripe_session' },
);
paymentSchema.index({ agentId: 1, status: 1, createdAt: -1 }, { name: 'idx_payment_agent_status' });
paymentSchema.index({ customerId: 1, createdAt: -1 }, { name: 'idx_payment_customer' });

applyToJSON(paymentSchema);

export const PaymentModel: Model<PaymentDocument> =
  (mongoose.models.Payment as Model<PaymentDocument>) ??
  mongoose.model<PaymentDocument>('Payment', paymentSchema);
