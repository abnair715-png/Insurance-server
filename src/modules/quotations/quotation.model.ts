import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { QUOTATION_STATUSES, type ProductCategory, type QuotationStatus } from '../../config/constants';
import { applyToJSON } from '../../db/plugins';
import type { PremiumStep } from './premium.service';
import type { CustomerProfile } from '../eligibility/eligibility.types';

/**
 * Snapshots
 * ---------
 * A quotation stores its own copy of the customer and product facts it was
 * priced from. A catalogue price change or a customer address correction must
 * not retroactively alter a quotation the customer has already been sent, and a
 * policy issued from it must remain auditable years later.
 */
export interface QuotationCustomerSnapshot {
  fullName: string;
  email: string;
  phone: string;
  age: number;
  city: string;
  state: string;
}

export interface QuotationProductSnapshot {
  name: string;
  category: ProductCategory;
  description: string;
  keyBenefits: string[];
}

export interface QuotationDocument extends Document {
  _id: mongoose.Types.ObjectId;
  reference: string;
  customerId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  agentId: mongoose.Types.ObjectId;
  agentName: string;
  premiumAmount: number;
  coverageAmount: number;
  currency: string;
  premiumBreakdown: PremiumStep[];
  customerSnapshot: QuotationCustomerSnapshot;
  productSnapshot: QuotationProductSnapshot;
  eligibilitySnapshot: CustomerProfile;
  status: QuotationStatus;
  /** Denormalised `status ∈ open states`, so a partial unique index can enforce
   *  "at most one open quotation per customer+product". */
  isOpen: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const premiumStepSchema = new Schema<PremiumStep>(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true },
    detail: { type: String },
  },
  { _id: false },
);

const quotationSchema = new Schema<QuotationDocument>(
  {
    reference: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    agentName: { type: String, required: true },
    premiumAmount: { type: Number, required: true, min: 0 },
    coverageAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, lowercase: true, default: 'inr' },
    premiumBreakdown: { type: [premiumStepSchema], default: [] },
    customerSnapshot: {
      fullName: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String, required: true },
      age: { type: Number, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
    },
    productSnapshot: {
      name: { type: String, required: true },
      category: { type: String, required: true },
      description: { type: String, required: true },
      keyBenefits: { type: [String], default: [] },
    },
    eligibilitySnapshot: { type: Schema.Types.Mixed, required: true },
    status: { type: String, enum: QUOTATION_STATUSES, default: 'DRAFT', required: true },
    isOpen: { type: Boolean, default: true, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'quotations' },
);

quotationSchema.index({ reference: 1 }, { unique: true, name: 'uniq_quotation_reference' });
quotationSchema.index({ customerId: 1, createdAt: -1 }, { name: 'idx_quotation_customer' });
quotationSchema.index({ agentId: 1, status: 1 }, { name: 'idx_quotation_agent_status' });

/**
 * At most one OPEN quotation per (customer, product). This is what makes
 * "select this product" safely repeatable: a double-click, a browser retry or
 * two concurrent requests all converge on the same quotation document rather
 * than producing several references for the same offer.
 */
quotationSchema.index(
  { customerId: 1, productId: 1 },
  {
    unique: true,
    name: 'uniq_open_quotation_per_customer_product',
    partialFilterExpression: { isOpen: true },
  },
);

applyToJSON(quotationSchema);

export const QuotationModel: Model<QuotationDocument> =
  (mongoose.models.Quotation as Model<QuotationDocument>) ??
  mongoose.model<QuotationDocument>('Quotation', quotationSchema);
