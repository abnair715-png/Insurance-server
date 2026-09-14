import mongoose from 'mongoose';
import { CustomerModel } from '../modules/customers/customer.model';
import { ProductModel } from '../modules/products/product.model';
import { overrideCustomerEmail, SEED_CUSTOMERS } from './seed.data';
import { applyCustomerEmailOverride, seedCustomers, seedProducts } from './seed';

const agentId = new mongoose.Types.ObjectId();

/** The seed data module is mutated in place by the override, so each test
 *  starts from the shipped addresses. */
const ORIGINAL_EMAILS = SEED_CUSTOMERS.map((customer) => customer.email);
const restoreSeedEmails = () => {
  SEED_CUSTOMERS.forEach((customer, index) => {
    customer.email = ORIGINAL_EMAILS[index];
  });
};

describe('overrideCustomerEmail', () => {
  afterEach(restoreSeedEmails);

  it('produces a distinct plus-addressed alias per customer', () => {
    expect(overrideCustomerEmail('me@gmail.com', 'Ananya', 'fallback@example.com')).toBe(
      'me+ananya@gmail.com',
    );
    expect(overrideCustomerEmail('me@gmail.com', 'Rahul', 'fallback@example.com')).toBe(
      'me+rahul@gmail.com',
    );
  });

  it('keeps working when the override already contains a tag', () => {
    expect(overrideCustomerEmail('me+demo@gmail.com', 'Meera', 'fallback@example.com')).toBe(
      'me+demo+meera@gmail.com',
    );
  });

  it('falls back to the original address when the override is not an email', () => {
    const fallback = 'ananya@example.com';
    expect(overrideCustomerEmail('not-an-email', 'Ananya', fallback)).toBe(fallback);
    expect(overrideCustomerEmail('@nolocal.com', 'Ananya', fallback)).toBe(fallback);
    expect(overrideCustomerEmail('no-domain@', 'Ananya', fallback)).toBe(fallback);
    expect(overrideCustomerEmail('   ', 'Ananya', fallback)).toBe(fallback);
  });

  it('gives every seeded customer a unique address', () => {
    applyCustomerEmailOverride('demo@gmail.com');
    const addresses = SEED_CUSTOMERS.map((customer) => customer.email);
    expect(new Set(addresses).size).toBe(SEED_CUSTOMERS.length);
  });
});

describe('seed script', () => {
  afterEach(restoreSeedEmails);

  it('creates every demo customer', async () => {
    await seedCustomers(agentId);
    expect(await CustomerModel.countDocuments()).toBe(SEED_CUSTOMERS.length);
  });

  it('is idempotent — re-running does not duplicate anything', async () => {
    await seedProducts();
    await seedCustomers(agentId);
    await seedProducts();
    await seedCustomers(agentId);

    expect(await CustomerModel.countDocuments()).toBe(SEED_CUSTOMERS.length);
    expect(await ProductModel.countDocuments()).toBe(7);
  });

  /**
   * The reported failure: seed once with the shipped addresses, then set
   * SEED_CUSTOMER_EMAIL_OVERRIDE and seed again. Keying the upsert on email
   * meant the second run could no longer find the existing customers and tried
   * to insert duplicates, which failed on the unique phone index.
   */
  it('survives turning the email override on after a plain seed', async () => {
    await seedCustomers(agentId);
    expect(await CustomerModel.countDocuments()).toBe(SEED_CUSTOMERS.length);

    applyCustomerEmailOverride('nobody@gmail.com');
    await expect(seedCustomers(agentId)).resolves.not.toThrow();

    // Updated in place, not duplicated.
    expect(await CustomerModel.countDocuments()).toBe(SEED_CUSTOMERS.length);

    const stored = await CustomerModel.find({ createdByAgent: agentId });
    expect(stored.every((customer) => customer.email.startsWith('nobody+'))).toBe(true);
    expect(new Set(stored.map((c) => c.email)).size).toBe(SEED_CUSTOMERS.length);
  });

  it('survives turning the override back off again', async () => {
    applyCustomerEmailOverride('nobody@gmail.com');
    await seedCustomers(agentId);

    restoreSeedEmails();
    await expect(seedCustomers(agentId)).resolves.not.toThrow();

    expect(await CustomerModel.countDocuments()).toBe(SEED_CUSTOMERS.length);
    const stored = await CustomerModel.find({ createdByAgent: agentId });
    expect(stored.every((customer) => customer.email.endsWith('@example.com'))).toBe(true);
  });

  it('keeps seeded ages exactly as declared, so eligibility is predictable', async () => {
    await seedCustomers(agentId);
    const stored = await CustomerModel.find({ createdByAgent: agentId });

    for (const customer of stored) {
      const declared = SEED_CUSTOMERS.find((s) => s.phone === customer.phone);
      const dob = customer.dateOfBirth;
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const monthDelta = now.getMonth() - dob.getMonth();
      if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) age -= 1;

      expect(age).toBe(declared?.ageYears);
    }
  });

  it('does not let two agents collide on the same seeded customers', async () => {
    const otherAgent = new mongoose.Types.ObjectId();
    await seedCustomers(agentId);
    await seedCustomers(otherAgent);

    expect(await CustomerModel.countDocuments()).toBe(SEED_CUSTOMERS.length * 2);
    expect(await CustomerModel.countDocuments({ createdByAgent: agentId })).toBe(
      SEED_CUSTOMERS.length,
    );
  });
});
