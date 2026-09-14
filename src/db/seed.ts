/* eslint-disable no-console */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { connectToDatabase, disconnectFromDatabase } from './connection';
import { isDuplicateKeyError } from '../middleware/errorHandler';
import { AgentModel } from '../modules/agents/agent.model';
import { ProductModel } from '../modules/products/product.model';
import { CustomerModel } from '../modules/customers/customer.model';
import { QuotationModel } from '../modules/quotations/quotation.model';
import { DocumentModel } from '../modules/documents/document.model';
import { PaymentModel } from '../modules/payments/payment.model';
import { PolicyModel } from '../modules/policies/policy.model';
import { NotificationModel } from '../modules/notifications/notification.model';
import { WebhookEventModel } from '../modules/payments/webhookEvent.model';
import { overrideCustomerEmail, SEED_CUSTOMERS, SEED_PRODUCTS } from './seed.data';

/**
 * Demo data seeder.
 *
 * Idempotent: products and customers are upserted on their natural keys, so
 * running it twice does not duplicate anything. Pass `--reset` to drop the
 * transactional collections (quotations, documents, payments, policies,
 * notifications, webhook events) and start the demo flow from scratch.
 *
 * The demo agent's credentials come from the environment — this script never
 * invents a password. See SEED_AGENT_EMAIL / SEED_AGENT_PASSWORD in .env.example.
 */

const RESET = process.argv.includes('--reset');
const CONFIRMED = process.argv.includes('--yes');

/** Anything not obviously on this machine is treated as someone's real data. */
function isLocalDatabase(uri: string): boolean {
  return /(?:\/\/|@)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::|\/)/.test(uri);
}

/** The seed's progress output is for an operator at a terminal. The test suite
 *  imports the same steps, where it would just be noise. */
const log = (...args: unknown[]) => {
  if (process.env.NODE_ENV !== 'test') console.log(...args);
};

