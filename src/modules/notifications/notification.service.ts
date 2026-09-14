import mongoose from 'mongoose';
import { NotificationModel } from './notification.model';
import { getEmailProvider } from './email.service';
import { renderPolicyActivatedEmail } from './email.templates';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import type { PolicyDocument } from '../policies/policy.model';

/**
 * Email delivery is DELIBERATELY OUTSIDE the money path.
 *
 * By the time this runs, the payment is recorded and the policy is active. A
 * provider outage, a bounced address or a rate limit must not undo any of that,
 * so every failure here is caught, persisted on the notification row and
 * logged — never rethrown into the webhook handler.
 */
export async function sendPolicyActivationEmail(policy: PolicyDocument): Promise<void> {
  const { subject, html, text } = renderPolicyActivatedEmail(policy);
  const provider = getEmailProvider();

  // Claim the send. The unique index on (policyId, type) means a replayed
  // webhook that somehow reaches this point cannot email the customer twice.
  let notificationId: mongoose.Types.ObjectId;
  try {
    const notification = await NotificationModel.create({
      type: 'POLICY_ACTIVATED',
      to: policy.customerEmail,
      subject,
      status: 'PENDING',
      policyId: policy._id,
      provider: provider.name,
      attempts: 0,
    });
    notificationId = notification._id;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      logger.info('policy activation email already recorded — skipping', {
        policyId: policy.id,
      });
      return;
    }
    logger.error('failed to record policy activation email', {
      policyId: policy.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    const result = await provider.send({ to: policy.customerEmail, subject, html, text });
    await NotificationModel.updateOne(
      { _id: notificationId },
      {
        $set: { status: 'SENT', sentAt: new Date(), providerMessageId: result.id },
        $inc: { attempts: 1 },
      },
    );
    logger.info('policy activation email sent', {
      policyId: policy.id,
      provider: provider.name,
      messageId: result.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await NotificationModel.updateOne(
      { _id: notificationId },
      { $set: { status: 'FAILED', lastError: message.slice(0, 500) }, $inc: { attempts: 1 } },
    );
    // Logged and left as a FAILED row for `retryFailedNotifications` to pick up.
    logger.error('policy activation email failed', { policyId: policy.id, error: message });
  }
}

/**
 * Retry pass over failed sends.
 *
 * The MVP has no queue or cron: this is exposed as an authenticated admin
 * endpoint an operator can trigger, which is honest about the trade-off. The
 * production step is a scheduled job reading the same FAILED rows — the data
 * model does not change. See docs/technical-decisions.md.
 */
const MAX_ATTEMPTS = 3;

export async function retryFailedNotifications(limit = 20): Promise<{ retried: number; sent: number }> {
  const failed = await NotificationModel.find({
    status: 'FAILED',
    attempts: { $lt: MAX_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .populate<{ policyId: PolicyDocument }>('policyId');

  let sent = 0;
  const provider = getEmailProvider();

  for (const notification of failed) {
    const policy = notification.policyId as unknown as PolicyDocument;
    if (!policy) continue;

    const { subject, html, text } = renderPolicyActivatedEmail(policy);
    try {
      const result = await provider.send({ to: notification.to, subject, html, text });
      await NotificationModel.updateOne(
        { _id: notification._id },
        {
          $set: { status: 'SENT', sentAt: new Date(), providerMessageId: result.id },
          $inc: { attempts: 1 },
        },
      );
      sent += 1;
    } catch (error) {
      await NotificationModel.updateOne(
        { _id: notification._id },
        {
          $set: { lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
          $inc: { attempts: 1 },
        },
      );
    }
  }

  return { retried: failed.length, sent };
}
