import type Stripe from 'stripe';
import { PaymentModel, type PaymentDocument } from './payment.model';
import { WebhookEventModel } from './webhookEvent.model';
import { getStripe } from './stripe.client';
import { QuotationModel } from '../quotations/quotation.model';
import { advanceQuotationStatus } from '../quotations/quotation.service';
import { activatePolicyForPayment } from '../policies/policy.service';
import { sendPolicyActivationEmail } from '../notifications/notification.service';
import { AppError } from '../../utils/AppError';
import { isDuplicateKeyError } from '../../middleware/errorHandler';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { OPEN_PAYMENT_STATUSES } from '../../config/constants';

/**
 * A PROCESSING claim older than this is assumed abandoned (the instance handling
 * it crashed or was frozen), so a Stripe retry is allowed to pick the event up.
 * Reprocessing is safe: every step below is independently idempotent.
 */
const STALE_CLAIM_MS = 2 * 60 * 1000;

export interface WebhookResult {
  received: true;
  processed: boolean;
  reason?: string;
}

/**
 * Verifies the Stripe signature over the RAW request bytes.
 *
 * This is the only thing that makes the endpoint safe to expose publicly:
 * without it, anyone could POST a fabricated `checkout.session.completed` and
 * activate a policy for free.
 */
export function verifyStripeEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw AppError.serviceUnavailable('Stripe webhook secret is not configured.');
  }
  if (!signature) {
    throw AppError.badRequest('Missing Stripe signature header.');
  }

  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    logger.warn('stripe webhook signature verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw AppError.badRequest('Invalid Stripe signature.');
  }
}

/**
 * Claims an event for processing.
 *
 * The unique index on `eventId` is the concurrency control: of N simultaneous
 * deliveries of the same event, exactly one insert succeeds and the rest are
 * told to skip.
 */