function requireSeedCredentials(): { email: string; password: string; name: string; phone: string } {
  const email = process.env.SEED_AGENT_EMAIL?.trim();
  const password = process.env.SEED_AGENT_PASSWORD;

  if (!email || !password) {
    console.error(
      [
        '',
        'SEED_AGENT_EMAIL and SEED_AGENT_PASSWORD must be set before seeding.',
        '',
        'These are the demo credentials you will publish in the README, so you',
        'choose them — the seeder will not generate a password for you.',
        '',
        '  SEED_AGENT_EMAIL=demo.agent@example.com',
        '  SEED_AGENT_PASSWORD=<choose a password of at least 8 characters>',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('SEED_AGENT_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  return {
    email: email.toLowerCase(),
    password,
    name: process.env.SEED_AGENT_NAME?.trim() || 'Demo Agent',
    phone: process.env.SEED_AGENT_PHONE?.trim() || '+919000000001',
  };
}

/**
 * Creates every declared index up front.
 *
 * `autoIndex` is disabled in production (see db/connection.ts) so cold starts
 * stay fast, which makes this the step that actually installs the unique
 * indexes the idempotency guarantees depend on. Run it against production once
 * after deploying.
 */
export async function syncIndexes() {
  const models = [
    AgentModel,
    ProductModel,
    CustomerModel,
    QuotationModel,
    DocumentModel,
    PaymentModel,
    PolicyModel,
    NotificationModel,
    WebhookEventModel,
  ];
  for (const model of models) {
    await model.syncIndexes();
  }
  log(`  indexes synced for ${models.length} collections`);
}

export async function resetTransactionalData() {
  const results = await Promise.all([
    NotificationModel.deleteMany({}),
    WebhookEventModel.deleteMany({}),
    PolicyModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    DocumentModel.deleteMany({}),
    QuotationModel.deleteMany({}),
  ]);
  const deleted = results.reduce((sum, result) => sum + result.deletedCount, 0);
  log(`  reset: removed ${deleted} quotation/document/payment/policy/notification records`);
}

export async function seedAgent() {
  const credentials = requireSeedCredentials();
  const passwordHash = await bcrypt.hash(credentials.password, 10);

  const agent = await AgentModel.findOneAndUpdate(
    { email: credentials.email },
    {
      $set: {
        name: credentials.name,
        phone: credentials.phone,
        role: 'AGENT',
        // Re-hashed on every run so changing SEED_AGENT_PASSWORD takes effect.
        passwordHash,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  log(`  agent: ${agent.email}`);
  return agent;
}

export async function seedProducts() {
  for (const product of SEED_PRODUCTS) {
    await ProductModel.findOneAndUpdate(
      { name: product.name, category: product.category },
      { $set: product },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  log(`  products: ${SEED_PRODUCTS.length} upserted`);
}

export async function seedCustomers(agentId: mongoose.Types.ObjectId) {
  const now = new Date();

  for (const customer of SEED_CUSTOMERS) {
    // Derive the date of birth from a fixed age so seeded customers do not age
    // out of a product's entry-age band as time passes. The birthday is placed
    // one day BEFORE today's date so the customer is exactly `ageYears` old
    // whenever the seed runs — a mid-month anchor would leave them a year
    // younger for half of every month and silently change their eligibility.
    const dateOfBirth = new Date(
      Date.UTC(
        now.getUTCFullYear() - customer.ageYears,
        now.getUTCMonth(),
        now.getUTCDate() - 1,
      ),
    );

    /**
     * Matched on PHONE, not email.
     *
     * The seed's natural key has to be a field the operator's configuration
     * cannot change, and SEED_CUSTOMER_EMAIL_OVERRIDE rewrites email. Keying on
     * email meant that turning the override on stopped matching the customers
     * already seeded, and the upsert tried to insert duplicates — which failed
     * on the unique phone index. Phone is stable across that switch, so the
     * same four customers are updated in place however the override is set.
     */
    await CustomerModel.findOneAndUpdate(
      { createdByAgent: agentId, phone: customer.phone },
      {
        $set: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          dateOfBirth,
          gender: customer.gender,
          occupation: customer.occupation,
          annualIncome: customer.annualIncome,
          city: customer.city,
          state: customer.state,
          postalCode: customer.postalCode,
          vehicle: customer.vehicle,
          health: customer.health,
          createdByAgent: agentId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    log(`  customer: ${customer.firstName} ${customer.lastName} — ${customer.note}`);
  }
}

/**
 * Optional override so confirmation emails during a live demo land in an inbox
 * the operator controls, rather than at example.com.
 *
 * Each customer keeps a distinct plus-addressed alias — see
 * `overrideCustomerEmail`. Giving them all the identical address would breach
 * the unique index on (createdByAgent, email) and collapse four demo customers
 * into one.
 */
export function applyCustomerEmailOverride(
  override = process.env.SEED_CUSTOMER_EMAIL_OVERRIDE ?? '',
) {
  if (!override.trim()) return;

  let applied = 0;
  SEED_CUSTOMERS.forEach((customer) => {
    const next = overrideCustomerEmail(override, customer.firstName, customer.email);
    if (next !== customer.email) {
      customer.email = next;
      applied += 1;
    }
  });

  if (applied === 0) {
    log(
      `  warning: SEED_CUSTOMER_EMAIL_OVERRIDE ("${override}") is not a valid email address — ignoring it`,
    );
    return;
  }

  log(`  note: seeded customers use plus-addressed aliases of ${override.trim()}`);
}

async function main() {
  log('\nSeeding Insurance Agent Platform demo data');
  log(`  database: ${env.MONGODB_URI.replace(/\/\/[^@]*@/, '//<credentials>@')}\n`);

  /**
   * `--reset` DELETES quotations, documents, payments, policies and
   * notifications. A plain seed only upserts, so it is safe anywhere, but a
   * reset against a remote database has to be asked for explicitly.
   */
  if (RESET && !isLocalDatabase(env.MONGODB_URI) && !CONFIRMED) {
    console.error(
      [
        '',
        'Refusing to --reset a remote database.',
        '',
        `  host: ${new URL(env.MONGODB_URI.replace(/^mongodb(\+srv)?:/, 'https:')).host}`,
        '',
        'This deletes every quotation, document, payment, policy and notification',
        'in that database. If that is what you want, re-run with --yes:',
        '',
        '  npm run seed:reset -- --yes',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  await connectToDatabase();
  await syncIndexes();

  if (RESET) await resetTransactionalData();

  applyCustomerEmailOverride();

  const agent = await seedAgent();
  await seedProducts();
  await seedCustomers(agent._id);

  log('\nSeed complete.');
  log(`Sign in at ${env.CLIENT_URL} with the SEED_AGENT_EMAIL / SEED_AGENT_PASSWORD you set.\n`);
}

// Guarded so the test suite can import the individual steps without the script
// connecting, seeding and calling process.exit on import.
if (require.main === module) {
  main()
    .then(async () => {
      await disconnectFromDatabase();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('\nSeed failed:', error instanceof Error ? error.message : error);
      if (isDuplicateKeyError(error)) {
        console.error(
          '\nA seeded record clashes with one already in the database. If you have edited a\n' +
            'demo customer, delete it in the app (or drop the `customers` collection) and re-run.',
        );
      }
      await disconnectFromDatabase().catch(() => undefined);
      process.exit(1);
    });
}
