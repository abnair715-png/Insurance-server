import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../../utils/validators';
import { listProductsQuerySchema } from './product.validators';
import * as productController from './product.controller';

export const productRouter = Router();

// The catalogue is agent-facing internal data, so it sits behind auth even
// though it contains no personal information.
productRouter.use(requireAuth);

productRouter.get('/', validate({ query: listProductsQuerySchema }), productController.listProducts);
productRouter.get('/:id', validate({ params: idParamSchema }), productController.getProduct);
