import { z } from 'zod';
import { objectIdSchema } from '../../utils/validators';

/**
 * The ONLY field accepted when creating a payment link. No amount, no currency,
 * no product — all of that is read from the stored quotation server side, so a
 * request such as `{"amount": 1}` has nothing to attach to.
 */
export const createPaymentLinkSchema = z.object({
  quotationId: objectIdSchema,
});

export const publicStatusParamSchema = z.object({
  reference: z.string().regex(/^QTN-\d{4}-[0-9A-Z]{8}$/, 'Invalid quotation reference.'),
});

export type CreatePaymentLinkInput = z.infer<typeof createPaymentLinkSchema>;
