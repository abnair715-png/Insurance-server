import type { FilterQuery } from 'mongoose';
import { ProductModel, type ProductDocument } from './product.model';
import { AppError } from '../../utils/AppError';
import type { ListProductsQuery } from './product.validators';

export async function listProducts(query: ListProductsQuery) {
  const filter: FilterQuery<ProductDocument> = {};
  if (!query.includeInactive) filter.active = true;
  if (query.category) filter.category = query.category;
  if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: 'i' };

  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    ProductModel.find(filter).sort({ category: 1, basePremium: 1 }).skip(skip).limit(query.limit),
    ProductModel.countDocuments(filter),
  ]);

  return {
    items: items.map((item) => item.toJSON()),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

export async function getProductById(id: string) {
  const product = await ProductModel.findById(id);
  if (!product) throw AppError.notFound('Product');
  return product.toJSON();
}

/** Loads the raw document (not JSON) for internal callers that need the
 *  eligibility rules and pricing factors, e.g. the quotation service. */
export async function getActiveProductDocument(id: string): Promise<ProductDocument> {
  const product = await ProductModel.findById(id);
  if (!product) throw AppError.notFound('Product');
  if (!product.active) {
    throw AppError.businessRule('This product is no longer available for new quotations.');
  }
  return product;
}

/** User input reaches a `$regex`, so metacharacters must be neutralised to
 *  prevent a crafted search term becoming a catastrophic-backtracking DoS. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
