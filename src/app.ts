import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, isProduction } from './config/env';
import { logger } from './config/logger';
import { connectToDatabase } from './db/connection';
import { jsonBodyParser } from './middleware/bodyParser';
import { requestLogger } from './middleware/requestLogger';
import { generalRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { findInvalidOrigins, normaliseOrigin, parseOriginList } from './utils/origins';
import { describeCookiePolicy } from './modules/auth/token.service';
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
   * CORS.
   *
   * The SPA is deployed to a different origin from this API, so every browser
   * request is cross-origin and this allow-list is load-bearing rather than a
   * formality. It is built from:
   *
   *   - every origin in CLIENT_URL (comma-separated)
   *   - every origin in CORS_ADDITIONAL_ORIGINS (comma-separated)
   *   - the local Vite dev server
   *
   * Origins are normalised on both sides, so a trailing slash or capitalised
   * host in configuration still matches the browser's `Origin` header.
   */
  const allowedOrigins = new Set<string>([
    ...env.CLIENT_ORIGINS,
    ...parseOriginList(env.CORS_ADDITIONAL_ORIGINS),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);

  // A typo in either variable silently narrows the allow-list, and the symptom
  // is a CORS error in someone else's browser. Say so at boot instead.
  const invalid = [
    ...findInvalidOrigins(env.CORS_ADDITIONAL_ORIGINS),
  ];
  if (invalid.length > 0) {
    logger.warn('ignoring unusable CORS origins — each must be a full http(s) origin', {
      ignored: invalid,
      example: 'https://firsturl.com,https://secondurl.com',
    });
  }
  logger.info('CORS allow-list', { origins: [...allowedOrigins] });

  /**
   * The session cookie policy is derived from whether the client and the API
   * share a host. Log it, because getting it wrong produces the least
   * debuggable symptom there is: login succeeds, then every request is 401
   * because the browser silently declines to send the cookie back.
   */
  const cookiePolicy = describeCookiePolicy();
  logger.info('session cookie policy', {
    sameSite: cookiePolicy.sameSite,
    secure: cookiePolicy.secure,
    clientUrl: env.CLIENT_URL,
    apiUrl: env.API_PUBLIC_URL,
  });

  if (cookiePolicy.sameSite === 'none' && !env.API_PUBLIC_URL.startsWith('https://')) {
    logger.error(
      'The client and API are on different hosts, which requires SameSite=None; Secure — ' +
        'but API_PUBLIC_URL is not https. Browsers will reject the session cookie and every ' +
        'authenticated request will return 401.',
      { apiUrl: env.API_PUBLIC_URL },
    );
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header: same-origin, curl, server-to-server, or a Stripe
        // webhook. CORS does not apply to any of those.
        if (!origin) return callback(null, true);

        const normalised = normaliseOrigin(origin);
        if (normalised && allowedOrigins.has(normalised)) return callback(null, true);

        /**
         * Deny by omitting the CORS headers rather than throwing. Throwing would
         * surface as a 500 and hide the cause; this way the browser reports a
         * clean CORS error, non-browser clients are unaffected, and the log line
         * below names the exact origin to add.
         */
        logger.warn('CORS: origin not allowed', {
          origin,
          allowed: [...allowedOrigins],
          fix: 'add it to CLIENT_URL or CORS_ADDITIONAL_ORIGINS (comma-separated)',
        });
        return callback(null, false);
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
