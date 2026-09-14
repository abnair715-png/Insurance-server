import rateLimit, { type Options } from 'express-rate-limit';
import { isTestEnv } from '../config/env';

/**
 * Rate limiting is in-memory per serverless instance. That is honest for an MVP:
 * it stops a single client hammering an endpoint, but is not a distributed limit
 * across Vercel instances. A shared store (Upstash Redis) is the production step
 * — see docs/technical-decisions.md.
 */
const base = (options: Partial<Options>) =>
  rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Limits would make the test suite flaky and prove nothing.
    skip: () => isTestEnv,
    handler: (_req, res) =>
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
      }),
    ...options,
  });

/** Tight limit on credential endpoints: brute-force and enumeration defence. */
export const authRateLimiter = base({ windowMs: 15 * 60 * 1000, limit: 20 });

/** Payment link creation is idempotent but still hits Stripe, so it is capped. */
export const paymentRateLimiter = base({ windowMs: 60 * 1000, limit: 20 });

/** Broad ceiling for the rest of the authenticated API. */
export const generalRateLimiter = base({ windowMs: 60 * 1000, limit: 300 });

/** Public, unauthenticated document links. */
export const publicDocumentRateLimiter = base({ windowMs: 60 * 1000, limit: 30 });
