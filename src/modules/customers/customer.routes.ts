import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../../utils/validators';
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './customer.validators';
import * as customerController from './customer.controller';

export const customerRouter = Router();

customerRouter.use(requireAuth, requireRole('AGENT', 'ADMIN'));

customerRouter
  .route('/')
  .get(validate({ query: listCustomersQuerySchema }), customerController.listCustomers)
  .post(validate({ body: createCustomerSchema }), customerController.createCustomer);

customerRouter
  .route('/:id')
  .get(validate({ params: idParamSchema }), customerController.getCustomer)
  .put(
    validate({ params: idParamSchema, body: updateCustomerSchema }),
    customerController.updateCustomer,
  )
  .delete(validate({ params: idParamSchema }), customerController.deleteCustomer);

customerRouter.get(
  '/:id/eligible-products',
  validate({ params: idParamSchema }),
  customerController.getEligibleProducts,
);
