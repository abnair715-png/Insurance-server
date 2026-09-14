import { objectIdSchema, paginationSchema } from '../../utils/validators';

export const listPoliciesQuerySchema = paginationSchema.extend({
  customerId: objectIdSchema.optional(),
});
