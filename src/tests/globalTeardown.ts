import type { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalTeardown() {
  const server = (globalThis as { __MONGO_SERVER__?: MongoMemoryServer }).__MONGO_SERVER__;
  if (server) await server.stop();
}
