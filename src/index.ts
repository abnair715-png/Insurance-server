import { createApp } from './app';
import { env } from './config/env';
import { connectToDatabase, disconnectFromDatabase } from './db/connection';
import { logger } from './config/logger';

/**
 * Process entry point — local development and production alike.
 *
 * The API runs on Render as a long-lived Node process, so this file is what
 * actually serves traffic. Render injects PORT; `app.listen(port)` binds
 * 0.0.0.0, which is what Render's router requires.
 *
 * Keeping the listening server separate from the app factory is what lets the
 * test suite mount the identical application through Supertest without opening
 * a socket.
 */
async function start() {
  try {
    await connectToDatabase();
  } catch (error) {
    logger.error('Failed to connect to MongoDB on startup', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`, { environment: env.NODE_ENV });
  });

  // Render sends SIGTERM on deploy and on free-plan spin-down. Draining
  // in-flight requests first avoids cutting off a Stripe webhook mid-processing
  // — which would be safe (the handler is idempotent and Stripe retries) but is
  // avoidable noise.
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(async () => {
      await disconnectFromDatabase();
      process.exit(0);
    });
    // Do not hang forever if a connection refuses to close.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void start();
