# Database design

> Diagram: [diagrams/entity-relationships.md](diagrams/entity-relationships.md)

MongoDB (Atlas) with Mongoose. Nine collections.

## Conventions applied everywhere

**Money is an integer in minor units.** Every monetary field — `basePremium`,
`coverageAmount`, `annualIncome`, `vehicle.value`, `premiumAmount`, `amount` —
is a whole number of paise. No floating-point arithmetic touches the money path,
Stripe expects minor units so there is no conversion at the boundary, and the
values are safe to compare and index. Conversion to a display string happens
only in the UI, the PDF and emails.

**References, not embedding, for anything with its own lifecycle.** Customers,
quotations, payments and policies are all queried and updated independently, so
they are separate documents joined by `ObjectId`.

**Snapshots where history must not move.** A quotation stores its own copy of
the customer and product facts it was priced from. If the catalogue price
changes tomorrow, or the customer corrects their address, a quotation already
sent to a customer — and any policy issued from it — must still read as it did
when it was agreed. This is denormalisation for correctness, not for speed.

**`toJSON` is centralised.** `db/plugins.ts` maps `_id` → `id`, drops `__v`, and
strips fields named as private. That is why no controller can leak
`passwordHash` by serialising a model.

---

## Collections

### `agents`

| Field | Type | Notes |
| --- | --- | --- |
| `name`, `phone` | String | |
| `email` | String | lowercased on write |
| `passwordHash` | String | bcrypt, cost 10, `select: false` |
| `role` | Enum | `AGENT` \| `ADMIN` — only `AGENT` is issued today |

| Index | Why |
| --- | --- |
| `{ email: 1 }` unique | Login lookup, and the reason a duplicate signup is a 409 rather than two accounts |

Storing `email` lowercased makes the unique index effectively case-insensitive
without needing a collation-aware index.

### `products`

Carries two sub-documents that are the heart of the domain.

`eligibilityRules` — the complete vocabulary the engine understands:
`minAge`, `maxAge`, `minAnnualIncome`, `maxAnnualIncome`, `allowedGenders`,
`requiresVehicle`, `allowedVehicleTypes`, `minVehicleValue`, `maxVehicleValue`,
`excludeSmokers`, `excludePreExistingConditions`.

`pricingFactors` — `ageBands[]`, `smokerLoadingPct`, `preExistingLoadingPct`,
`vehicleValueRatePct`, `coverageIncomeMultiple`.

Both are **data**, so launching a product or changing who qualifies for one is a
database change rather than a deployment. The trade-off is that a genuinely
novel rule needs a new evaluator entry as well.

| Index | Why |
| --- | --- |
| `{ active: 1, category: 1 }` | Serves both catalogue browsing and the eligibility engine's "all active products" scan |
| `{ name: 1, category: 1 }` unique | Makes the seed script re-runnable: it upserts on this key rather than duplicating |

### `customers`

Personal, contact, income, location, `vehicle{owns,type,value,registrationYear}`
and `health{smoker,preExistingConditions}`.

Only the two health declarations the rules actually consume are collected.
Storing real medical history would bring the MVP into scope for health-data
regulation and demonstrate nothing extra.

| Index | Why |
| --- | --- |
| `{ createdByAgent: 1, createdAt: -1 }` | Every list query is agent-scoped and recency-ordered |
| `{ createdByAgent: 1, email: 1 }` unique | See below |
| `{ createdByAgent: 1, phone: 1 }` unique | See below |
| text index on name/email/phone | Dashboard search |

Uniqueness is **per agent, not global**. Two agents legitimately serving the
same person must both be able to record them; the same agent entering the same
person twice is a data-entry mistake and gets a 409.

### `quotations`

| Field | Notes |
| --- | --- |
| `reference` | `QTN-YYYY-XXXXXXXX`, human-facing, unique |
| `premiumAmount`, `coverageAmount`, `currency` | Frozen at quote time |
| `premiumBreakdown[]` | The steps that produced the premium — shown in the UI and on the PDF |
| `customerSnapshot`, `productSnapshot`, `eligibilitySnapshot` | See "Snapshots" above |
| `status` | `DRAFT` → `DOCUMENT_GENERATED` → `PAYMENT_PENDING` → `CONVERTED` (or `EXPIRED`) |
| `isOpen` | Denormalised `status ∈ open states` |
| `expiresAt` | 30 days; a stale premium cannot be paid |

