import { PaymentModel } from './payment.model';
import { setStripeClient } from './stripe.client';
import { createPaymentLink } from './payment.service';
import { QuotationModel } from '../quotations/quotation.model';
import {
  authed,
  createTestProduct,
  customerPayload,
  registerAgent,
} from '../../tests/helpers';
import { createStripeDouble, type StripeDouble } from '../../tests/stripe.double';

/** Walks an agent from signup to a quotation ready for payment. */
async function setupQuotation() {
  const agent = await registerAgent();
  const product = await createTestProduct({ eligibilityRules: {} } as never);

  const customerResponse = await authed(agent.token)
    .post('/api/customers')
    .send(customerPayload())
    .expect(201);

  const quotationResponse = await authed(agent.token)
    .post('/api/quotations')
    .send({ customerId: customerResponse.body.data.customer.id, productId: product.id })
    .expect(201);

  return {
    agent,
    product,
    customerId: customerResponse.body.data.customer.id,
    quotation: quotationResponse.body.data.quotation,
  };
}

describe('Payments', () => {
  let stripe: StripeDouble;

  beforeEach(() => {
    stripe = createStripeDouble();
    setStripeClient(stripe.client);
  });

  describe('Server-determined amounts', () => {
    it('charges the quoted premium and ignores any amount sent by the client', async () => {
      const { agent, quotation } = await setupQuotation();

      await authed(agent.token)
        .post('/api/payments/create-link')
        // A malicious client trying to pay 1 paise for the policy.
        .send({ quotationId: quotation.id, amount: 1, currency: 'usd' })
        .expect(201);

      const payment = await PaymentModel.findOne({ quotationId: quotation.id });
      expect(payment?.amount).toBe(quotation.premiumAmount);
      expect(payment?.currency).toBe(quotation.currency);

      const sessionParams = stripe.createSession.mock.calls[0][0];
      expect(sessionParams.line_items[0].price_data.unit_amount).toBe(quotation.premiumAmount);
    });

    it('never trusts a premium supplied when the quotation is created', async () => {
      const agent = await registerAgent();
      const product = await createTestProduct({ eligibilityRules: {} } as never);
      const customer = await authed(agent.token)
        .post('/api/customers')
        .send(customerPayload())
        .expect(201);

      const response = await authed(agent.token)
        .post('/api/quotations')
        .send({
          customerId: customer.body.data.customer.id,
          productId: product.id,
          premiumAmount: 1,
          coverageAmount: 999_999_999,
        })
        .expect(201);

      expect(response.body.data.quotation.premiumAmount).toBeGreaterThan(1);
      expect(response.body.data.quotation.coverageAmount).not.toBe(999_999_999);
    });
  });

  describe('Idempotent payment link creation', () => {
    it('returns the same link on a repeated request and creates one payment row', async () => {
      const { agent, quotation } = await setupQuotation();

      const first = await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(201);

      const second = await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        // 200, not 201: the existing link was reused.
        .expect(200);

      expect(second.body.data.reused).toBe(true);
      expect(second.body.data.paymentUrl).toBe(first.body.data.paymentUrl);
      expect(second.body.data.payment.id).toBe(first.body.data.payment.id);

      expect(await PaymentModel.countDocuments({ quotationId: quotation.id })).toBe(1);
      // Stripe was only asked for a session once.
      expect(stripe.createSession).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent requests onto a single payment', async () => {
      const { agent, quotation } = await setupQuotation();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          createPaymentLink(agent.agentId, quotation.id).catch((error) => error),
        ),
      );

      const succeeded = results.filter((result) => !(result instanceof Error));
      expect(succeeded.length).toBe(5);

      // One row, one logical payment — whatever the interleaving.
      expect(await PaymentModel.countDocuments({ quotationId: quotation.id })).toBe(1);

      const urls = new Set(succeeded.map((result) => result.paymentUrl));
      expect(urls.size).toBe(1);
    });

    it('sends a deterministic idempotency key to Stripe', async () => {
      const { agent, quotation } = await setupQuotation();

      await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(201);

      const options = stripe.createSession.mock.calls[0][1];
      expect(options.idempotencyKey).toBe(`pay_${quotation.reference}_1`);
    });

    it('refuses to create a second link once the quotation is paid', async () => {
      const { agent, quotation } = await setupQuotation();

      await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(201);

      await PaymentModel.updateOne({ quotationId: quotation.id }, { $set: { status: 'SUCCEEDED' } });

      const response = await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('cannot record two successful payments for one quotation', async () => {
      const { agent, quotation } = await setupQuotation();

      await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(201);

      const first = await PaymentModel.findOne({ quotationId: quotation.id });
      await PaymentModel.updateOne({ _id: first!._id }, { $set: { status: 'SUCCEEDED' } });

      // Bypass the service entirely: the database itself must reject this.
      await expect(
        PaymentModel.create({
          idempotencyKey: `pay_${quotation.reference}_99`,
          quotationId: first!.quotationId,
          quotationReference: first!.quotationReference,
          customerId: first!.customerId,
          productId: first!.productId,
          agentId: first!.agentId,
          attempt: 99,
          amount: first!.amount,
          currency: first!.currency,
          status: 'SUCCEEDED',
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects a payment link for an expired quotation', async () => {
      const { agent, quotation } = await setupQuotation();
      await QuotationModel.updateOne(
        { _id: quotation.id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      const response = await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(422);

      expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('does not let an agent pay for another agent’s quotation', async () => {
      const { quotation } = await setupQuotation();
      const stranger = await registerAgent();

      await authed(stranger.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(404);
    });

    it('rejects a malformed quotation id before touching Stripe', async () => {
      const agent = await registerAgent();

      await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: 'nope' })
        .expect(400);

      expect(stripe.createSession).not.toHaveBeenCalled();
    });
  });

  describe('WhatsApp share link', () => {
    it('builds a wa.me link addressed to the customer and containing the payment URL', async () => {
      const { agent, quotation } = await setupQuotation();

      const response = await authed(agent.token)
        .post('/api/payments/create-link')
        .send({ quotationId: quotation.id })
        .expect(201);

      const whatsAppUrl: string = response.body.data.whatsAppUrl;
      expect(whatsAppUrl.startsWith('https://wa.me/')).toBe(true);
      expect(decodeURIComponent(whatsAppUrl)).toContain(response.body.data.paymentUrl);
      // Digits only after wa.me/ — WhatsApp will not resolve a formatted number.
      expect(whatsAppUrl).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    });
  });
});
