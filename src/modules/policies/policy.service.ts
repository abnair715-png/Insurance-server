import mongoose from 'mongoose';
import { PolicyModel, type PolicyDocument } from './policy.model';
import { AppError } from '../../utils/AppError';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { logger } from '../../config/logger';
import { generatePolicyNumber } from '../../utils/references';
import { addMonths } from '../../utils/dates';
import { POLICY_TERM_MONTHS } from '../../config/constants';
import type { PaymentDocument } from '../payments/payment.model';
import type { QuotationDocument } from '../quotations/quotation.model';

export interface ActivationResult {
  policy: PolicyDocument;
  /** `false` when the policy already existed — the signal that this webhook
   *  delivery is a replay and the side effects (email) must not run again. */
  created: boolean;
}

/**
 * Activates the policy for a successful payment — exactly once.
 *
 * Correctness rests on the unique index on `paymentId`, not on a prior read:
 * two concurrent webhook deliveries both attempt the insert, the database lets
 * exactly one through, and the loser's duplicate-key error is translated into
 * `created: false`. No transaction, no lock, no read-check-write window.
 */
export async function activatePolicyForPayment(
  payment: PaymentDocument,
  quotation: QuotationDocument,
): Promise<ActivationResult> {
  const startDate = payment.paidAt ?? new Date();

  try {
    const policy = await PolicyModel.create({
      policyNumber: generatePolicyNumber(),
      quotationId: quotation._id,
      quotationReference: quotation.reference,
      paymentId: payment._id,
      customerId: payment.customerId,
      productId: payment.productId,
      agentId: payment.agentId,
      customerName: quotation.customerSnapshot.fullName,
      customerEmail: quotation.customerSnapshot.email,
      productName: quotation.productSnapshot.name,
      productCategory: quotation.productSnapshot.category,
      premiumAmount: payment.amount,
      coverageAmount: quotation.coverageAmount,
      currency: payment.currency,
      status: 'ACTIVE',
      startDate,
      endDate: addMonths(startDate, POLICY_TERM_MONTHS),
      activatedAt: new Date(),
    });

    logger.info('policy activated', {
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      paymentId: payment.id,
    });
    return { policy, created: true };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await PolicyModel.findOne({ paymentId: payment._id });
      if (existing) {
        logger.info('policy already active for payment — activation skipped', {
          policyId: existing.id,
          paymentId: payment.id,
        });
        return { policy: existing, created: false };
      }
    }
    throw error;
  }
}

export async function listPolicies(
  agentId: string,
  query: { page: number; limit: number; customerId?: string },
) {
  const filter: Record<string, unknown> = { agentId: new mongoose.Types.ObjectId(agentId) };
  if (query.customerId) filter.customerId = new mongoose.Types.ObjectId(query.customerId);

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    PolicyModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    PolicyModel.countDocuments(filter),
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

export async function getPolicyById(agentId: string, policyId: string) {
  const policy = await PolicyModel.findOne({
    _id: new mongoose.Types.ObjectId(policyId),
    agentId: new mongoose.Types.ObjectId(agentId),
  });
  if (!policy) throw AppError.notFound('Policy');
  return policy.toJSON();
}
