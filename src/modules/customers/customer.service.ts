import mongoose, { type FilterQuery } from 'mongoose';
import { CustomerModel, type CustomerDocument } from './customer.model';
import { ProductModel } from '../products/product.model';
import { QuotationModel } from '../quotations/quotation.model';
import { DocumentModel } from '../documents/document.model';
import { PaymentModel } from '../payments/payment.model';
import { PolicyModel } from '../policies/policy.model';
import { OPEN_PAYMENT_STATUSES } from '../../config/constants';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/AppError';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { buildCustomerProfile, evaluateEligibility } from '../eligibility/eligibility.service';
import { calculatePremium } from '../quotations/premium.service';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from './customer.validators';

/**
 * Ownership is enforced in the data layer, not the controller: every read and
 * write is scoped by `createdByAgent`. An agent guessing another agent's
 * customer id gets a 404, never someone else's personal data.
 */
function ownedBy(agentId: string, customerId?: string): FilterQuery<CustomerDocument> {
  const filter: FilterQuery<CustomerDocument> = {
    createdByAgent: new mongoose.Types.ObjectId(agentId),
  };
  if (customerId) filter._id = new mongoose.Types.ObjectId(customerId);
  return filter;
}

export async function createCustomer(agentId: string, input: CreateCustomerInput) {
  try {
    const customer = await CustomerModel.create({
      ...input,
      // A customer who does not own a vehicle must not carry stale vehicle data,
      // or the eligibility engine would see contradictory facts.
      vehicle: input.vehicle.owns ? input.vehicle : { owns: false },
      createdByAgent: new mongoose.Types.ObjectId(agentId),
    });
    return customer.toJSON();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern ?? {}).find((k) => k !== 'createdByAgent');
      throw AppError.conflict(
        field === 'phone'
          ? 'You have already added a customer with this phone number.'
          : 'You have already added a customer with this email address.',
      );
    }
    throw error;
  }
}

export async function listCustomers(agentId: string, query: ListCustomersQuery) {
  const filter = ownedBy(agentId);

  if (query.search) {
    const term = escapeRegex(query.search);
    filter.$or = [
      { firstName: { $regex: term, $options: 'i' } },
      { lastName: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { phone: { $regex: term, $options: 'i' } },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    CustomerModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    CustomerModel.countDocuments(filter),
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

/** Internal: returns the hydrated document for services that need raw fields. */
export async function getOwnedCustomerDocument(
  agentId: string,
  customerId: string,
): Promise<CustomerDocument> {
  const customer = await CustomerModel.findOne(ownedBy(agentId, customerId));
  if (!customer) throw AppError.notFound('Customer');
  return customer;
}

export async function getCustomerById(agentId: string, customerId: string) {
  const customer = await getOwnedCustomerDocument(agentId, customerId);
  return customer.toJSON();
}

export async function updateCustomer(
  agentId: string,
  customerId: string,
  input: UpdateCustomerInput,
) {
  const update: Record<string, unknown> = { ...input };
  if (input.vehicle && !input.vehicle.owns) {
    update.vehicle = { owns: false };
  }

  try {
    const customer = await CustomerModel.findOneAndUpdate(
      ownedBy(agentId, customerId),
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!customer) throw AppError.notFound('Customer');
    return customer.toJSON();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict('Another of your customers already uses this email or phone number.');
    }
    throw error;
  }
}

export interface DeleteCustomerResult {
  deletedQuotations: number;
  deletedDocuments: number;
  deletedPayments: number;
}

/**
 * Deletes a customer, but only while nothing financial has happened to them.
 *
 * Two hard blocks, both checked server-side:
 *   - an issued policy is a financial record and an obligation to the customer;
 *     it must never be orphaned or silently removed
 *   - a payment that is SUCCEEDED, or still open (CREATED/PENDING), means money
 *     has moved or a live Stripe checkout link is in the customer's hands. If
 *     that link were paid after the customer was deleted, the webhook would
 *     activate a policy for someone who no longer exists.
 *
 * Because a policy can only ever be created from an open payment, refusing on
 * open payments also closes the check-then-delete window: if there is no open
 * payment at the moment of the check, no new policy can appear afterwards.
 *
 * What IS removed with the customer: their quotations, the document records for
 * those quotations (which invalidates any shared PDF link), and dead payment
 * attempts (FAILED/EXPIRED) — offers and abandoned attempts, none of which
 * represent money.
 */
export async function deleteCustomer(
  agentId: string,
  customerId: string,
): Promise<DeleteCustomerResult> {
  const customer = await getOwnedCustomerDocument(agentId, customerId);
  const name = `${customer.firstName} ${customer.lastName}`;

  const [policyCount, livePaymentCount] = await Promise.all([
    PolicyModel.countDocuments({ customerId: customer._id }),
    PaymentModel.countDocuments({
      customerId: customer._id,
      status: { $in: ['SUCCEEDED', ...OPEN_PAYMENT_STATUSES] },
    }),
  ]);

  if (policyCount > 0) {
    throw AppError.conflict(
      `${name} has ${policyCount} ${policyCount === 1 ? 'policy' : 'policies'} on record and cannot be deleted. Policies are financial records and must be retained.`,
    );
  }

  if (livePaymentCount > 0) {
    throw AppError.conflict(
      `${name} has a payment in progress or already paid. Wait for it to complete or expire before deleting this customer.`,
    );
  }

  // Children first: if any step fails the customer is still listed and the
  // delete can simply be retried, rather than leaving orphaned records behind.
  const documents = await DocumentModel.deleteMany({ customerId: customer._id });
  const quotations = await QuotationModel.deleteMany({ customerId: customer._id });
  const payments = await PaymentModel.deleteMany({ customerId: customer._id });
  await CustomerModel.deleteOne({ _id: customer._id });

  logger.info('customer deleted', {
    customerId: customer.id,
    agentId,
    deletedQuotations: quotations.deletedCount,
    deletedDocuments: documents.deletedCount,
    deletedPayments: payments.deletedCount,
  });

  return {
    deletedQuotations: quotations.deletedCount,
    deletedDocuments: documents.deletedCount,
    deletedPayments: payments.deletedCount,
  };
}

export interface EligibleProductEntry {
  product: Record<string, unknown>;
  eligible: boolean;
  failures: { rule: string; message: string }[];
  /** Present only when the customer is eligible — an ineligible product has no
   *  meaningful price, and quoting one would be misleading. */
  quote?: { premiumAmount: number; coverageAmount: number };
}

/**
 * Evaluates the whole active catalogue for one customer in a single pass.
 * Ineligible products are returned too, with their reasons, so the agent can
 * explain to the customer why an option is not on the table.
 */
export async function getEligibleProducts(agentId: string, customerId: string) {
  const customer = await getOwnedCustomerDocument(agentId, customerId);
  const products = await ProductModel.find({ active: true }).sort({ category: 1, name: 1 });

  const profile = buildCustomerProfile(customer);

  const entries: EligibleProductEntry[] = products.map((product) => {
    const { eligible, failures } = evaluateEligibility(profile, product.eligibilityRules);
    if (!eligible) return { product: product.toJSON(), eligible, failures };

    const { premiumAmount, coverageAmount } = calculatePremium(product, profile);
    return { product: product.toJSON(), eligible, failures, quote: { premiumAmount, coverageAmount } };
  });

  return {
    profile,
    eligible: entries.filter((entry) => entry.eligible),
    ineligible: entries.filter((entry) => !entry.eligible),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
