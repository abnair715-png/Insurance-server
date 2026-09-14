# Payment idempotency

> Diagram: [diagrams/idempotency-flow.md](diagrams/idempotency-flow.md)

## The property

**One logical payment → one successful financial effect → one active policy →
one confirmation email.**

This must hold under every one of the following, in any combination:

| Scenario | What absorbs it |
| --- | --- |
| Agent double-clicks "Generate payment link" | Partial unique index on `payments.quotationId where isOpen` |
| Browser retries a POST after a timeout | Same index — the retry reads back the winner |
| Two concurrent requests from different tabs | Same index; exactly one insert survives |
| Stripe delivers the same event twice | Unique index on `webhook_events.eventId` |
| Stripe delivers two *different* events for one session | Conditional status transition — the second matches nothing |
| Two webhook deliveries processed concurrently | Conditional transition **and** unique index on `policies.paymentId` |
| Server restarts mid-webhook | Stripe retries; the handler re-enters and completes the missing step |
| Webhook arrives before the create-link response is written | Conditional update refuses to drag a terminal payment back to `PENDING` |
| Webhook arrives days late | Same conditional transition; a stale duplicate is inert |
| Customer pays, then reopens the checkout URL | Stripe closes a completed session; a `SUCCEEDED` payment also blocks new links with a 409 |
| Someone POSTs a forged `checkout.session.completed` | Signature verification rejects it before anything is read or written |
| Someone tampers with the charged amount | `session.amount_total` is compared to the stored `payment.amount`; a mismatch marks the payment `FAILED` and activates nothing |

## What the guarantee does *not* rest on

- **Not** a disabled button. The UI does disable it while a request is in
  flight, but that is a courtesy; the button is not part of the guarantee.
- **Not** in-memory state. Nothing is cached in the process. A serverless
  instance can be replaced between any two requests.
- **Not** Redis or a distributed lock. There is no lock anywhere in the system.
- **Not** a read-then-write check. Every "does it already exist?" is expressed
  as a database constraint or a conditional update, because a plain read leaves
  a window between the check and the write.

---

## Layer 1 — Deterministic idempotency key

```
idempotencyKey = `pay_${quotationReference}_${attempt}`
```

Derived, not random, so a retried request computes the same key. It is used
twice:

- as the value of a **unique index** on `payments.idempotencyKey`;
- as the **Stripe request idempotency key** on `checkout.sessions.create`, so
  even if our own defences were bypassed, Stripe returns the original session
  rather than creating a second one.

`attempt` only increases after the previous attempt reached a terminal
non-success state (`FAILED`, `EXPIRED`), which is what lets a customer who let a
checkout expire try again — as a genuinely new attempt with its own key.

## Layer 2 — One open payment per quotation

```js
paymentSchema.index(
  { quotationId: 1 },
  { unique: true, partialFilterExpression: { isOpen: true } },
);
```

`isOpen` is a denormalised `status ∈ {CREATED, PENDING}` maintained alongside
every status change.

The service inserts first and handles the duplicate-key error, rather than
reading first and inserting if absent:

```ts
try {
  payment = await PaymentModel.create({ ..., isOpen: true });
} catch (error) {
  if (!isDuplicateKeyError(error)) throw error;
  const winner = await PaymentModel.findOne({ quotationId, isOpen: true });
  if (isCheckoutUsable(winner)) return reuse(winner);   // 200, reused: true
  payment = winner;                                      // continue with theirs
}
```

The `attempt` counter used to build the key is read with `countDocuments`, which
is racy — two concurrent requests can read the same count. **That does not
matter.** Correctness comes from the index, not the count: only one insert
survives, and the loser continues with the winner's row and the winner's key.

> This is the bug the concurrency test found. An earlier version derived
> `attempt` from a count and relied only on the key's uniqueness; under five
> concurrent requests the count advanced between reads, producing two distinct
> keys and two payment rows. The partial index on `(quotationId) where isOpen`
> is what closed it — the constraint is now on the thing that must be unique
> (an open payment per quotation) rather than on a value derived from a read.

## Layer 3 — Webhook signature verification

```ts
stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET);
```

Verified over the **raw request bytes**. A re-serialised body will not verify,
which is why the JSON body parser preserves the original buffer and why the
Vercel adapter disables the platform's own body parsing.

Without this, `POST /api/webhooks/stripe` would be an unauthenticated endpoint
that activates policies for free. An invalid or missing signature is a 400, and
**nothing is written** — not even a `webhook_events` row.

