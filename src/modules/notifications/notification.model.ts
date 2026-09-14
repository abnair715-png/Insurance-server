import mongoose, { Schema, type Document, type Model } from 'mongoose';
import { NOTIFICATION_STATUSES, type NotificationStatus } from '../../config/constants';
import { applyToJSON } from '../../db/plugins';

export const NOTIFICATION_TYPES = ['POLICY_ACTIVATED'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Outbox for transactional email.
 *
 * A row is written BEFORE the provider is called, so a crash mid-send leaves an
 * auditable PENDING record rather than silence. The unique index on
 * (policyId, type) is what stops a replayed webhook emailing the customer twice.
 */
export interface NotificationDocument extends Document {
  _id: mongoose.Types.ObjectId;
  type: NotificationType;
  to: string;
  subject: string;
  status: NotificationStatus;
  policyId: mongoose.Types.ObjectId;
  attempts: number;
  provider: string;
  providerMessageId?: string;
  lastError?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDocument>(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    to: { type: String, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: NOTIFICATION_STATUSES, required: true, default: 'PENDING' },
    policyId: { type: Schema.Types.ObjectId, ref: 'Policy', required: true },
    attempts: { type: Number, required: true, default: 0 },
    provider: { type: String, required: true },
    providerMessageId: { type: String },
    lastError: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true, collection: 'notifications' },
);

notificationSchema.index(
  { policyId: 1, type: 1 },
  { unique: true, name: 'uniq_notification_policy_type' },
);
notificationSchema.index({ status: 1, createdAt: 1 }, { name: 'idx_notification_status' });

applyToJSON(notificationSchema);

export const NotificationModel: Model<NotificationDocument> =
  (mongoose.models.Notification as Model<NotificationDocument>) ??
  mongoose.model<NotificationDocument>('Notification', notificationSchema);