async function claimEvent(event: Stripe.Event): Promise<{ claimed: boolean; reason?: string }> {
  try {
    await WebhookEventModel.create({
      eventId: event.id,
      type: event.type,
      status: 'PROCESSING',
      receivedAt: new Date(),
    });
    return { claimed: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const existing = await WebhookEventModel.findOne({ eventId: event.id });
  if (!existing) return { claimed: true };

  if (existing.status === 'PROCESSED') {
    return { claimed: false, reason: 'duplicate_event_already_processed' };
  }

  // Take over only if the previous claim looks abandoned, and do it with a
  // conditional update so two retries cannot both take over.
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const takenOver = await WebhookEventModel.findOneAndUpdate(
    { eventId: event.id, $or: [{ status: 'FAILED' }, { status: 'PROCESSING', receivedAt: { $lt: cutoff } }] },
    { $set: { status: 'PROCESSING', receivedAt: new Date() } },
    { new: true },
  );

  return takenOver
    ? { claimed: true }
    : { claimed: false, reason: 'duplicate_event_in_progress' };
}

/**
 * Entry point for `POST /api/webhooks/stripe`.
 *
 * Contract with Stripe: return 2xx once the event is durably handled, and a
 * non-2xx to request a retry. Unknown event types are acknowledged rather than
 * retried forever.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookResult> {
  const claim = await claimEvent(event);
  if (!claim.claimed) {
    logger.info('stripe webhook skipped', { eventId: event.id, type: event.type, reason: claim.reason });
    return { received: true, processed: false, reason: claim.reason };
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handleCheckoutSucceeded(event.data.object as Stripe.Checkout.Session, event.id);
        break;
      case 'checkout.session.expired':
        await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session, event.id);
        break;
      case 'checkout.session.async_payment_failed':
        await handleCheckoutFailed(event.data.object as Stripe.Checkout.Session, event.id);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent, event.id);
        break;
      default:
        logger.debug('stripe webhook ignored', { eventId: event.id, type: event.type });
    }

    await WebhookEventModel.updateOne(
      { eventId: event.id },
      { $set: { status: 'PROCESSED', processedAt: new Date() } },
    );
    return { received: true, processed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await WebhookEventModel.updateOne(
      { eventId: event.id },
      { $set: { status: 'FAILED', error: message.slice(0, 500) } },
    );
    logger.error('stripe webhook processing failed', { eventId: event.id, type: event.type, error: message });
    // Rethrown so the endpoint answers 5xx and Stripe retries with backoff.
    throw error;
  }
}

/** Resolves our payment row from a Stripe object, by session id first and by
 *  the metadata we attached as a fallback. */
async function resolvePayment(
  sessionId: string | undefined,
  metadata: Stripe.Metadata | null | undefined,
): Promise<PaymentDocument | null> {
  if (sessionId) {
    const bySession = await PaymentModel.findOne({ stripeSessionId: sessionId });
    if (bySession) return bySession;
  }
  const paymentId = metadata?.paymentId;
  if (paymentId) {
    const byMetadata = await PaymentModel.findById(paymentId).catch(() => null);
    if (byMetadata) return byMetadata;
  }
  return null;
}

async function handleCheckoutSucceeded(session: Stripe.Checkout.Session, eventId: string) {
  if (session.payment_status !== 'paid') {
    logger.info('checkout session not paid yet — ignoring', {
      eventId,
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return;
  }

  const payment = await resolvePayment(session.id, session.metadata);
  if (!payment) {
    // Acknowledged, not retried: an event for a session this environment does
    // not know about (e.g. a shared Stripe account) would otherwise retry forever.
    logger.warn('no payment matches stripe session — acknowledging', {
      eventId,
      sessionId: session.id,
    });
    return;
  }

  // Defence in depth: the charged amount must equal the amount we quoted.
  // A mismatch means the session was tampered with or created out of band.
  if (typeof session.amount_total === 'number' && session.amount_total !== payment.amount) {
    logger.error('stripe amount does not match quoted premium — refusing to activate', {
      eventId,
      paymentId: payment.id,
      expected: payment.amount,
      received: session.amount_total,
    });
    await PaymentModel.updateOne(
      { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
      { $set: { status: 'FAILED', isOpen: false, failureReason: 'amount_mismatch', lastStripeEventId: eventId } },
    );
    return;
  }

  /**
   * Conditional state transition — the core of the idempotency guarantee.
   * The update only matches a payment still in an OPEN state, so the second and
   * later deliveries of the same event match nothing and `updated` is null.
   */
  const updated = await PaymentModel.findOneAndUpdate(
    { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
    {
      $set: {
        status: 'SUCCEEDED',
        // Releases the partial unique index on open payments, so the quotation
        // can never have another open attempt after it has been paid.
        isOpen: false,
        paidAt: new Date(),
        stripePaymentIntentId:
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? undefined),
        lastStripeEventId: eventId,
      },
    },
    { new: true },
  );

  const settled = updated ?? (await PaymentModel.findById(payment._id));
  if (!settled || settled.status !== 'SUCCEEDED') {
    logger.info('payment already in a terminal non-success state — no activation', {
      eventId,
      paymentId: payment.id,
      status: settled?.status,
    });
    return;
  }

  // Reached on a replay too. Activation is an upsert under a unique index, so
  // running it again is a no-op that simply returns the existing policy — which
  // also recovers the case where a previous delivery crashed between the
  // payment update and the policy insert.
  const quotation = await QuotationModel.findById(settled.quotationId);
  if (!quotation) throw AppError.notFound('Quotation');

  const { policy, created } = await activatePolicyForPayment(settled, quotation);
  await advanceQuotationStatus(quotation._id, 'CONVERTED');

  if (!created) {
    logger.info('policy already existed — confirmation email not resent', {
      eventId,
      policyId: policy.id,
    });
    return;
  }

  /**
   * Awaited, not fire-and-forget: a serverless instance is frozen as soon as
   * the response is returned, so an un-awaited promise would frequently never
   * run. `sendPolicyActivationEmail` swallows its own errors, so awaiting it
   * cannot fail the webhook or undo the activation.
   */
  await sendPolicyActivationEmail(policy);
}

async function handleCheckoutExpired(session: Stripe.Checkout.Session, eventId: string) {
  const payment = await resolvePayment(session.id, session.metadata);
  if (!payment) return;

  await PaymentModel.updateOne(
    { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
    { $set: { status: 'EXPIRED', isOpen: false, lastStripeEventId: eventId } },
  );
  logger.info('payment expired', { eventId, paymentId: payment.id });
}

async function handleCheckoutFailed(session: Stripe.Checkout.Session, eventId: string) {
  const payment = await resolvePayment(session.id, session.metadata);
  if (!payment) return;

  await PaymentModel.updateOne(
    { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
    { $set: { status: 'FAILED', isOpen: false, failureReason: 'async_payment_failed', lastStripeEventId: eventId } },
  );
  logger.info('payment failed', { eventId, paymentId: payment.id });
}

async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent, eventId: string) {
  const payment = await resolvePayment(undefined, intent.metadata);
  if (!payment) return;

  await PaymentModel.updateOne(
    { _id: payment._id, status: { $in: OPEN_PAYMENT_STATUSES } },
    {
      $set: {
        status: 'FAILED',
        isOpen: false,
        failureReason: intent.last_payment_error?.message?.slice(0, 300) ?? 'payment_failed',
        lastStripeEventId: eventId,
      },
    },
  );
  logger.info('payment intent failed', { eventId, paymentId: payment.id });
}
