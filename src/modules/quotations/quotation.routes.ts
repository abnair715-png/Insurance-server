import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../../utils/validators';
import { createQuotationSchema, listQuotationsQuerySchema } from './quotation.validators';
import * as quotationController from './quotation.controller';

export const quotationRouter = Router();

quotationRouter.use(requireAuth);

quotationRouter
  .route('/')
  .get(validate({ query: listQuotationsQuerySchema }), quotationController.listQuotations)
  .post(validate({ body: createQuotationSchema }), quotationController.createQuotation);

quotationRouter.get('/:id', validate({ params: idParamSchema }), quotationController.getQuotation);
