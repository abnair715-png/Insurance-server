import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app';
import { ProductModel, type ProductDocument } from '../modules/products/product.model';
import { CustomerModel, type CustomerDocument } from '../modules/customers/customer.model';
import { toMinorUnits } from '../utils/money';

export const lakh = (value: number) => toMinorUnits(value * 100_000);

let app: Express | null = null;

export function getApp(): Express {
  if (!app) app = createApp();
  return app;
}

export const VALID_PASSWORD = 'Str0ngPassword';

interface RegisteredAgent {
  token: string;
  agentId: string;
  email: string;
}

export async function registerAgent(overrides: Partial<Record<string, string>> = {}): Promise<RegisteredAgent> {
  const email = overrides.email ?? `agent.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

  const response = await request(getApp())
    .post('/api/auth/register')
    .send({
      name: overrides.name ?? 'Test Agent',
      email,
      password: overrides.password ?? VALID_PASSWORD,
      phone: overrides.phone ?? '+919000000001',
    })
    .expect(201);

  return {
    token: response.body.data.token,
    agentId: response.body.data.agent.id,
    email,
  };
}

/** Authenticated request helper — Bearer keeps the tests free of a cookie jar. */
export function authed(token: string) {
  const agent = request(getApp());
  return {
    get: (url: string) => agent.get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => agent.post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => agent.put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => agent.delete(url).set('Authorization', `Bearer ${token}`),
  };
}

/** A permissive term product: eligible for the default test customer. */
export async function createTestProduct(
  overrides: Partial<ProductDocument> = {},
): Promise<ProductDocument> {
  return ProductModel.create({
    name: overrides.name ?? `Test Term Cover ${Math.random().toString(36).slice(2, 8)}`,
    category: overrides.category ?? 'TERM',
    description: overrides.description ?? 'A term product used by the test suite.',
    basePremium: overrides.basePremium ?? toMinorUnits(10_000),
    coverageAmount: overrides.coverageAmount ?? lakh(50),
    keyBenefits: overrides.keyBenefits ?? ['Benefit one', 'Benefit two'],
    eligibilityRules: overrides.eligibilityRules ?? { minAge: 18, maxAge: 60, minAnnualIncome: lakh(3) },
    pricingFactors: overrides.pricingFactors ?? {
      ageBands: [{ minAge: 18, maxAge: 60, multiplier: 1 }],
      smokerLoadingPct: 50,
    },
    active: overrides.active ?? true,
  });
}

export function customerPayload(overrides: Record<string, unknown> = {}) {
  const dateOfBirth = new Date(Date.UTC(new Date().getUTCFullYear() - 32, 0, 15))
    .toISOString()
    .slice(0, 10);

  return {
    firstName: 'Ananya',
    lastName: 'Sharma',
    email: `ananya.${Math.random().toString(36).slice(2, 8)}@example.com`,
    phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    dateOfBirth,
    gender: 'FEMALE',
    occupation: 'Software Engineer',
    annualIncome: lakh(12),
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
    vehicle: { owns: true, type: 'CAR', value: lakh(9), registrationYear: 2021 },
    health: { smoker: false, preExistingConditions: false },
    ...overrides,
  };
}

export async function createTestCustomer(
  agentId: string,
  overrides: Record<string, unknown> = {},
): Promise<CustomerDocument> {
  const payload = customerPayload(overrides);
  return CustomerModel.create({
    ...payload,
    dateOfBirth: new Date(payload.dateOfBirth as string),
    createdByAgent: agentId,
  });
}
