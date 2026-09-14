import mongoose, { Schema, type Document, type Model } from 'mongoose';
import {
  GENDERS,
  PRODUCT_CATEGORIES,
  VEHICLE_TYPES,
  type Gender,
  type ProductCategory,
  type VehicleType,
} from '../../config/constants';
import { applyToJSON } from '../../db/plugins';

/**
 * Eligibility rules are DATA, not code.
 *
 * Every rule a product can express lives in this sub-document, and a single
 * evaluator in modules/eligibility interprets it. Adding a product — or changing
 * who qualifies for one — is a database change, not a deployment. The trade-off
 * is that only rules the evaluator understands can be expressed; a genuinely
 * novel rule needs an evaluator change too. See docs/eligibility-rules.md.
 */
export interface EligibilityRules {
  minAge?: number;
  maxAge?: number;
  /** Minor currency units (paise). */
  minAnnualIncome?: number;
  maxAnnualIncome?: number;
  allowedGenders?: Gender[];
  /** Customer must own a vehicle for this product to apply. */
  requiresVehicle?: boolean;
  allowedVehicleTypes?: VehicleType[];
  minVehicleValue?: number;
  maxVehicleValue?: number;
  /** Product is not offered to declared smokers. */
  excludeSmokers?: boolean;
  /** Product is not offered to customers with declared pre-existing conditions. */
  excludePreExistingConditions?: boolean;
}

export interface AgeBand {
  minAge: number;
  maxAge: number;
  /** Multiplier applied to the base premium for customers in this band. */
  multiplier: number;
}

export interface PricingFactors {
  ageBands: AgeBand[];
  /** Percentage loading added for declared smokers, e.g. 35 = +35%. */
  smokerLoadingPct?: number;
  preExistingLoadingPct?: number;
  /** Vehicle products price off asset value: premium = vehicleValue * rate%. */
  vehicleValueRatePct?: number;
  /** Term products cap cover at this multiple of annual income. */
  coverageIncomeMultiple?: number;
}

export interface ProductDocument extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  category: ProductCategory;
  description: string;
  /** Annual base premium in minor currency units. */
  basePremium: number;
  /** Sum assured in minor currency units. */
  coverageAmount: number;
  keyBenefits: string[];
  eligibilityRules: EligibilityRules;
  pricingFactors: PricingFactors;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const eligibilityRulesSchema = new Schema<EligibilityRules>(
  {
    minAge: { type: Number, min: 0, max: 120 },
    maxAge: { type: Number, min: 0, max: 120 },
    minAnnualIncome: { type: Number, min: 0 },
    maxAnnualIncome: { type: Number, min: 0 },
    allowedGenders: [{ type: String, enum: GENDERS }],
    requiresVehicle: { type: Boolean },
    allowedVehicleTypes: [{ type: String, enum: VEHICLE_TYPES }],
    minVehicleValue: { type: Number, min: 0 },
    maxVehicleValue: { type: Number, min: 0 },
    excludeSmokers: { type: Boolean },
    excludePreExistingConditions: { type: Boolean },
  },
  { _id: false },
);

const pricingFactorsSchema = new Schema<PricingFactors>(
  {
    ageBands: [
      {
        _id: false,
        minAge: { type: Number, required: true },
        maxAge: { type: Number, required: true },
        multiplier: { type: Number, required: true, min: 0.1, max: 10 },
      },
    ],
    smokerLoadingPct: { type: Number, min: 0, max: 500, default: 0 },
    preExistingLoadingPct: { type: Number, min: 0, max: 500, default: 0 },
    vehicleValueRatePct: { type: Number, min: 0, max: 100 },
    coverageIncomeMultiple: { type: Number, min: 0, max: 100 },
  },
  { _id: false },
);

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, enum: PRODUCT_CATEGORIES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    basePremium: { type: Number, required: true, min: 0 },
    coverageAmount: { type: Number, required: true, min: 0 },
    keyBenefits: { type: [String], default: [] },
    eligibilityRules: { type: eligibilityRulesSchema, default: () => ({}) },
    pricingFactors: { type: pricingFactorsSchema, default: () => ({ ageBands: [] }) },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'products' },
);

// The product catalogue is browsed by category and the eligibility engine loads
// every active product at once, so both queries are served by this index.
productSchema.index({ active: 1, category: 1 }, { name: 'idx_product_active_category' });
// A product name must be unique within its category so the seed script is
// re-runnable (upsert by name+category) without creating duplicates.
productSchema.index({ name: 1, category: 1 }, { unique: true, name: 'uniq_product_name_category' });

applyToJSON(productSchema);

export const ProductModel: Model<ProductDocument> =
  (mongoose.models.Product as Model<ProductDocument>) ??
  mongoose.model<ProductDocument>('Product', productSchema);
