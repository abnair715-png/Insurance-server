import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import { NotificationModel } from './notification.model';
import { retryFailedNotifications } from './notification.service';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

/** Delivery log for the policies this agent wrote — the answer to "did the
 *  customer actually get their confirmation email?" */
notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.agent) throw AppError.unauthenticated();

    const notifications = await NotificationModel.find()
      .populate({
        path: 'policyId',
        match: { agentId: new mongoose.Types.ObjectId(req.agent.id) },
        select: 'policyNumber customerName agentId',
      })
      .sort({ createdAt: -1 })
      .limit(50);

    return sendSuccess(res, {
      notifications: notifications
        .filter((notification) => notification.policyId)
        .map((notification) => notification.toJSON()),
    });
  }),
);

/**
 * Manual retry for failed sends. The MVP has no scheduler, so an operator
 * triggers this; the production replacement is a cron job calling the same
 * service function. See docs/technical-decisions.md.
 */
notificationRouter.post(
  '/retry-failed',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, await retryFailedNotifications());
  }),
);
