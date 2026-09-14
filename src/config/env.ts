import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Env file precedence — MOST SPECIFIC FIRST.
 *
 * `dotenv.config` never overwrites a variable that is already set, so whichever
 * source is read first wins. The resulting order is:
 *
 *   real environment  >  ./.env (server/)  >  ../.env (repo root)
 *
 * Reading the root file first would invert that and make a server-local file
 * silently inert — which is exactly how a local override can be ignored and a
 * command end up pointed at the wrong database.
 *
 * On Vercel neither file exists and the platform injects the variables directly,
 * so both calls are no-ops.
 */
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const isTest = process.env.NODE_ENV === 'test';

/**
 * Secrets must be real in production but may fall back to a fixed, obviously
 * non-production value under `NODE_ENV=test` so the suite runs without a .env.
 */
const secret = (name: string, testFallback: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .default(isTest ? testFallback : (undefined as unknown as string));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),

  /**
   * This API's own public origin, used to build the public document links a
   * customer opens from WhatsApp. When the SPA and API share an origin it is
   * the same as CLIENT_URL, which is why it defaults to it. Deployed
   * separately, set it to the API deployment's URL — otherwise share links
   * would point at the SPA, which does not serve the PDF.
   */
  API_PUBLIC_URL: z.string().url().optional(),

  /**
   * Extra browser origins allowed through CORS, comma-separated. Kept separate
   * from CLIENT_URL because that one must stay a single valid URL — it is also
   * what Stripe redirects back to after checkout.
   * Example: a Vercel preview deployment of the SPA.
   */
  CORS_ADDITIONAL_ORIGINS: z.string().default(''),

  MONGODB_URI: isTest
    ? z.string().default('mongodb://127.0.0.1:27017/test')
    : z.string().min(1, 'MONGODB_URI is required'),

  JWT_SECRET: secret('JWT_SECRET', 'test-jwt-secret-value-not-for-production-use'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  DOCUMENT_LINK_SECRET: secret(
    'DOCUMENT_LINK_SECRET',
    'test-document-link-secret-not-for-production',
  ),
  DOCUMENT_LINK_TTL_HOURS: z.coerce.number().int().positive().default(168),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_CURRENCY: z.string().length(3).toLowerCase().default('inr'),

  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Insurance Agent Platform <onboarding@resend.dev>'),

  COMPANY_NAME: z.string().default('Sentinel General Insurance'),
  COMPANY_SUPPORT_EMAIL: z.string().default('support@example.com'),
  COMPANY_SUPPORT_PHONE: z.string().default('+91 80 4000 0000'),
});

/**
 * An empty value in a .env file means "not set", not "set to an empty string".
 *
 * `.env` files are written with blank placeholders — `API_PUBLIC_URL=` is the
 * documented way to say "same origin, leave it alone". Passing that through as
 * `''` defeats every `.default()` below, and makes `.url().optional()` fail
 * outright because an empty string is present-but-invalid rather than absent.
 * Stripping blanks first is what makes a half-filled .env behave sensibly.
 */
const definedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== undefined && value.trim() !== ''),
);

const parsed = envSchema.safeParse(definedEnv);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `Invalid environment configuration.\n${details}\n\nCopy .env.example to .env and fill in the required values.`,
  );
}

export const env = {
  ...parsed.data,
  // Resolved once so callers never have to remember the fallback.
  API_PUBLIC_URL: parsed.data.API_PUBLIC_URL ?? parsed.data.CLIENT_URL,
};

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTestEnv = env.NODE_ENV === 'test';

/** Stripe is optional at boot: the app starts without it and the payments
 *  module returns a clear 503 instead of crashing the whole API. */
export const stripeEnabled = env.STRIPE_SECRET_KEY.length > 0;

/** When no Resend key is present the notification service falls back to the
 *  console provider so the rest of the flow stays demonstrable. */
export const emailProviderName = env.RESEND_API_KEY.length > 0 ? 'resend' : 'console';
