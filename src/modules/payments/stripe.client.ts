import Stripe from 'stripe';
import { env, stripeEnabled } from '../../config/env';
import { AppError } from '../../utils/AppError';

let client: Stripe | null = null;

/**
 * Stripe is pinned to an explicit API version so a server-side Stripe upgrade
 * cannot silently change response shapes under a deployed build.
 *
 * The key is read lazily: the API must boot and serve every non-payment route
 * even when Stripe is unconfigured, and the payments module then returns a
 * clear 503 rather than the process failing at import time.
 */
export function getStripe(): Stripe {
  // An injected client (tests) wins over environment detection.
  if (client) return client;

  if (!stripeEnabled) {
    throw AppError.serviceUnavailable(
      'Payments are not configured on this environment. Set STRIPE_SECRET_KEY to enable them.',
    );
  }
  client = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    typescript: true,
    maxNetworkRetries: 2,
  });
  return client;
}

/** Test seam: injects a stubbed Stripe client so tests never touch the network. */
export function setStripeClient(next: Stripe | null) {
  client = next;
}

export function assertWebhookConfigured() {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw AppError.serviceUnavailable('Stripe webhook secret is not configured.');
  }
}
