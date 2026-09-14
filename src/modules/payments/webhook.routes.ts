import { Router } from 'express';
import * as paymentController from './payment.controller';

/**
 * Mounted separately from `paymentRouter` because this endpoint must never sit
 * behind `requireAuth`: Stripe is the caller, and its signature header is the
 * credential. Authorisation is the signature check in `verifyStripeEvent`.
 */
export const webhookRouter = Router();

webhookRouter.post('/stripe', paymentController.stripeWebhook);
