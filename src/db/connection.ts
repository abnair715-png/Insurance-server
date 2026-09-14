import mongoose from 'mongoose';
import { env, isProduction } from '../config/env';
import { logger } from '../config/logger';

/**
 * Serverless-safe connection handling.
 *
 * On Vercel every cold start runs module code again, but warm invocations reuse
 * the same process. Opening a new connection per invocation would exhaust the
 * Atlas connection limit, so the connection promise is cached on `globalThis`
 * and awaited by every request through `connectToDatabase()`.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalWithMongoose = globalThis as typeof globalThis & { __mongooseCache?: MongooseCache };

const cache: MongooseCache = globalWithMongoose.__mongooseCache ?? { conn: null, promise: null };
globalWithMongoose.__mongooseCache = cache;

export async function connectToDatabase(uri: string = env.MONGODB_URI): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;

  if (!cache.promise) {
    mongoose.set('strictQuery', true);
    // Index creation is a schema-migration concern: fine to do automatically in
    // dev/test, but in production indexes are created once by `npm run seed`
    // rather than on every cold start.
    mongoose.set('autoIndex', !isProduction);

    cache.promise = mongoose
      .connect(uri, {
        // Keep the pool small: many short-lived serverless instances each holding
        // a large pool is the usual way to hit Atlas connection limits.
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
      })
      .then((m) => {
        logger.info('MongoDB connected', { host: m.connection.host, db: m.connection.name });
        return m;
      })
      .catch((error) => {
        // Clear the cached promise so the next request retries instead of
        // permanently resolving to a rejected promise.
        cache.promise = null;
        throw error;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (cache.conn) {
    await mongoose.disconnect();
    cache.conn = null;
    cache.promise = null;
  }
}
