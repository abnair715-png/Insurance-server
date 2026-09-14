import mongoose from 'mongoose';
import type Stripe from 'stripe';
import { PaymentModel, type PaymentDocument } from './payment.model';
import { getStripe } from './stripe.client';
import { QuotationModel } from '../quotations/quotation.model';
import { advanceQuotationStatus, getOwnedQuotationDocument } from '../quotations/quotation.service';
import { PolicyModel } from '../policies/policy.model';
import { AppError } from '../../utils/AppError';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { OPEN_PAYMENT_STATUSES } from '../../config/constants';
import { formatMoneyPlain, toMajorUnits } from '../../utils/money';
import { buildWhatsAppLink, paymentShareMessage } from '../../utils/whatsapp';

/** Stripe Checkout sessions expire; 24h gives the customer a realistic window
 *  while keeping the "expired -> new attempt" path exercisable in a demo. */
const CHECKOUT_TTL_HOURS = 24;

export interface PaymentLinkResult {
  payment: Record<string, unknown>;
  paymentUrl: string;
  whatsAppUrl: string;
  /** `true` when an existing open payment was returned rather than a new one
   *  created — the observable proof that the endpoint is idempotent. */
  reused: boolean;
}

/** Deterministic across retries: the same quotation and attempt always produce
 *  the same key, for both our unique index and Stripe's own deduplication. */
const buildIdempotencyKey = (quotationReference: string, attempt: number) =>
  `pay_${quotationReference}_${attempt}`;

/**
 * Creates — or returns — the payment link for a quotation.
 *
 * Duplicate protection, in order:
 *   1. A SUCCEEDED payment for the quotation ends the flow with a 409. Backed
 *      by a partial unique index, so this cannot be raced past.
 *   2. An existing CREATED/PENDING payment with a live checkout URL is returned
 *      as-is. Double-clicking "Generate payment link" yields one link.
 *   3. The insert is keyed on a deterministic idempotency key under a unique
 *      index; a concurrent loser reads back the winner instead of inserting.
 *   4. The same key is passed to Stripe, so even if step 3 were bypassed Stripe
 *      would return the original session rather than charging twice.
 *
 * The amount comes from the stored quotation. Nothing about money is read from
 * the request body.
 */
export async function createPaymentLink(
  agentId: string,
  quotationId: string,
): Promise<PaymentLinkResult> {
  const quotation = await getOwnedQuotationDocument(agentId, quotationId);

  if (quotation.expiresAt.getTime() < Date.now()) {
    throw AppError.businessRule(
      'This quotation has expired. Generate a new quotation before collecting payment.',
    );
  }

  // (1) Already paid?
  const succeeded = await PaymentModel.findOne({
    quotationId: quotation._id,
    status: 'SUCCEEDED',
  });
  if (succeeded) {
    throw AppError.conflict('This quotation has already been paid for.');
  }

  // (2) An open attempt with a usable checkout URL is reused verbatim.
  const open = await PaymentModel.findOne({ quotationId: quotation._id, isOpen: true });

  if (open && isCheckoutUsable(open)) {
    return buildLinkResult(open, quotation.customerSnapshot, quotation.productSnapshot.name, true);
  }

  /**
   * (3) Claim the single open-payment slot for this quotation.
   *
   * The attempt number is derived from a count, which is inherently racy — two
   * concurrent requests can both read the same count. That does not matter:
   * the partial unique index on (quotationId) where `isOpen` lets exactly one
   * insert through, and the loser reads back the winner and continues with it.
   * Correctness comes from the index, not from the count.
   */
  let payment: PaymentDocument;

  if (open) {
    // An open row exists but its checkout session is missing or expired — reuse
    // the row (and therefore its idempotency key) rather than opening a second.
    payment = open;
  } else {
    const attempt = (await PaymentModel.countDocuments({ quotationId: quotation._id })) + 1;

    try {
      payment = await PaymentModel.create({
        idempotencyKey: buildIdempotencyKey(quotation.reference, attempt),
        quotationId: quotation._id,
        quotationReference: quotation.reference,
        customerId: quotation.customerId,
        productId: quotation.productId,
        agentId: new mongoose.Types.ObjectId(agentId),
        attempt,
        amount: quotation.premiumAmount,
        currency: quotation.currency,
        status: 'CREATED',
        isOpen: true,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      const winner = await PaymentModel.findOne({ quotationId: quotation._id, isOpen: true });
      if (!winner) throw error;

      if (isCheckoutUsable(winner)) {
        return buildLinkResult(winner, quotation.customerSnapshot, quotation.productSnapshot.name, true);
      }
      payment = winner;
    }
  }

  // (4) Create the Stripe Checkout Session under the same idempotency key.
  const session = await createCheckoutSession(payment, quotation.productSnapshot.name, quotation.customerSnapshot.email);

  const updated = await PaymentModel.findOneAndUpdate(
    { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
    {
      $set: {
        stripeSessionId: session.id,
        checkoutUrl: session.url ?? undefined,
        checkoutExpiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
        status: 'PENDING',
      },
    },
    { new: true },
  );

  // A webhook can legitimately land between the session creation and this
  // update. If it did, the payment is already terminal and must not be
  // dragged back to PENDING — return the current state instead.
  const finalPayment = updated ?? (await PaymentModel.findById(payment._id));
  if (!finalPayment) throw AppError.notFound('Payment');

  await advanceQuotationStatus(quotation._id, 'PAYMENT_PENDING');

  logger.info('payment link created', {
    paymentId: finalPayment.id,
    idempotencyKey: finalPayment.idempotencyKey,
    sessionId: session.id,
    amount: finalPayment.amount,
  });

  return buildLinkResult(finalPayment, quotation.customerSnapshot, quotation.productSnapshot.name, false);
}

const isCheckoutUsable = (payment: PaymentDocument): boolean =>
  Boolean(payment.checkoutUrl) && (payment.checkoutExpiresAt?.getTime() ?? 0) > Date.now();

async function createCheckoutSession(
  payment: PaymentDocument,
  productName: string,
  customerEmail: string,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      // The customer arrives from a WhatsApp link, so they land back on a
      // public status page keyed by the quotation reference.
      success_url: `${env.CLIENT_URL}/payment/success?ref=${payment.quotationReference}`,
      cancel_url: `${env.CLIENT_URL}/payment/cancelled?ref=${payment.quotationReference}`,
      customer_email: customerEmail,
      expires_at: Math.floor((Date.now() + CHECKOUT_TTL_HOURS * 3600 * 1000) / 1000),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: payment.currency,
            unit_amount: payment.amount,
            product_data: {
              name: productName,
              description: `Annual premium · Quotation ${payment.quotationReference}`,
            },
          },
        },
      ],
      // Metadata is the bridge back from a Stripe event to our own records, and
      // survives even if the session lookup by id ever fails. It is copied onto
      // the PaymentIntent too, so `payment_intent.*` events resolve as well.
      metadata: buildSessionMetadata(payment),
      payment_intent_data: { metadata: buildSessionMetadata(payment) },
    },
    { idempotencyKey: payment.idempotencyKey },
  );
}