| Index | Why |
| --- | --- |
| `{ reference: 1 }` unique | Lookup by the reference printed on the PDF |
| `{ customerId: 1, createdAt: -1 }` | Customer profile timeline |
| `{ agentId: 1, status: 1 }` | Dashboard counts |
| `{ customerId: 1, productId: 1 }` unique **where `isOpen`** | At most one open quotation per customer/product |

That last index is what makes "select this product" safely repeatable: a
double-click, a browser retry or two concurrent requests converge on one
quotation reference instead of producing several offers for the same thing.

> **Why a denormalised `isOpen` flag rather than `status: { $in: [...] }`?**
> A partial index's `partialFilterExpression` supports equality and a small set
> of operators; `$in` is not portable across MongoDB versions. A boolean the
> application maintains alongside `status` keeps the constraint enforceable by
> the database, which is the whole point. The same pattern is used on `payments`.

### `documents`

Metadata only — **the PDF bytes are never stored**. The PDF is rendered on
demand from the quotation's immutable snapshots, so the same reference always
produces the same document. That removes blob storage from the system entirely,
which matters on Vercel where the filesystem is ephemeral and per-invocation.

No link token is stored either. The public token is
`HMAC-SHA256(DOCUMENT_LINK_SECRET, "<reference>:<version>")`, so a database dump
alone yields no working link, the agent can re-derive the link on any later page
load, and incrementing `version` revokes every link shared so far.

| Index | Why |
| --- | --- |
| `{ reference: 1 }` unique | Public link lookup |
| `{ quotationId: 1 }` unique | One document per quotation; regenerating updates it in place |
| `{ customerId: 1 }` | "What have we sent this customer?" |

### `payments`

| Field | Notes |
| --- | --- |
| `idempotencyKey` | `pay_<quotationReference>_<attempt>` — deterministic, also sent to Stripe |
| `attempt` | 1-based; a new attempt only after a terminal non-success |
| `amount`, `currency` | Copied from the quotation, never from a client |
| `status` | `CREATED` → `PENDING` → `SUCCEEDED` \| `FAILED` \| `EXPIRED` |
| `isOpen` | Denormalised `status ∈ {CREATED, PENDING}` |
| `stripeSessionId`, `stripePaymentIntentId`, `checkoutUrl`, `checkoutExpiresAt` | |
| `lastStripeEventId` | Audit trail for "why is this SUCCEEDED?" |

| Index | Why |
| --- | --- |
| `{ idempotencyKey: 1 }` unique | One row per logical attempt |
| `{ quotationId: 1 }` unique **where `isOpen`** | At most one open attempt per quotation — the concurrency control for link creation |
| `{ quotationId: 1 }` unique **where `status: 'SUCCEEDED'`** | At most one successful charge per quotation, **ever** |
| `{ stripeSessionId: 1 }` unique sparse | Webhook lookup on every delivery |
| `{ agentId: 1, status: 1, createdAt: -1 }` | Dashboard |
| `{ customerId: 1, createdAt: -1 }` | Customer timeline |

The two partial unique indexes are the substance of the idempotency guarantee.
They are enforced by the database, so even a bug in the service layer cannot
record a second successful charge.

### `policies`

Denormalises `customerName`, `customerEmail`, `productName`, `productCategory`
so a list view or a confirmation email needs no fan-out of lookups.

| Index | Why |
| --- | --- |
| `{ policyNumber: 1 }` unique | Human-facing identifier |
| `{ paymentId: 1 }` unique | **One policy per payment** — the activation path is an insert guarded by this index |
| `{ quotationId: 1 }` unique | One policy per quotation |
| `{ agentId: 1, status: 1, createdAt: -1 }` | Dashboard and listing |
| `{ customerId: 1, createdAt: -1 }` | Customer timeline |

