import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { paymentRateLimiter } from '../../middleware/rateLimiter';
import { idParamSchema, objectIdSchema } from '../../utils/validators';
import { createPaymentLinkSchema, publicStatusParamSchema } from './payment.validators';
import * as paymentController from './payment.controller';

export const paymentRouter = Router();

/** Public status page for the customer returning from Stripe Checkout. */
paymentRouter.get(
  '/public/status/:reference',
  validate({ params: publicStatusParamSchema }),
  paymentController.getPublicPaymentStatus,
);

paymentRouter.use(requireAuth);

paymentRouter.post(
  '/create-link',
  paymentRateLimiter,
  validate({ body: createPaymentLinkSchema }),
  paymentController.createPaymentLink,
);

paymentRouter.get(
  '/by-quotation/:quotationId',
  validate({ params: z.object({ quotationId: objectIdSchema }) }),
  paymentController.listPaymentsForQuotation,
);

paymentRouter.get('/:id', validate({ params: idParamSchema }), paymentController.getPayment);
