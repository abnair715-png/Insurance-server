import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import * as paymentService from './payment.service';
import { handleStripeEvent, verifyStripeEvent } from './webhook.service';

const agentId = (req: Request): string => {
  if (!req.agent) throw AppError.unauthenticated();
  return req.agent.id;
};

export const createPaymentLink = asyncHandler(async (req: Request, res: Response) => {
  const result = await paymentService.createPaymentLink(agentId(req), req.body.quotationId);
  // 200 rather than 201 when an existing link was reused, so the caller can see
  // the idempotent path was taken.
  return result.reused ? sendSuccess(res, result) : sendCreated(res, result);
});

export const getPayment = asyncHandler(async (req: Request, res: Response) => {
  const result = await paymentService.getPaymentById(agentId(req), req.params.id);
  return sendSuccess(res, result);
});

export const listPaymentsForQuotation = asyncHandler(async (req: Request, res: Response) => {
  const payments = await paymentService.listPaymentsForQuotation(
    agentId(req),
    req.params.quotationId,
  );
  return sendSuccess(res, { payments });
});

/** Unauthenticated: the page the customer lands on after Stripe redirects back. */
export const getPublicPaymentStatus = asyncHandler(async (req: Request, res: Response) => {
  const status = await paymentService.getPublicPaymentStatus(req.params.reference);
  return sendSuccess(res, status);
});

/**
 * Stripe webhook receiver.
 *
 * Verification happens against `req.rawBody` — the exact bytes Stripe signed.
 * The response is intentionally minimal: Stripe only looks at the status code.
 */
export const stripeWebhook = asyncHandler(async (req: Request, res: Response) => {
  if (!Buffer.isBuffer(req.rawBody)) {
    throw AppError.badRequest('Webhook payload could not be read.');
  }

  const signature = req.headers['stripe-signature'];
  const event = verifyStripeEvent(req.rawBody, typeof signature === 'string' ? signature : undefined);
  const result = await handleStripeEvent(event);

  return sendSuccess(res, result);
});
