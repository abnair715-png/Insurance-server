import mongoose from 'mongoose';
import { CustomerModel } from '../customers/customer.model';
import { ProductModel } from '../products/product.model';
import { PolicyModel } from '../policies/policy.model';
import { PaymentModel } from '../payments/payment.model';
import { QuotationModel } from '../quotations/quotation.model';


export interface DashboardStats {
  totalCustomers: number;
  activePolicies: number;
  pendingPayments: number;
  availableProducts: number;
  openQuotations: number;
  /** Sum of premiums on active policies, minor currency units. */
  premiumWritten: number;
}

/**
 * All counts are scoped to the requesting agent — an agent sees their own book,
 * not the company's. The six aggregates run concurrently; each is served by an
 * existing index, so this stays a handful of covered counts rather than a scan.
 */
export async function getDashboardStats(agentId: string) {
  const agent = new mongoose.Types.ObjectId(agentId);

  const [totalCustomers, activePolicies, pendingPayments, availableProducts, openQuotations, premium] =
    await Promise.all([
      CustomerModel.countDocuments({ createdByAgent: agent }),
      PolicyModel.countDocuments({ agentId: agent, status: 'ACTIVE' }),
      // Only PENDING counts: a CREATED row is an attempt whose checkout session
      // does not exist yet (Stripe unreachable, or the request is still in
      // flight), so it is not something the customer can act on.
      PaymentModel.countDocuments({ agentId: agent, status: 'PENDING' }),
      ProductModel.countDocuments({ active: true }),
      QuotationModel.countDocuments({ agentId: agent, isOpen: true }),
      PolicyModel.aggregate<{ total: number }>([
        { $match: { agentId: agent, status: 'ACTIVE' } },
        { $group: { _id: null, total: { $sum: '$premiumAmount' } } },
      ]),
    ]);

  const stats: DashboardStats = {
    totalCustomers,
    activePolicies,
    pendingPayments,
    availableProducts,
    openQuotations,
    premiumWritten: premium[0]?.total ?? 0,
  };

  const recentPolicies = await PolicyModel.find({ agentId: agent })
    .sort({ createdAt: -1 })
    .limit(5);

  const recentCustomers = await CustomerModel.find({ createdByAgent: agent })
    .sort({ createdAt: -1 })
    .limit(5);

  return {
    stats,
    recentPolicies: recentPolicies.map((policy) => policy.toJSON()),
    recentCustomers: recentCustomers.map((customer) => customer.toJSON()),
  };
}
