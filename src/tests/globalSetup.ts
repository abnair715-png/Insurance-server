import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * One in-memory MongoDB for the whole run (Jest is configured with
 * `--runInBand`). Real MongoDB semantics — unique indexes, partial indexes,
 * atomic `findOneAndUpdate` — are exactly what the idempotency guarantees rely
 * on, so they are tested against the real engine rather than a mock.
 */
export default async function globalSetup() {
  const server = await MongoMemoryServer.create({ binary: { version: '7.0.24' } });
  (globalThis as { __MONGO_SERVER__?: MongoMemoryServer }).__MONGO_SERVER__ = server;
  process.env.MONGODB_URI = server.getUri('insurance_agent_platform_test');
}
