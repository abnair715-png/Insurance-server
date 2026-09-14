import request from 'supertest';
import mongoose from 'mongoose';
import { CustomerModel } from './customer.model';
import { QuotationModel } from '../quotations/quotation.model';
import { DocumentModel } from '../documents/document.model';
import { PaymentModel } from '../payments/payment.model';
import { PolicyModel } from '../policies/policy.model';
import {
  authed,
  createTestProduct,
  customerPayload,
  getApp,
  lakh,
  registerAgent,
} from '../../tests/helpers';

describe('Customers', () => {
  describe('POST /api/customers', () => {
    it('creates a customer owned by the calling agent', async () => {
      const { token, agentId } = await registerAgent();

      const response = await authed(token).post('/api/customers').send(customerPayload()).expect(201);

      expect(response.body.data.customer).toMatchObject({
        firstName: 'Ananya',
        city: 'Bengaluru',
      });

      const stored = await CustomerModel.findById(response.body.data.customer.id);
      expect(String(stored?.createdByAgent)).toBe(agentId);
    });

    it('rejects an invalid email and phone with field-level errors', async () => {
      const { token } = await registerAgent();

      const response = await authed(token)
        .post('/api/customers')
        .send(customerPayload({ email: 'not-an-email', phone: '12' }))
        .expect(400);

      const fields = response.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toContain('email');
      expect(fields).toContain('phone');
    });

    it('rejects a customer under 18', async () => {
      const { token } = await registerAgent();
      const dateOfBirth = new Date(Date.UTC(new Date().getUTCFullYear() - 15, 0, 1))
        .toISOString()
        .slice(0, 10);

      const response = await authed(token)
        .post('/api/customers')
        .send(customerPayload({ dateOfBirth }))
        .expect(400);

      expect(response.body.error.details[0].field).toBe('dateOfBirth');
    });

    it('requires vehicle type and value when the customer owns a vehicle', async () => {
      const { token } = await registerAgent();

      const response = await authed(token)
        .post('/api/customers')
        .send(customerPayload({ vehicle: { owns: true } }))
        .expect(400);

      const fields = response.body.error.details.map((d: { field: string }) => d.field);
      expect(fields).toContain('vehicle.type');
      expect(fields).toContain('vehicle.value');
    });

    it('rejects a duplicate email for the same agent with 409', async () => {
      const { token } = await registerAgent();
      const payload = customerPayload();

      await authed(token).post('/api/customers').send(payload).expect(201);
      const response = await authed(token)
        .post('/api/customers')
        .send({ ...payload, phone: '+919777000111' })
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('allows two different agents to record the same person', async () => {
      const first = await registerAgent();
      const second = await registerAgent();
      const payload = customerPayload();

      await authed(first.token).post('/api/customers').send(payload).expect(201);
      await authed(second.token).post('/api/customers').send(payload).expect(201);
    });
  });

  describe('Ownership scoping', () => {
    it('does not expose another agent’s customer', async () => {
      const owner = await registerAgent();
      const stranger = await registerAgent();

      const created = await authed(owner.token)
        .post('/api/customers')
        .send(customerPayload())
        .expect(201);

      await authed(stranger.token)
        .get(`/api/customers/${created.body.data.customer.id}`)
        .expect(404);
    });

    it('lists only the calling agent’s customers', async () => {
      const owner = await registerAgent();
      const stranger = await registerAgent();

      await authed(owner.token).post('/api/customers').send(customerPayload()).expect(201);

      const response = await authed(stranger.token).get('/api/customers').expect(200);
      expect(response.body.data.customers).toHaveLength(0);
      expect(response.body.meta.total).toBe(0);
    });
  });

  describe('GET /api/customers/:id/eligible-products', () => {
    it('splits the catalogue into eligible and ineligible with reasons', async () => {
      const { token } = await registerAgent();

      await createTestProduct({
        name: 'Open To All',
        eligibilityRules: {},
      } as never);
      await createTestProduct({
        name: 'Seniors Only',
        eligibilityRules: { minAge: 60 },
      } as never);

      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);

      const response = await authed(token)
        .get(`/api/customers/${created.body.data.customer.id}/eligible-products`)
        .expect(200);

      const eligibleNames = response.body.data.eligible.map(
        (entry: { product: { name: string } }) => entry.product.name,
      );
      const ineligible = response.body.data.ineligible;

      expect(eligibleNames).toContain('Open To All');
      expect(ineligible[0].product.name).toBe('Seniors Only');
      expect(ineligible[0].failures[0].rule).toBe('MIN_AGE');
      expect(ineligible[0].quote).toBeUndefined();
    });

    it('quotes a premium alongside every eligible product', async () => {
      const { token } = await registerAgent();
      await createTestProduct({ name: 'Priced Product', eligibilityRules: {} } as never);

      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);
      const response = await authed(token)
        .get(`/api/customers/${created.body.data.customer.id}/eligible-products`)
        .expect(200);

      expect(response.body.data.eligible[0].quote.premiumAmount).toBeGreaterThan(0);
      expect(response.body.data.eligible[0].quote.coverageAmount).toBeGreaterThan(0);
    });

    it('rejects a malformed customer id with 400 rather than 500', async () => {
      const { token } = await registerAgent();
      const response = await authed(token).get('/api/customers/not-an-id/eligible-products').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /api/customers/:id', () => {
    it('clears stale vehicle data when ownership is withdrawn', async () => {
      const { token } = await registerAgent();
      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);

      const response = await authed(token)
        .put(`/api/customers/${created.body.data.customer.id}`)
        .send({ vehicle: { owns: false } })
        .expect(200);

      expect(response.body.data.customer.vehicle.owns).toBe(false);
      expect(response.body.data.customer.vehicle.type).toBeUndefined();
    });

    it('updates income and re-evaluates eligibility on the next request', async () => {
      const { token } = await registerAgent();
      await createTestProduct({
        name: 'High Income Only',
        eligibilityRules: { minAnnualIncome: lakh(20) },
      } as never);

      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);
      const customerId = created.body.data.customer.id;

      const before = await authed(token).get(`/api/customers/${customerId}/eligible-products`).expect(200);
      expect(before.body.data.eligible).toHaveLength(0);

      await authed(token).put(`/api/customers/${customerId}`).send({ annualIncome: lakh(25) }).expect(200);

      const after = await authed(token).get(`/api/customers/${customerId}/eligible-products`).expect(200);
      expect(after.body.data.eligible).toHaveLength(1);
    });
  });

  describe('DELETE /api/customers/:id', () => {
    /** Walks an agent to a customer with one quotation and one generated PDF. */
    async function customerWithQuotation() {
      const agent = await registerAgent();
      const product = await createTestProduct({ eligibilityRules: {} } as never);

      const created = await authed(agent.token)
        .post('/api/customers')
        .send(customerPayload())
        .expect(201);
      const customerId = created.body.data.customer.id as string;

      const quotation = await authed(agent.token)
        .post('/api/quotations')
        .send({ customerId, productId: product.id })
        .expect(201);

      await authed(agent.token)
        .post(`/api/documents/${quotation.body.data.quotation.id}/generate`)
        .expect(201);

      return { agent, customerId, quotationId: quotation.body.data.quotation.id as string, product };
    }

    it('deletes a customer who has no quotations', async () => {
      const { token } = await registerAgent();
      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);

      const response = await authed(token)
        .delete(`/api/customers/${created.body.data.customer.id}`)
        .expect(200);

      expect(response.body.data.deleted).toBe(true);
      expect(await CustomerModel.countDocuments()).toBe(0);
    });

    it('cascades to the customer\u2019s quotations and document records', async () => {
      const { agent, customerId } = await customerWithQuotation();

      expect(await QuotationModel.countDocuments({ customerId })).toBe(1);
      expect(await DocumentModel.countDocuments({ customerId })).toBe(1);

      const response = await authed(agent.token).delete(`/api/customers/${customerId}`).expect(200);

      expect(response.body.data).toMatchObject({ deletedQuotations: 1, deletedDocuments: 1 });
      expect(await QuotationModel.countDocuments({ customerId })).toBe(0);
      expect(await DocumentModel.countDocuments({ customerId })).toBe(0);
    });

    it('invalidates a shared PDF link, because the document record is gone', async () => {
      const { agent, customerId, quotationId } = await customerWithQuotation();

      await authed(agent.token).get(`/api/documents/${quotationId}/download`).expect(200);
      await authed(agent.token).delete(`/api/customers/${customerId}`).expect(200);
      await authed(agent.token).get(`/api/documents/${quotationId}/download`).expect(404);
    });

    it('refuses to delete a customer who holds a policy', async () => {
      const { agent, customerId, quotationId, product } = await customerWithQuotation();

      const payment = await PaymentModel.create({
        idempotencyKey: 'pay_test_policy_guard',
        quotationId,
        quotationReference: 'QTN-2026-TESTTEST',
        customerId,
        productId: product._id,
        agentId: agent.agentId,
        attempt: 1,
        amount: 1_000_00,
        currency: 'inr',
        status: 'SUCCEEDED',
        isOpen: false,
      });

      await PolicyModel.create({
        policyNumber: 'POL-2026-TESTTEST',
        quotationId,
        quotationReference: 'QTN-2026-TESTTEST',
        paymentId: payment._id,
        customerId,
        productId: product._id,
        agentId: agent.agentId,
        customerName: 'Ananya Sharma',
        customerEmail: 'ananya@example.com',
        productName: product.name,
        productCategory: 'TERM',
        premiumAmount: 1_000_00,
        coverageAmount: lakh(50),
        currency: 'inr',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(),
      });

      const response = await authed(agent.token).delete(`/api/customers/${customerId}`).expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
      expect(response.body.error.message).toMatch(/polic/i);

      // Nothing was removed — not the customer, and not their records.
      expect(await CustomerModel.countDocuments({ _id: customerId })).toBe(1);
      expect(await QuotationModel.countDocuments({ customerId })).toBe(1);
      expect(await PolicyModel.countDocuments({ customerId })).toBe(1);
    });

    it('refuses to delete a customer with a payment still in progress', async () => {
      const { agent, customerId, quotationId, product } = await customerWithQuotation();

      await PaymentModel.create({
        idempotencyKey: 'pay_test_open_guard',
        quotationId,
        quotationReference: 'QTN-2026-TESTOPEN',
        customerId,
        productId: product._id,
        agentId: agent.agentId,
        attempt: 1,
        amount: 1_000_00,
        currency: 'inr',
        status: 'PENDING',
        isOpen: true,
      });

      const response = await authed(agent.token).delete(`/api/customers/${customerId}`).expect(409);

      expect(response.body.error.message).toMatch(/payment in progress|already paid/i);
      expect(await CustomerModel.countDocuments({ _id: customerId })).toBe(1);
    });

    it('allows deletion when only dead payment attempts remain', async () => {
      const { agent, customerId, quotationId, product } = await customerWithQuotation();

      await PaymentModel.create({
        idempotencyKey: 'pay_test_expired',
        quotationId,
        quotationReference: 'QTN-2026-TESTEXPD',
        customerId,
        productId: product._id,
        agentId: agent.agentId,
        attempt: 1,
        amount: 1_000_00,
        currency: 'inr',
        status: 'EXPIRED',
        isOpen: false,
      });

      const response = await authed(agent.token).delete(`/api/customers/${customerId}`).expect(200);

      expect(response.body.data.deletedPayments).toBe(1);
      expect(await PaymentModel.countDocuments({ customerId })).toBe(0);
    });

    it('does not let an agent delete another agent\u2019s customer', async () => {
      const { token } = await registerAgent();
      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);

      const stranger = await registerAgent();
      await authed(stranger.token)
        .delete(`/api/customers/${created.body.data.customer.id}`)
        .expect(404);

      expect(await CustomerModel.countDocuments()).toBe(1);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      const { token } = await registerAgent();
      await authed(token).delete(`/api/customers/${new mongoose.Types.ObjectId()}`).expect(404);
      await authed(token).delete('/api/customers/not-an-id').expect(400);
    });

    it('is safe to repeat: the second delete is a clean 404', async () => {
      const { token } = await registerAgent();
      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);
      const id = created.body.data.customer.id;

      await authed(token).delete(`/api/customers/${id}`).expect(200);
      await authed(token).delete(`/api/customers/${id}`).expect(404);
    });

    it('requires authentication', async () => {
      const { token } = await registerAgent();
      const created = await authed(token).post('/api/customers').send(customerPayload()).expect(201);

      await request(getApp()).delete(`/api/customers/${created.body.data.customer.id}`).expect(401);
    });
  });
});