### `webhook_events`

A flat ledger: `eventId`, `type`, `status` (`PROCESSING` \| `PROCESSED` \|
`FAILED`), `receivedAt`, `processedAt`, `error`.

| Index | Why |
| --- | --- |
| `{ eventId: 1 }` unique | Turns a duplicate Stripe delivery into a cheap no-op |

This is a fast path, **not** the correctness mechanism — the conditional payment
transition and the policy unique index each guarantee exactly-once on their own.

### `notifications`

An outbox: `type`, `to`, `subject`, `status`, `policyId`, `attempts`,
`provider`, `providerMessageId`, `lastError`, `sentAt`.

A row is written **before** the provider is called, so a crash mid-send leaves an
auditable `PENDING` record rather than silence.

| Index | Why |
| --- | --- |
| `{ policyId: 1, type: 1 }` unique | The customer cannot be emailed twice for one policy |
| `{ status: 1, createdAt: 1 }` | Finds `FAILED` rows to retry |

---

## Deletion and referential integrity

MongoDB has no foreign keys, so cascading deletes are the application's job. One
collection allows deletion — `customers` — and it is guarded rather than
cascaded blindly:

| Related record | On customer delete |
| --- | --- |
| `policies` | **Blocks the delete.** A policy is a financial record and an obligation |
| `payments` — `SUCCEEDED` | **Blocks the delete.** Money moved |
| `payments` — `CREATED`/`PENDING` | **Blocks the delete.** A live Stripe checkout link exists; paying it after the customer was removed would activate a policy for someone who no longer exists |
| `payments` — `FAILED`/`EXPIRED` | Deleted. Dead attempts, no money moved |
| `quotations` | Deleted. An offer, not an obligation |
| `documents` | Deleted, which also invalidates any shared PDF link |

Children are deleted **before** the customer, so a failure partway through
leaves the customer still listed and the operation simply retryable — the
opposite order would orphan records under a customer that no longer exists.

No transaction is used, and none is needed: blocking on open payments also
closes the check-then-delete window, because a policy can only ever be created
from an open payment. If there is no open payment at the moment of the check, no
new policy can appear while the delete runs.

## What is atomic, and what is not

| Operation | Guarantee | Mechanism |
| --- | --- | --- |
| Agent signup | One account per email | Unique index |
| Customer create | One record per (agent, email) and (agent, phone) | Unique indexes |
| Quotation create | One open quotation per (customer, product) | Partial unique index + read-back on duplicate key |
| Payment link create | One open payment per quotation | Partial unique index + read-back |
| Stripe session create | One session per attempt | Stripe idempotency key |
| Payment settle | `SUCCEEDED` exactly once | Conditional `findOneAndUpdate` on open statuses |
| Policy activate | One policy per payment | Unique index on `paymentId`; duplicate key ⇒ `created: false` |
| Confirmation email | One per policy | Unique index on `(policyId, type)` |

## Why no MongoDB transactions

Atlas runs a replica set, so multi-document transactions are available. They are
not used, because the sequence that looks like it needs one — settle the
payment, then create the policy — is already safe without one:

- the payment transition is a single-document atomic update, conditional on the
  current status;
- the policy insert is a single document guarded by a unique index;
- if the process dies between the two, a Stripe retry re-enters the handler,
  finds the payment already `SUCCEEDED`, and the policy insert (still missing)
  succeeds. The handler explicitly covers this recovery path, and a test asserts
  it.

A transaction would add a session, retry-on-transient-error handling and a
performance cost to buy a guarantee the unique indexes already provide. The
rollback semantics would also be wrong: once Stripe has taken the money, the
correct response to a later failure is to retry forward, not to unwind.

## Index creation in production

`autoIndex` is disabled when `NODE_ENV=production`, so cold starts do not
attempt index builds. Indexes are created once by `npm run seed`, which calls
`syncIndexes()` on all nine models. **Running the seed against a fresh
production database is therefore required, not optional** — the idempotency
guarantees depend on those indexes existing.