function buildSessionMetadata(payment: PaymentDocument): Record<string, string> {
  return {
    paymentId: String(payment._id),
    quotationId: String(payment.quotationId),
    quotationReference: payment.quotationReference,
    idempotencyKey: payment.idempotencyKey,
  };
}

function buildLinkResult(
  payment: PaymentDocument,
  customer: { fullName: string; phone: string },
  productName: string,
  reused: boolean,
): PaymentLinkResult {
  const paymentUrl = payment.checkoutUrl ?? '';
  const customerFirstName = customer.fullName.split(' ')[0] || 'there';

  return {
    payment: payment.toJSON(),
    paymentUrl,
    whatsAppUrl: buildWhatsAppLink(
      customer.phone,
      paymentShareMessage({
        customerFirstName,
        productName,
        companyName: env.COMPANY_NAME,
        amountLabel: formatMoneyPlain(payment.amount, payment.currency),
        paymentUrl,
      }),
    ),
    reused,
  };
}

export async function getPaymentById(agentId: string, paymentId: string) {
  const payment = await PaymentModel.findOne({
    _id: new mongoose.Types.ObjectId(paymentId),
    agentId: new mongoose.Types.ObjectId(agentId),
  });
  if (!payment) throw AppError.notFound('Payment');

  const policy = await PolicyModel.findOne({ paymentId: payment._id });
  return { payment: payment.toJSON(), policy: policy ? policy.toJSON() : null };
}

export async function listPaymentsForQuotation(agentId: string, quotationId: string) {
  await getOwnedQuotationDocument(agentId, quotationId);
  const payments = await PaymentModel.find({
    quotationId: new mongoose.Types.ObjectId(quotationId),
  }).sort({ attempt: -1 });
  return payments.map((payment) => payment.toJSON());
}

/**
 * Public status lookup used by the customer's return page after Stripe
 * redirects them back. It exposes only what the customer already knows — their
 * own reference, the product, the amount and whether cover has started — and
 * never the agent's or any other customer's data.
 */
export async function getPublicPaymentStatus(quotationReference: string) {
  const quotation = await QuotationModel.findOne({ reference: quotationReference });
  if (!quotation) throw AppError.notFound('Quotation');

  const payment = await PaymentModel.findOne({ quotationId: quotation._id }).sort({ attempt: -1 });
  const policy = await PolicyModel.findOne({ quotationId: quotation._id });

  return {
    quotationReference: quotation.reference,
    productName: quotation.productSnapshot.name,
    customerFirstName: quotation.customerSnapshot.fullName.split(' ')[0] ?? '',
    amount: quotation.premiumAmount,
    amountMajor: toMajorUnits(quotation.premiumAmount),
    currency: quotation.currency,
    paymentStatus: payment?.status ?? 'CREATED',
    policy: policy
      ? {
          policyNumber: policy.policyNumber,
          status: policy.status,
          startDate: policy.startDate,
          endDate: policy.endDate,
        }
      : null,
  };
}
