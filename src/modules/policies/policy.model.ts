import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { POLICY_STATUSES, type PolicyStatus, type ProductCategory } from '../../config/constants';
import { applyToJSON } from '../../db/plugins';

export interface PolicyDocument extends Document {
  _id: mongoose.Types.ObjectId;
  policyNumber: string;
  quotationId: mongoose.Types.ObjectId;
  quotationReference: string;
  paymentId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  agentId: mongoose.Types.ObjectId;
  /** Denormalised for list views and the confirmation email, so rendering a
   *  policy never needs a fan-out of lookups. */
  customerName: string;
  customerEmail: string;
  productName: string;
  productCategory: ProductCategory;
  premiumAmount: number;
  coverageAmount: number;
  currency: string;
  status: PolicyStatus;
  startDate: Date;
  endDate: Date;
  activatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const policySchema = new Schema<PolicyDocument>(
  {
    policyNumber: { type: String, required: true },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', required: true },
    quotationReference: { type: String, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    productName: { type: String, required: true },
    productCategory: { type: String, required: true },
    premiumAmount: { type: Number, required: true },
    coverageAmount: { type: Number, required: true },
    currency: { type: String, required: true, lowercase: true },
    status: { type: String, enum: POLICY_STATUSES, required: true, default: 'ACTIVE' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    activatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, collection: 'policies' },
);

policySchema.index({ policyNumber: 1 }, { unique: true, name: 'uniq_policy_number' });

/**
 * Duplicate-activation defence.
 * One policy per payment and one policy per quotation, enforced by unique
 * indexes. The activation path is an upsert keyed on `paymentId`, so however
 * many times the webhook is replayed the second and later attempts are no-ops.
 */
policySchema.index({ paymentId: 1 }, { unique: true, name: 'uniq_policy_payment' });
policySchema.index({ quotationId: 1 }, { unique: true, name: 'uniq_policy_quotation' });

policySchema.index({ agentId: 1, status: 1, createdAt: -1 }, { name: 'idx_policy_agent_status' });
policySchema.index({ customerId: 1, createdAt: -1 }, { name: 'idx_policy_customer' });

applyToJSON(policySchema);

export const PolicyModel: Model<PolicyDocument> =
  (mongoose.models.Policy as Model<PolicyDocument>) ??
  mongoose.model<PolicyDocument>('Policy', policySchema);
