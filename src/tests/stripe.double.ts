/* eslint-disable @typescript-eslint/no-explicit-any */
import type Stripe from 'stripe';
import type { EmailMessage, EmailProvider, EmailSendResult } from '../modules/notifications/email.provider';

/**
 * Stripe test double.
 *
 * It reproduces the two behaviours the application actually depends on:
 *   - `checkout.sessions.create` returns a session with an id, a URL and an
 *     expiry
 *   - requests carrying the same idempotency key return the SAME session,
 *     exactly as Stripe does
 * Nothing here reaches the network.
 */
export interface StripeDouble {
  client: Stripe;
  createSession: jest.Mock;
  /** Sessions created, keyed by idempotency key. */
  sessionsByKey: Map<string, Stripe.Checkout.Session>;
}

export function createStripeDouble(): StripeDouble {
  const sessionsByKey = new Map<string, Stripe.Checkout.Session>();
  let counter = 0;

  const createSession = jest.fn(async (params: any, options: { idempotencyKey?: string } = {}) => {
    const key = options.idempotencyKey ?? `auto_${counter}`;
    const existing = sessionsByKey.get(key);
    if (existing) return existing;

    counter += 1;
    const session = {
      id: `cs_test_${counter}_${Math.random().toString(36).slice(2, 8)}`,
      object: 'checkout.session',
      url: `https://checkout.stripe.test/pay/cs_test_${counter}`,
      expires_at: Math.floor((Date.now() + 24 * 3600 * 1000) / 1000),
      amount_total: params.line_items?.[0]?.price_data?.unit_amount,
      currency: params.line_items?.[0]?.price_data?.currency,
      payment_status: 'unpaid',
      payment_intent: `pi_test_${counter}`,
      metadata: params.metadata ?? {},
    } as unknown as Stripe.Checkout.Session;

    sessionsByKey.set(key, session);
    return session;
  });

  const client = {
    checkout: { sessions: { create: createSession } },
    webhooks: {
      // Signature verification is exercised separately; here a payload that
      // parses is accepted and anything else is rejected the way Stripe does.
      constructEvent: (body: Buffer, signature: string) => {
        if (signature !== 'valid-signature') {
          throw new Error('No signatures found matching the expected signature for payload.');
        }
        return JSON.parse(body.toString('utf8'));
      },
    },
  } as unknown as Stripe;

  return { client, createSession, sessionsByKey };
}

/** Builds a `checkout.session.completed` event for a session the double made. */
export function checkoutCompletedEvent(
  session: Stripe.Checkout.Session,
  overrides: { id?: string; amountTotal?: number } = {},
): Stripe.Event {
  return {
    id: overrides.id ?? `evt_test_${Math.random().toString(36).slice(2, 10)}`,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.completed',
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        ...session,
        payment_status: 'paid',
        amount_total: overrides.amountTotal ?? session.amount_total,
      },
    },
  } as unknown as Stripe.Event;
}

export function checkoutExpiredEvent(session: Stripe.Checkout.Session): Stripe.Event {
  return {
    id: `evt_exp_${Math.random().toString(36).slice(2, 10)}`,
    object: 'event',
    created: Math.floor(Date.now() / 1000),
    type: 'checkout.session.expired',
    livemode: false,
    data: { object: session },
  } as unknown as Stripe.Event;
}

/** Email provider double that records sends instead of delivering them. */
export class RecordingEmailProvider implements EmailProvider {
  readonly name = 'recording';
  readonly sent: EmailMessage[] = [];
  private failNext = false;

  failOnce() {
    this.failNext = true;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated provider outage');
    }
    this.sent.push(message);
    return { id: `rec_${this.sent.length}` };
  }
}
