import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { AGENT_ROLES, type AgentRole } from '../../config/constants';
import { applyToJSON } from '../../db/plugins';

export interface AgentDocument extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  /** bcrypt hash. `select: false` keeps it out of every query result by default. */
  passwordHash: string;
  phone: string;
  role: AgentRole;
  createdAt: Date;
  updatedAt: Date;
}

const agentSchema = new Schema<AgentDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      // Stored lowercased so the unique index is effectively case-insensitive
      // without needing a collation-aware index.
      lowercase: true,
      trim: true,
      maxlength: 255,
    },
    passwordHash: { type: String, required: true, select: false },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    role: { type: String, enum: AGENT_ROLES, default: 'AGENT', required: true },
  },
  { timestamps: true, collection: 'agents' },
);

// Login and signup both look agents up by email; uniqueness is what makes
// "email already registered" a 409 rather than a silent duplicate account.
agentSchema.index({ email: 1 }, { unique: true, name: 'uniq_agent_email' });

applyToJSON(agentSchema, ['passwordHash']);

export const AgentModel: Model<AgentDocument> =
  (mongoose.models.Agent as Model<AgentDocument>) ??
  mongoose.model<AgentDocument>('Agent', agentSchema);
