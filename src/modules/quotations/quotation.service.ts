import mongoose from 'mongoose';
import { QuotationModel, type QuotationDocument } from './quotation.model';
import { AppError } from '../../utils/AppError';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import { generateQuotationReference } from '../../utils/references';
import { addDays } from '../../utils/dates';
import { getOwnedCustomerDocument } from '../customers/customer.service';
import { getActiveProductDocument } from '../products/product.service';
import { buildCustomerProfile, evaluateEligibility } from '../eligibility/eligibility.service';
import { calculatePremium } from './premium.service';
import type { CreateQuotationInput, ListQuotationsQuery } from './quotation.validators';

/** How long a quoted premium is honoured. Real insurers re-rate after this. */
const QUOTATION_VALIDITY_DAYS = 30;

/** Statuses in which the premium may still be recalculated. Once a payment has
 *  been initiated the price is frozen — the customer may already be looking at
 *  a Stripe checkout page for that exact amount. */
const REPRICEABLE_STATUSES = ['DRAFT', 'DOCUMENT_GENERATED'];

/**
 * Creates — or returns — the open quotation for a customer/product pair.
 *
 * Idempotent by design. The unique partial index on (customerId, productId)
 * where `isOpen` guarantees only one open quotation can exist, so repeated
 * "select this product" clicks converge on the same reference instead of
 * spawning duplicates. If the customer's details changed since the quotation
 * was raised, the premium is recalculated in place rather than silently
 * honouring a stale price.
 */
export async function createOrGetQuotation(
  agentId: string,
  agentName: string,
  input: CreateQuotationInput,
) {
  const [customer, product] = await Promise.all([
    getOwnedCustomerDocument(agentId, input.customerId),
    getActiveProductDocument(input.productId),
  ]);

  const profile = buildCustomerProfile(customer);
  const { eligible, failures } = evaluateEligibility(profile, product.eligibilityRules);

  // The eligibility check is enforced here, server side. The UI hides ineligible
  // products, but a crafted request must not be able to quote one.
  if (!eligible) {
    throw AppError.businessRule(
      `${customer.firstName} is not eligible for ${product.name}: ${failures
        .map((f) => f.message)
        .join(' ')}`,
    );
  }

  const { premiumAmount, coverageAmount, breakdown } = calculatePremium(product, profile);

  const existing = await QuotationModel.findOne({
    customerId: customer._id,
    productId: product._id,
    isOpen: true,
  });

  if (existing) {
    if (REPRICEABLE_STATUSES.includes(existing.status) && existing.premiumAmount !== premiumAmount) {
      existing.premiumAmount = premiumAmount;
      existing.coverageAmount = coverageAmount;
      existing.premiumBreakdown = breakdown;
      existing.eligibilitySnapshot = profile;
      existing.expiresAt = addDays(new Date(), QUOTATION_VALIDITY_DAYS);
      await existing.save();
      logger.info('quotation repriced', { quotationId: existing.id, premiumAmount });
    }
    return existing.toJSON();
  }

  try {
    const quotation = await QuotationModel.create({
      reference: generateQuotationReference(),
      customerId: customer._id,
      productId: product._id,
      agentId: new mongoose.Types.ObjectId(agentId),
      agentName,
      premiumAmount,
      coverageAmount,
      currency: env.STRIPE_CURRENCY,
      premiumBreakdown: breakdown,
      customerSnapshot: {
        fullName: `${customer.firstName} ${customer.lastName}`,
        email: customer.email,
        phone: customer.phone,
        age: profile.age,
        city: customer.city,
        state: customer.state,
      },
      productSnapshot: {
        name: product.name,
        category: product.category,
        description: product.description,
        keyBenefits: product.keyBenefits,
      },
      eligibilitySnapshot: profile,
      status: 'DRAFT',
      isOpen: true,
      expiresAt: addDays(new Date(), QUOTATION_VALIDITY_DAYS),
    });
    logger.info('quotation created', { quotationId: quotation.id, reference: quotation.reference });
    return quotation.toJSON();
  } catch (error) {
    // A concurrent request won the race and inserted first. The unique index
    // rejected this one, so read back the winner and return it — the caller
    // still gets exactly the quotation it asked for.
    if (isDuplicateKeyError(error)) {
      const winner = await QuotationModel.findOne({
        customerId: customer._id,
        productId: product._id,
        isOpen: true,
      });
      if (winner) return winner.toJSON();
    }
    throw error;
  }
}

/** Internal accessor that also enforces agent ownership. */
export async function getOwnedQuotationDocument(
  agentId: string,
  quotationId: string,
): Promise<QuotationDocument> {
  const quotation = await QuotationModel.findOne({
    _id: new mongoose.Types.ObjectId(quotationId),
    agentId: new mongoose.Types.ObjectId(agentId),
  });
  if (!quotation) throw AppError.notFound('Quotation');
  return quotation;
}

export async function getQuotationById(agentId: string, quotationId: string) {
  const quotation = await getOwnedQuotationDocument(agentId, quotationId);
  return quotation.toJSON();
}

export async function listQuotations(agentId: string, query: ListQuotationsQuery) {
  const filter: Record<string, unknown> = { agentId: new mongoose.Types.ObjectId(agentId) };
  if (query.customerId) filter.customerId = new mongoose.Types.ObjectId(query.customerId);

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    QuotationModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    QuotationModel.countDocuments(filter),
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

/**
 * Advances a quotation's status, never backwards. `DRAFT -> DOCUMENT_GENERATED`
 * must not undo `PAYMENT_PENDING` if the agent regenerates a PDF after sending
 * the payment link.
 */
const STATUS_RANK: Record<string, number> = {
  DRAFT: 0,
  DOCUMENT_GENERATED: 1,
  PAYMENT_PENDING: 2,
  CONVERTED: 3,
  EXPIRED: 3,
};

export async function advanceQuotationStatus(
  quotationId: mongoose.Types.ObjectId | string,
  status: 'DOCUMENT_GENERATED' | 'PAYMENT_PENDING' | 'CONVERTED' | 'EXPIRED',
) {
  const lowerRanks = Object.entries(STATUS_RANK)
    .filter(([, rank]) => rank < STATUS_RANK[status])
    .map(([key]) => key);

  await QuotationModel.updateOne(
    { _id: quotationId, status: { $in: lowerRanks } },
    {
      $set: {
        status,
        // A converted or expired quotation is no longer open, which frees the
        // partial unique index for a future quotation on the same product.
        isOpen: status !== 'CONVERTED' && status !== 'EXPIRED',
      },
    },
  );
}
