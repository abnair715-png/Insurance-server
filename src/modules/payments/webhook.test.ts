import request from 'supertest';
import type Stripe from 'stripe';
import { PaymentModel } from './payment.model';
import { WebhookEventModel } from './webhookEvent.model';
import { setStripeClient } from './stripe.client';
import { handleStripeEvent } from './webhook.service';
import { PolicyModel } from '../policies/policy.model';
import { NotificationModel } from '../notifications/notification.model';
import { QuotationModel } from '../quotations/quotation.model';
import { setEmailProvider } from '../notifications/email.service';
import { env } from '../../config/env';
import { authed, createTestProduct, customerPayload, getApp, registerAgent } from '../../tests/helpers';
import {
  checkoutCompletedEvent,
  checkoutExpiredEvent,
  createStripeDouble,
  RecordingEmailProvider,
  type StripeDouble,
} from '../../tests/stripe.double';

/** Drives an agent all the way to a pending payment with a Stripe session. */
async function setupPendingPayment(token: string) {
  const product = await createTestProduct({ eligibilityRules: {} } as never);

  const customer = await authed(token).post('/api/customers').send(customerPayload()).expect(201);
  const quotation = await authed(token)
    .post('/api/quotations')
    .send({ customerId: customer.body.data.customer.id, productId: product.id })
    .expect(201);

  const link = await authed(token)
    .post('/api/payments/create-link')
    .send({ quotationId: quotation.body.data.quotation.id })
    .expect(201);

  const payment = await PaymentModel.findById(link.body.data.payment.id);
  return { quotation: quotation.body.data.quotation, payment: payment! };
}

