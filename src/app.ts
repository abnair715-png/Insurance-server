import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, isProduction } from './config/env';
import { connectToDatabase } from './db/connection';
import { jsonBodyParser } from './middleware/bodyParser';
import { requestLogger } from './middleware/requestLogger';
import { generalRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { asyncHandler } from './utils/asyncHandler';
import { sendSuccess } from './utils/apiResponse';
import { apiRouter } from './routes';

/**
 * Builds the Express application.
 *
 * Exported as a factory with no `listen` call, so the exact same app object is
 * used by the running server (src/index.ts) and by Supertest. There is no
 * second, deployment-specific code path that could drift from the one under
 * test.
 */
export function createApp(): Express {
  const app = express();

  // Render terminates TLS at its edge and forwards over HTTP with
  // X-Forwarded-* headers. Without this, `secure` cookies are never set and
  // req.ip is the proxy's address rather than the client's — which would also
  // make rate limiting count every request as coming from one IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and PDFs, never HTML that embeds third-party assets,
      // so a restrictive default CSP would only risk breaking PDF inline display.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  /**
   * The SPA is deployed separately, so every browser request is cross-origin and
   * CORS is load-bearing rather than a formality. Only the configured client
   * origin is allowed; `credentials: true` keeps the cookie path working for a
   * same-origin deployment, while the Bearer token covers the split one.
   *
   * CORS_ADDITIONAL_ORIGINS allows extra origins — a Vercel preview deployment
   * of the SPA, say — without touching CLIENT_URL, which must stay a single URL
   * because Stripe redirects back to it.
   */
  const allowedOrigins = new Set(
    [
      env.CLIENT_URL,
      ...env.CORS_ADDITIONAL_ORIGINS.split(',').map((origin) => origin.trim()),
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter(Boolean),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin, curl and server-to-server requests have no Origin header.
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS.'));
      },
      credentials: true,
    }),
  );

  app.use(cookieParser());
  app.use(jsonBodyParser);
  app.use(requestLogger);
  app.use(generalRateLimiter);

  // Every request opens (or reuses) the database connection before routing, so
  // no handler has to remember to do it. The cached-promise connection makes
  // this a no-op on warm invocations.
  app.use(
    asyncHandler(async (_req, _res, next) => {
      await connectToDatabase();
      next();
      return undefined;
    }),
  );

  app.get('/api/health', (_req, res) =>
    sendSuccess(res, {
      status: 'ok',
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    }),
  );

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  if (!isProduction) {
    app.locals.startedAt = new Date().toISOString();
  }

  return app;
}
