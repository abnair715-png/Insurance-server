import { z } from 'zod';
import { objectIdSchema, paginationSchema } from '../../utils/validators';

/**
 * Note what is NOT here: no premium, no coverage amount, no currency. The client
 * nominates a customer and a product; every monetary figure is derived server
 * side from the stored product and customer.
 */
export const createQuotationSchema = z.object({
  customerId: objectIdSchema,
  productId: objectIdSchema,
});

export const listQuotationsQuerySchema = paginationSchema.extend({
  customerId: objectIdSchema.optional(),
});

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type ListQuotationsQuery = z.infer<typeof listQuotationsQuerySchema>;