describe('Stripe webhook', () => {
  let stripe: StripeDouble;
  let email: RecordingEmailProvider;
  const originalWebhookSecret = env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    stripe = createStripeDouble();
    setStripeClient(stripe.client);
    email = new RecordingEmailProvider();
    setEmailProvider(email);
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  afterEach(() => {
    env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  const sessionFor = (payment: { stripeSessionId?: string }): Stripe.Checkout.Session =>
    [...stripe.sessionsByKey.values()].find((session) => session.id === payment.stripeSessionId)!;

  describe('Signature verification', () => {
    it('rejects an unsigned request', async () => {
      const response = await request(getApp())
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .send({ id: 'evt_forged', type: 'checkout.session.completed' })
        .expect(400);

      expect(response.body.error.message).toMatch(/signature/i);
    });

    it('rejects a forged signature and records nothing', async () => {
      await request(getApp())
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'definitely-not-valid')
        .send({ id: 'evt_forged', type: 'checkout.session.completed' })
        .expect(400);

      expect(await WebhookEventModel.countDocuments()).toBe(0);
      expect(await PolicyModel.countDocuments()).toBe(0);
    });

    it('accepts a correctly signed event over HTTP', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const event = checkoutCompletedEvent(sessionFor(payment));

      const response = await request(getApp())
        .post('/api/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid-signature')
        .send(event as unknown as object)
        .expect(200);

      expect(response.body.data.processed).toBe(true);
      expect(await PolicyModel.countDocuments()).toBe(1);
    });
  });

  describe('Successful payment', () => {
    it('marks the payment succeeded, activates the policy and emails the customer', async () => {
      const agent = await registerAgent();
      const { quotation, payment } = await setupPendingPayment(agent.token);

      await handleStripeEvent(checkoutCompletedEvent(sessionFor(payment)));

      const settled = await PaymentModel.findById(payment._id);
      expect(settled?.status).toBe('SUCCEEDED');
      expect(settled?.isOpen).toBe(false);
      expect(settled?.paidAt).toBeInstanceOf(Date);

      const policy = await PolicyModel.findOne({ paymentId: payment._id });
      expect(policy?.status).toBe('ACTIVE');
      expect(policy?.premiumAmount).toBe(payment.amount);
      expect(policy?.policyNumber).toMatch(/^POL-\d{4}-[0-9A-Z]{8}$/);

      const updatedQuotation = await QuotationModel.findById(quotation.id);
      expect(updatedQuotation?.status).toBe('CONVERTED');

      expect(email.sent).toHaveLength(1);
      expect(email.sent[0].to).toBe(quotation.customerSnapshot.email);
      expect(email.sent[0].subject).toContain(policy!.policyNumber);
    });

    it('sets the policy term to twelve months from the payment date', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);

      await handleStripeEvent(checkoutCompletedEvent(sessionFor(payment)));

      const policy = await PolicyModel.findOne({ paymentId: payment._id });
      const months =
        (policy!.endDate.getFullYear() - policy!.startDate.getFullYear()) * 12 +
        (policy!.endDate.getMonth() - policy!.startDate.getMonth());
      expect(months).toBe(12);
    });
  });

  describe('Duplicate delivery', () => {
    it('is a no-op when the SAME event is delivered repeatedly', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const event = checkoutCompletedEvent(sessionFor(payment));

      const first = await handleStripeEvent(event);
      const second = await handleStripeEvent(event);
      const third = await handleStripeEvent(event);

      expect(first.processed).toBe(true);
      expect(second).toMatchObject({ processed: false, reason: 'duplicate_event_already_processed' });
      expect(third.processed).toBe(false);

      expect(await PolicyModel.countDocuments()).toBe(1);
      expect(await PaymentModel.countDocuments({ status: 'SUCCEEDED' })).toBe(1);
      expect(email.sent).toHaveLength(1);
    });

    it('does not double-activate when Stripe sends DIFFERENT events for the same session', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const session = sessionFor(payment);

      // Distinct event ids, so the event ledger cannot be what saves us here —
      // the conditional payment transition and the policy unique index must.
      await handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_first' }));
      await handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_second' }));

      expect(await PolicyModel.countDocuments()).toBe(1);
      expect(await NotificationModel.countDocuments()).toBe(1);
      expect(email.sent).toHaveLength(1);
    });

    it('activates exactly once under concurrent delivery of the same event', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const event = checkoutCompletedEvent(sessionFor(payment));

      await Promise.all([
        handleStripeEvent(event).catch(() => undefined),
        handleStripeEvent(event).catch(() => undefined),
        handleStripeEvent(event).catch(() => undefined),
      ]);

      expect(await PolicyModel.countDocuments()).toBe(1);
      expect(await PaymentModel.countDocuments({ status: 'SUCCEEDED' })).toBe(1);
      expect(email.sent).toHaveLength(1);
    });

    it('activates exactly once under concurrent delivery of DIFFERENT events', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const session = sessionFor(payment);

      await Promise.all([
        handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_a' })).catch(() => undefined),
        handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_b' })).catch(() => undefined),
        handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_c' })).catch(() => undefined),
      ]);

      expect(await PolicyModel.countDocuments()).toBe(1);
      expect(await NotificationModel.countDocuments()).toBe(1);
    });

    it('recovers when a previous delivery crashed after the payment update', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);

      // Simulate the crash window: payment settled, policy never written.
      await PaymentModel.updateOne(
        { _id: payment._id },
        { $set: { status: 'SUCCEEDED', isOpen: false, paidAt: new Date() } },
      );

      await handleStripeEvent(checkoutCompletedEvent(sessionFor(payment), { id: 'evt_retry' }));

      expect(await PolicyModel.countDocuments({ paymentId: payment._id })).toBe(1);
      expect(email.sent).toHaveLength(1);
    });
  });

  describe('Tampering and failure paths', () => {
    it('refuses to activate when the charged amount does not match the quote', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);

      await handleStripeEvent(
        checkoutCompletedEvent(sessionFor(payment), { amountTotal: 100 }),
      );

      const settled = await PaymentModel.findById(payment._id);
      expect(settled?.status).toBe('FAILED');
      expect(settled?.failureReason).toBe('amount_mismatch');
      expect(await PolicyModel.countDocuments()).toBe(0);
      expect(email.sent).toHaveLength(0);
    });

    it('ignores a session that is not yet paid', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const session = sessionFor(payment);

      await handleStripeEvent({
        id: 'evt_unpaid',
        type: 'checkout.session.completed',
        data: { object: { ...session, payment_status: 'unpaid' } },
      } as unknown as Stripe.Event);

      expect((await PaymentModel.findById(payment._id))?.status).toBe('PENDING');
      expect(await PolicyModel.countDocuments()).toBe(0);
    });

    it('marks an expired checkout session EXPIRED and frees a retry', async () => {
      const agent = await registerAgent();
      const { quotation, payment } = await setupPendingPayment(agent.token);

      await handleStripeEvent(checkoutExpiredEvent(sessionFor(payment)));

      const expired = await PaymentModel.findById(payment._id);
      expect(expired?.status).toBe('EXPIRED');
      expect(expired?.isOpen).toBe(false);

      // A fresh attempt is now possible, as attempt 2.
      const retry = await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(201);

      expect(retry.body.data.payment.attempt).toBe(2);
      expect(retry.body.data.payment.idempotencyKey).toBe(`pay_${quotation.reference}_2`);
    });

    it('cannot be dragged back to PENDING by a late expiry event', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      const session = sessionFor(payment);

      await handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_paid' }));
      await handleStripeEvent(checkoutExpiredEvent(session));

      expect((await PaymentModel.findById(payment._id))?.status).toBe('SUCCEEDED');
      expect(await PolicyModel.countDocuments()).toBe(1);
    });

    it('acknowledges an event for a session it does not know about', async () => {
      const result = await handleStripeEvent({
        id: 'evt_unknown',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_unknown', payment_status: 'paid', metadata: {} } },
      } as unknown as Stripe.Event);

      expect(result.processed).toBe(true);
      expect(await PolicyModel.countDocuments()).toBe(0);
    });

    it('acknowledges an event type it does not handle', async () => {
      const result = await handleStripeEvent({
        id: 'evt_other',
        type: 'customer.created',
        data: { object: {} },
      } as unknown as Stripe.Event);

      expect(result.processed).toBe(true);
    });
  });

  describe('Email failures', () => {
    it('leaves the payment and policy intact when the email provider fails', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      email.failOnce();

      const result = await handleStripeEvent(checkoutCompletedEvent(sessionFor(payment)));

      expect(result.processed).toBe(true);
      expect((await PaymentModel.findById(payment._id))?.status).toBe('SUCCEEDED');
      expect(await PolicyModel.countDocuments()).toBe(1);

      // The failure is recorded, not swallowed silently.
      const notification = await NotificationModel.findOne();
      expect(notification?.status).toBe('FAILED');
      expect(notification?.lastError).toContain('simulated provider outage');
      expect(notification?.attempts).toBe(1);
    });

    it('can retry a failed notification without re-activating anything', async () => {
      const agent = await registerAgent();
      const { payment } = await setupPendingPayment(agent.token);
      email.failOnce();
      await handleStripeEvent(checkoutCompletedEvent(sessionFor(payment)));

      const response = await authed(agent.token).post('/api/notifications/retry-failed').expect(200);

      expect(response.body.data).toMatchObject({ retried: 1, sent: 1 });
      expect((await NotificationModel.findOne())?.status).toBe('SENT');
      expect(await PolicyModel.countDocuments()).toBe(1);
    });
  });
});
