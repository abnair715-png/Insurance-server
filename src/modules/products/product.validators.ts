import { z } from 'zod';
import { PRODUCT_CATEGORIES } from '../../config/constants';
import { paginationSchema } from '../../utils/validators';

export const listProductsQuerySchema = paginationSchema.extend({
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  // Defaults to active-only: the catalogue an agent sells from should never
  // include withdrawn products unless explicitly requested.
  includeInactive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => value === true || value === 'true'),
  search: z.string().trim().max(120).optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
