import { QuotationModel } from './quotation.model';
import { authed, createTestProduct, customerPayload, lakh, registerAgent } from '../../tests/helpers';

async function agentWithCustomer() {
  const agent = await registerAgent();
  const customer = await authed(agent.token).post('/api/customers').send(customerPayload()).expect(201);
  return { agent, customerId: customer.body.data.customer.id as string };
}

describe('Quotations', () => {
  it('prices a quotation from the product and customer, and snapshots both', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({ eligibilityRules: {} } as never);

    const response = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);

    const quotation = response.body.data.quotation;
    expect(quotation.reference).toMatch(/^QTN-\d{4}-[0-9A-Z]{8}$/);
    expect(quotation.premiumAmount).toBeGreaterThan(0);
    expect(quotation.customerSnapshot.fullName).toBe('Ananya Sharma');
    expect(quotation.productSnapshot.name).toBe(product.name);
    expect(quotation.premiumBreakdown.length).toBeGreaterThan(0);
    expect(quotation.status).toBe('DRAFT');
  });

  it('refuses to quote a product the customer is not eligible for', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({ eligibilityRules: { minAge: 70 } } as never);

    const response = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(422);

    expect(response.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(response.body.error.message).toContain('Minimum entry age is 70');
    expect(await QuotationModel.countDocuments()).toBe(0);
  });

  it('refuses to quote a withdrawn product', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({ eligibilityRules: {}, active: false } as never);

    await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(422);
  });

  it('is idempotent: re-selecting the same product reuses the open quotation', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({ eligibilityRules: {} } as never);

    const first = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);
    const second = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);

    expect(second.body.data.quotation.id).toBe(first.body.data.quotation.id);
    expect(second.body.data.quotation.reference).toBe(first.body.data.quotation.reference);
    expect(await QuotationModel.countDocuments()).toBe(1);
  });

  it('re-prices an open quotation when the customer’s details change', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({
      eligibilityRules: {},
      pricingFactors: { ageBands: [], smokerLoadingPct: 50 },
    } as never);

    const first = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);

    await authed(agent.token)
      .put(`/api/customers/${customerId}`)
      .send({ health: { smoker: true, preExistingConditions: false } })
      .expect(200);

    const second = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);

    expect(second.body.data.quotation.id).toBe(first.body.data.quotation.id);
    expect(second.body.data.quotation.premiumAmount).toBeGreaterThan(
      first.body.data.quotation.premiumAmount,
    );
  });

  it('caps term cover at the configured multiple of the customer’s income', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({
      coverageAmount: lakh(500),
      eligibilityRules: {},
      pricingFactors: { ageBands: [], coverageIncomeMultiple: 10 },
    } as never);

    const response = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);

    // Seeded customer earns 12 lakh, so cover is capped at 120 lakh.
    expect(response.body.data.quotation.coverageAmount).toBe(lakh(120));
  });

  it('does not expose another agent’s quotation', async () => {
    const { agent, customerId } = await agentWithCustomer();
    const product = await createTestProduct({ eligibilityRules: {} } as never);
    const created = await authed(agent.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(201);

    const stranger = await registerAgent();
    await authed(stranger.token).get(`/api/quotations/${created.body.data.quotation.id}`).expect(404);
  });

  it('rejects a customer belonging to another agent', async () => {
    const { customerId } = await agentWithCustomer();
    const product = await createTestProduct({ eligibilityRules: {} } as never);
    const stranger = await registerAgent();

    await authed(stranger.token)
      .post('/api/quotations')
      .send({ customerId, productId: product.id })
      .expect(404);
  });
});