## Layer 4 — Event ledger

```js
webhookEventSchema.index({ eventId: 1 }, { unique: true });
```

Stripe guarantees at-least-once delivery. The handler claims an event by
inserting its id; a duplicate insert means another delivery already has it.

Claims are stateful so a crash cannot strand an event:

| Existing state | Action |
| --- | --- |
| `PROCESSED` | Skip — `duplicate_event_already_processed` |
| `PROCESSING`, claimed < 2 min ago | Skip — another instance is working on it |
| `PROCESSING`, claimed > 2 min ago | Take over (the previous handler died) |
| `FAILED` | Take over and retry |

Taking over is itself a conditional `findOneAndUpdate`, so two retries cannot
both take over. Re-processing is safe because every step below is independently
idempotent.

## Layer 5 — Conditional state transition

```ts
const updated = await PaymentModel.findOneAndUpdate(
  { _id: payment._id, status: { $in: ['CREATED', 'PENDING'] } },
  { $set: { status: 'SUCCEEDED', isOpen: false, paidAt: new Date(), ... } },
  { new: true },
);
```

A single-document atomic update. The filter includes the *expected current
state*, so:

- the first delivery matches an open payment and settles it;
- every later delivery matches nothing and `updated` is `null`;
- a late `checkout.session.expired` cannot drag a `SUCCEEDED` payment backwards.

When `updated` is `null` the handler re-reads the payment. If it is already
`SUCCEEDED`, processing **continues** — because that is exactly what a crash
between settling the payment and writing the policy looks like, and the recovery
is to complete the missing step.

## Layer 6 — Policy activation guarded by a unique index

```js
policySchema.index({ paymentId: 1 }, { unique: true });
```

```ts
try {
  const policy = await PolicyModel.create({ paymentId, ... });
  return { policy, created: true };
} catch (error) {
  if (isDuplicateKeyError(error)) {
    return { policy: await PolicyModel.findOne({ paymentId }), created: false };
  }
  throw error;
}
```

No prior read, so there is no check-then-write window. Two concurrent handlers
both attempt the insert; the database lets exactly one through. `created` is the
signal that this delivery is the one that actually activated the policy — and it
is what gates the email.

## Layer 7 — Exactly one email

```js
notificationSchema.index({ policyId: 1, type: 1 }, { unique: true });
```

The email is only attempted when `created === true`, and the notification row is
itself under a unique index, so even a hypothetical second caller cannot send a
second confirmation.

Email is **outside the money path**. By the time it runs, the payment is
recorded and the policy is active. `sendPolicyActivationEmail` catches every
failure, records it on the notification row, and never rethrows — a provider
outage cannot fail the webhook or undo an activation.

It is `await`ed rather than fired and forgotten, because a serverless instance
is frozen as soon as the response is returned and an un-awaited promise would
frequently never run.

---

## Response semantics

| Call | Status | Meaning |
| --- | --- | --- |
| `POST /api/payments/create-link` (first) | `201` | New payment and Stripe session |
| `POST /api/payments/create-link` (repeat) | `200` with `reused: true` | Existing link returned |
| `POST /api/payments/create-link` (already paid) | `409` | Terminal; no new link |
| `POST /api/webhooks/stripe` (first) | `200` `{ processed: true }` | Handled |
| `POST /api/webhooks/stripe` (duplicate) | `200` `{ processed: false, reason }` | Acknowledged, no effect |
| `POST /api/webhooks/stripe` (bad signature) | `400` | Rejected, nothing written |
| `POST /api/webhooks/stripe` (processing failed) | `5xx` | Stripe retries with backoff |

Unknown event types and events for sessions this environment does not recognise
are acknowledged with `200`, not retried — otherwise Stripe would retry them for
days.

## Tests that hold this up

`server/src/modules/payments/webhook.test.ts` and `payment.test.ts`:

- repeated create-link returns the same link and creates exactly one row
- five concurrent `createPaymentLink` calls produce one payment and one URL
- a deterministic key is passed to Stripe
- a second `SUCCEEDED` payment for one quotation is rejected by the database
- the same event delivered three times activates one policy and sends one email
- two *different* events for one session activate one policy
- three concurrent deliveries of the same event activate one policy
- three concurrent deliveries of *different* events activate one policy
- a crash after settling the payment is recovered by the next delivery
- an amount mismatch marks the payment `FAILED` and activates nothing
- a late expiry event cannot undo a succeeded payment
- an email provider outage leaves the payment and policy intact and the failure
  recorded
