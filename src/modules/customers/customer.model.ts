import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { GENDERS, VEHICLE_TYPES, type Gender, type VehicleType } from '../../config/constants';
import { applyToJSON } from '../../db/plugins';

export interface CustomerVehicle {
  owns: boolean;
  type?: VehicleType;
  /** Insured declared value, minor currency units. */
  value?: number;
  registrationYear?: number;
}

/**
 * Only the two self-declared flags actually consumed by the eligibility and
 * pricing rules are collected. Storing real medical history would put the MVP
 * in scope for health-data regulation for no demonstrable benefit.
 */
export interface CustomerHealth {
  smoker: boolean;
  preExistingConditions: boolean;
}

export interface CustomerDocument extends Document {
  _id: mongoose.Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: Date;
  gender: Gender;
  occupation: string;
  /** Annual income in minor currency units. */
  annualIncome: number;
  city: string;
  state: string;
  postalCode: string;
  vehicle: CustomerVehicle;
  health: CustomerHealth;
  createdByAgent: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  fullName: string;
}

const customerSchema = new Schema<CustomerDocument>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 255 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, enum: GENDERS, required: true },
    occupation: { type: String, required: true, trim: true, maxlength: 120 },
    annualIncome: { type: Number, required: true, min: 0 },
    city: { type: String, required: true, trim: true, maxlength: 120 },
    state: { type: String, required: true, trim: true, maxlength: 120 },
    postalCode: { type: String, required: true, trim: true, maxlength: 12 },
    vehicle: {
      owns: { type: Boolean, required: true, default: false },
      type: { type: String, enum: VEHICLE_TYPES },
      value: { type: Number, min: 0 },
      registrationYear: { type: Number, min: 1950 },
    },
    health: {
      smoker: { type: Boolean, required: true, default: false },
      preExistingConditions: { type: Boolean, required: true, default: false },
    },
    createdByAgent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
  },
  { timestamps: true, collection: 'customers' },
);

customerSchema.virtual('fullName').get(function (this: CustomerDocument) {
  return `${this.firstName} ${this.lastName}`;
});

/**
 * Ownership scoping: every customer list query filters by `createdByAgent`, and
 * this compound index serves that query sorted by recency.
 */
customerSchema.index({ createdByAgent: 1, createdAt: -1 }, { name: 'idx_customer_agent_created' });

/**
 * Email and phone are unique PER AGENT, not globally. Two agents legitimately
 * serving the same person must both be able to record them; the same agent
 * entering the same person twice is a data-entry mistake and gets a 409.
 */
customerSchema.index(
  { createdByAgent: 1, email: 1 },
  { unique: true, name: 'uniq_customer_agent_email' },
);
customerSchema.index(
  { createdByAgent: 1, phone: 1 },
  { unique: true, name: 'uniq_customer_agent_phone' },
);
// Supports the dashboard search box across name, email and phone.
customerSchema.index(
  { firstName: 'text', lastName: 'text', email: 'text', phone: 'text' },
  { name: 'txt_customer_search' },
);

applyToJSON(customerSchema);

export const CustomerModel: Model<CustomerDocument> =
  (mongoose.models.Customer as Model<CustomerDocument>) ??
  mongoose.model<CustomerDocument>('Customer', customerSchema);
