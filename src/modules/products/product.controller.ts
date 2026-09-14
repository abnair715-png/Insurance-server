import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import * as productService from './product.service';
import type { ListProductsQuery } from './product.validators';

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await productService.listProducts(
    req.query as unknown as ListProductsQuery,
  );
  return sendSuccess(res, { products: items }, 200, meta);
});

export const getProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.getProductById(req.params.id);
  return sendSuccess(res, { product });
});
