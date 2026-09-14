/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose, { type Model } from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../db/connection';
import { AgentModel } from '../modules/agents/agent.model';
import { ProductModel } from '../modules/products/product.model';
import { CustomerModel } from '../modules/customers/customer.model';
import { QuotationModel } from '../modules/quotations/quotation.model';
import { DocumentModel } from '../modules/documents/document.model';
import { PaymentModel } from '../modules/payments/payment.model';
import { PolicyModel } from '../modules/policies/policy.model';
import { NotificationModel } from '../modules/notifications/notification.model';
import { WebhookEventModel } from '../modules/payments/webhookEvent.model';
import { setStripeClient } from '../modules/payments/stripe.client';
import { setEmailProvider } from '../modules/notifications/email.service';

// Typed as a loose Model list: the union of nine concrete model types has no
// single callable signature, and these loops only need the shared operations.
const MODELS: Model<any>[] = [
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

beforeAll(async () => {
  await connectToDatabase(process.env.MONGODB_URI);
  // Build every index before the first test: the unique and partial indexes are
  // the mechanism under test, not an optimisation.
  await Promise.all(MODELS.map((model) => model.syncIndexes()));
});

afterEach(async () => {
  // deleteMany rather than dropDatabase: indexes must survive between tests.
  await Promise.all(MODELS.map((model) => model.deleteMany({})));
  setStripeClient(null);
  setEmailProvider(null);
});

afterAll(async () => {
  await disconnectFromDatabase();
  await mongoose.connection.close();
});
