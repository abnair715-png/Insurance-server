# Insurance Agent Platform — API (and system documentation)

A web application for insurance agents: capture a prospective customer, see
exactly which products they qualify for and why, generate a personalised
quotation PDF, share it and a payment link over WhatsApp, and have the policy
activate itself the moment Stripe confirms payment.

**Live demo:** "https://insurance-agent-platform.vercel.app"

### Sign in as

| Field | Value |
| --- | --- |
| **Email** | `demo@sentinelinsurance.com` |
| **Password** | `seedagent@insurance` |

Stripe test card: **`4242 4242 4242 4242`**, any future expiry, any CVC, any
postcode. No real money moves — the application runs in Stripe **test mode**
only.

**Evaluator quick links:** [How to run](#how-to-run) ·
[Environment variables](#environment-variables) ·
[Third-party services](#third-party-services) ·
[Demo credentials](#demo-credentials) ·
[Manual verification checklist](#manual-verification-checklist)

---

## Contents

1. [Project overview](#project-overview)
2. [Business problem](#business-problem)
3. [MVP scope](#mvp-scope)
4. [Key features](#key-features)
5. [Architecture](#architecture)
6. [Technology stack](#technology-stack)
7. [System flow](#system-flow)
8. [Database design](#database-design)
9. [API overview](#api-overview)
10. [Authentication flow](#authentication-flow)
11. [Insurance eligibility logic](#insurance-eligibility-logic)
12. [PDF generation](#pdf-generation)
13. [WhatsApp integration](#whatsapp-integration)
14. [Payment flow](#payment-flow)
15. [Idempotency strategy](#idempotency-strategy)
16. [Stripe test mode](#stripe-test-mode)
17. [Webhook handling](#webhook-handling)
18. [Email flow](#email-flow)
19. [Error handling](#error-handling)
20. [Security considerations](#security-considerations)
21. [Testing](#testing)
22. [How to run](#how-to-run)
23. [Environment variables](#environment-variables)
24. [Seeding demo data](#seeding-demo-data)
25. [Push to GitHub, then deploy](#push-to-github-then-deploy)
26. [Third-party services](#third-party-services)
27. [Demo credentials](#demo-credentials)
28. [Known limitations](#known-limitations)
29. [Future improvements](#future-improvements)
30. [Architecture trade-offs](#architecture-trade-offs)

---

## Project overview

An insurance company sells term life, health, vehicle and general products
through agents. This application is the agent's workspace: it takes them from a
first conversation with a prospective customer all the way to an active policy,
without leaving the browser.

The whole journey is demonstrable with seeded data in about three minutes.

## Business problem

An agent meeting a prospective customer has to answer four questions, in order:

1. **Which of our products can this person actually buy?** Age, income, vehicle
   ownership and declared health all gate different products. Getting this wrong
   wastes the customer's time and the agent's credibility.
2. **What will it cost them?** The premium depends on the same facts, and the
   customer will ask *why* it is that number.
3. **How do I get something in their hands?** Customers want a document they can
   read and forward, delivered where they already are — WhatsApp.
4. **How do I take the money and start the cover?** Without a spreadsheet, and
   without any risk of charging twice.

Today that is typically a PDF template, a calculator, a manual payment link and
a reconciliation step. This application makes each step a click, and makes the
money path safe by construction.

## MVP scope

**In scope — built and working**

- Agent signup, login, logout, protected routes
- Product catalogue served from MongoDB
- Customer creation, editing, deletion (guarded and cascading), search, per-agent isolation
- Eligibility engine with per-product rules and explained ineligibility
- Server-side premium calculation with a visible breakdown
- Quotation lifecycle with immutable snapshots
- Personalised PDF generation and a signed public share link
- WhatsApp click-to-chat sharing for both documents and payment links
- Stripe Checkout in test mode with multi-layer idempotency
- Signature-verified webhook, exactly-once policy activation
- Confirmation email via Resend behind a provider abstraction
- Dashboard, policy listing, notification delivery log
- 208 tests, complete documentation, Vercel deployment configuration

**Deliberately out of scope** — with the reasoning in
[docs/technical-decisions.md](docs/technical-decisions.md): claims handling,
renewals, commission, multi-agent hierarchies and admin roles, customer logins,
document e-signature, real underwriting, KYC, and the WhatsApp Business API.

## Key features

| Feature | What makes it more than a CRUD screen |
| --- | --- |
| **Eligibility engine** | Rules are data on each product, interpreted by one pure evaluator. Ineligible products are shown *with their reasons*, and the rule is re-checked server-side when a quotation is created |
| **Premium calculation** | Derived entirely server-side; every step is recorded and shown identically on screen and on the PDF |
| **Quotation snapshots** | A quotation freezes the customer and product facts it was priced from, so a later catalogue change cannot rewrite history |
| **PDF generation** | Rendered on demand from the quotation — no bytes stored anywhere, which is what makes it work on ephemeral serverless storage |
| **Public share links** | HMAC-derived, never stored, constant-time compared, expiring, and revoked by regenerating the document |
| **Payment idempotency** | Five independent layers, enforced by database constraints rather than application checks — see below |
| **Webhook handling** | Signature-verified over raw bytes, replay-safe, concurrency-safe, and able to recover from a crash mid-processing |
| **Email isolation** | Outside the money path: a provider outage cannot undo a payment or an activation |

## Architecture

> [docs/architecture.md](docs/architecture.md) ·
> [diagram](docs/diagrams/high-level-architecture.md)

A **modular monolith**. One deployable Express application, split into modules
that each own their model, validators, service, controller and routes.

```
React SPA  (client project)
   │  cross-origin HTTPS · Authorization: Bearer <jwt> · CORS allow-list
   ▼
Render  ──►  node dist/index.js  ──►  createApp()   (the same Express app
   │                                                  used locally and in tests)
   ▼
helmet · CORS · cookies · raw-preserving body parser · rate limit · request log
   ▼
requireAuth  →  validate(zod)  →  controller  →  service
                                                    │
                            ┌───────────────────────┼───────────────────────┐
                            ▼                       ▼                       ▼
                     MongoDB Atlas            Stripe (test)             Resend
```

Rules that hold throughout:

- **Controllers are thin.** Read the request, call one service, shape the
  response. No domain logic, no database access.
- **Services never see `req`/`res`.** They take plain arguments and throw
  `AppError`. That is why the eligibility engine is unit-testable with no HTTP.
- **Validation precedes logic.** The zod parse result *replaces* the request
  body, which also strips unknown keys — a client cannot smuggle `role: "ADMIN"`
  or a `premiumAmount` into a create call.
- **Ownership is a query filter, not an `if`.** Every read and write is scoped by
  `createdByAgent`/`agentId`, so another agent's id matches nothing and returns
  404 rather than 403.
- **Invariants are database constraints**, not application checks.

### Repository layout

The API is a standalone npm project with no build-time dependency on the client.
The only contract between the two repositories is the HTTP API and the three
URLs in [docs/deployment-overview.md](docs/deployment-overview.md).

```
Insurance-Agent-Platform-server/          ← THIS repository
├── src/
│   ├── app.ts                   # Express factory — no listen(), so tests mount
│   │                            #   the identical application
│   ├── index.ts                 # process entry point (what Render runs)
│   ├── config/                  # env (zod-validated), constants, logger
│   ├── db/                      # connection, schema plugins, seed
│   ├── middleware/              # auth, validate, errorHandler, bodyParser,
│   │                            #   rateLimiter, requestLogger
│   ├── routes/index.ts          # mounts every module under /api
│   ├── utils/                   # AppError, money, dates, references,
│   │                            #   validators, whatsapp
│   └── modules/
│       ├── auth/ agents/        # registration, login, JWT
│       ├── products/            # catalogue
│       ├── customers/           # CRUD, ownership scoping, guarded delete
│       ├── eligibility/         # the rule engine
│       ├── quotations/          # lifecycle + premium calculation
│       ├── documents/           # PDF generation + signed public links
│       ├── payments/            # Stripe, webhook, idempotency
│       ├── policies/            # activation
│       ├── notifications/       # email provider abstraction + outbox
│       └── dashboard/           # aggregate counts
│
├── docs/                        # full system documentation
│   ├── architecture.md · system-flow.md
│   ├── api-design.md · database-design.md
│   ├── payment-idempotency.md · eligibility-rules.md
│   ├── technical-decisions.md · testing-strategy.md
│   ├── deployment.md            # Render, step by step
│   ├── deployment-overview.md   # both platforms, order of operations
│   └── diagrams/                # 7 Mermaid diagrams
│
├── scripts/check-env.mjs
├── render.yaml                  # Render Blueprint
├── .env.example
└── package.json
```

Each module owns its model, validators, service, controller and routes.
Controllers stay thin; all business logic lives in services; invariants are
enforced by database constraints rather than application checks.

All system documentation lives in [`docs/`](docs/) in this repository, because
the API is where the architecture, data model and business rules are. The client
repository documents the frontend and its Vercel deployment:
[Insurance-Agent-Platform-client](https://github.com/abnair715-png/Insurance-Agent-Platform-client).

## Technology stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18, TypeScript, React Router 6, Tailwind CSS, Vite | Specified; Vite for fast builds and a dev proxy that mirrors production's single origin |
| Backend | Node 20+, Express 4, TypeScript | Specified; Express 4 for predictable middleware behaviour |
| Database | MongoDB Atlas, Mongoose 8 | Specified; suits per-product rule documents and quotation snapshots |
| Auth | JWT — Bearer token from the SPA, httpOnly cookie also supported | Separate origins make a `SameSite` cookie undeliverable; trade-off documented below |
| Validation | zod | One schema gives both runtime validation and the TypeScript type |
| Payments | Stripe Checkout (test mode) | The session URL is a shareable link — exactly what WhatsApp delivery needs |
| PDF | PDFKit | Pure JS; no Chromium, so it fits a serverless function |
| Email | Resend, behind an `EmailProvider` interface | Swappable; falls back to a console provider with no key |
| Testing | Jest + Supertest + mongodb-memory-server; Vitest + RTL | Real MongoDB semantics on the backend; the standard Vite runner on the frontend |
| Hosting | **Vercel** (client, static) + **Render** (API, long-lived Node) | Each platform suited to its workload; the two deploy and roll back independently |

## System flow

> [docs/system-flow.md](docs/system-flow.md) ·
> [agent journey](docs/diagrams/agent-journey.md) ·
> [customer journey](docs/diagrams/customer-journey.md)

```
LOGIN → VIEW PRODUCTS → CREATE CUSTOMER → VIEW CUSTOMER
      → APPLICABLE PRODUCTS → SELECT PRODUCT → GENERATE PDF → OPEN PDF
      → SHARE VIA WHATSAPP → GENERATE PAYMENT LINK → SHARE PAYMENT LINK
      → STRIPE TEST PAYMENT → WEBHOOK → VERIFY → IDEMPOTENCY CHECK
      → ACTIVATE POLICY → SEND EMAIL → POLICY ACTIVE
```

The quotation detail screen renders this as a stepper, so the agent can see how
far a customer has got without reading a status field.

## Database design

> [docs/database-design.md](docs/database-design.md) ·
> [ERD](docs/diagrams/entity-relationships.md)

Nine collections: `agents`, `products`, `customers`, `quotations`, `documents`,
`payments`, `policies`, `notifications`, `webhook_events`.

Three conventions applied everywhere:

- **Money is an integer in minor units** (paise). No floating-point arithmetic in
  the money path, and Stripe expects minor units so there is no boundary
  conversion.
- **References for anything with its own lifecycle**, snapshots where history
  must not move. A quotation carries its own copy of the customer and product
  facts it was priced from.
- **`toJSON` is centralised**, mapping `_id` → `id` and stripping private fields,
  so no controller can leak a password hash by serialising a model.

Indexes that carry a guarantee rather than just performance:

| Index | Guarantee |
| --- | --- |
| `agents.email` unique | One account per email |
| `customers.(createdByAgent, email)` / `(createdByAgent, phone)` unique | No duplicates per agent — but two agents may serve the same person |
| `quotations.(customerId, productId)` unique **where `isOpen`** | One open quotation per customer/product |
| `payments.idempotencyKey` unique | One row per logical attempt |
| `payments.quotationId` unique **where `isOpen`** | One open payment attempt per quotation |
| `payments.quotationId` unique **where `status: SUCCEEDED`** | **At most one successful charge per quotation, ever** |
| `payments.stripeSessionId` unique sparse | Webhook lookup |
| `policies.paymentId` unique | **One policy per payment** |
| `policies.quotationId` unique | One policy per quotation |
| `notifications.(policyId, type)` unique | One confirmation email per policy |
| `webhook_events.eventId` unique | Duplicate Stripe deliveries are a no-op |

Also: `products.(active, category)`, `products.(name, category)` unique,
`customers.(createdByAgent, createdAt)`, a customer text index for search,
`quotations.reference` unique, `documents.reference` / `documents.quotationId`
unique, `policies.policyNumber` unique, and agent/customer-scoped listing indexes.

`autoIndex` is disabled in production; indexes are created by `npm run seed`.

## API overview

> Full reference with request/response shapes:
> [docs/api-design.md](docs/api-design.md)

```
POST   /api/auth/register            POST   /api/quotations
POST   /api/auth/login               GET    /api/quotations
POST   /api/auth/logout              GET    /api/quotations/:id
GET    /api/auth/me
                                     POST   /api/documents/:quotationId/generate
GET    /api/products                 GET    /api/documents/:quotationId
GET    /api/products/:id             GET    /api/documents/:quotationId/download
                                     GET    /api/documents/public/:reference   🔓
GET    /api/customers
POST   /api/customers                POST   /api/payments/create-link
GET    /api/customers/:id            GET    /api/payments/:id
PUT    /api/customers/:id            GET    /api/payments/by-quotation/:id
DELETE /api/customers/:id
GET    /api/customers/:id/eligible-products
                                     GET    /api/payments/public/status/:ref    🔓
GET    /api/policies                 POST   /api/webhooks/stripe                📝
GET    /api/policies/:id
                                     GET    /api/notifications
GET    /api/dashboard                POST   /api/notifications/retry-failed
GET    /api/health           🔓
```

🔓 public · 📝 Stripe signature required · everything else needs an agent session.

Every response uses one envelope:

```json
{ "success": true,  "data": { … }, "meta": { "page": 1, "total": 7 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…",
                               "details": [{ "field": "email", "message": "…" }] } }
```

## Authentication flow

```
POST /api/auth/register  →  zod validation  →  bcrypt hash (cost 10)
                         →  insert (unique index on email)
                         →  sign JWT  →  Set-Cookie: iap_session (httpOnly)

POST /api/auth/login     →  find by email  →  bcrypt compare
                         →  same message and comparable work whether the email
                            is unknown or the password is wrong
                         →  sign JWT  →  Set-Cookie

Protected request        →  requireAuth reads the cookie, or Authorization: Bearer
                         →  jwt.verify  →  req.agent = { id, email, name, role }
                         →  requireRole('AGENT','ADMIN') where declared
```

The token is **also** returned in the login/register response body so the API is
usable from curl, Postman and the test suite. Browsers ignore it and rely on the
cookie, which JavaScript cannot read.

`role` is never accepted from a client. Only `AGENT` is issued today; `ADMIN`
exists in the enum and the `requireRole` gate so adding it later is a one-line
change per route.

## Insurance eligibility logic

> [docs/eligibility-rules.md](docs/eligibility-rules.md)

`eligibilityService` is the **single** place that decides who may be offered
what. Rules live as data on each product; one pure evaluator interprets them.

```ts
buildCustomerProfile(customer)
  → { age, gender, annualIncome, ownsVehicle, vehicleType, vehicleValue,
      smoker, preExistingConditions }

evaluateEligibility(profile, product.eligibilityRules)
  → { eligible: boolean, failures: [{ rule, message }] }
```

Eleven rules: `MIN_AGE`, `MAX_AGE`, `MIN_ANNUAL_INCOME`, `MAX_ANNUAL_INCOME`,
`ALLOWED_GENDER`, `REQUIRES_VEHICLE`, `ALLOWED_VEHICLE_TYPE`,
`MIN_VEHICLE_VALUE`, `MAX_VEHICLE_VALUE`, `EXCLUDES_SMOKERS`,
`EXCLUDES_PRE_EXISTING`. An unconfigured rule is skipped, not failed, and **all**
failing rules are reported so the agent sees every reason at once.

The UI shows applicable products with a price, and not-applicable products with
their reasons — *"Minimum entry age is 55; the customer is 32."*

The check is re-run **server-side** when a quotation is created, so a crafted
request naming an ineligible product is a `422` and nothing is written.

### Premium

Base premium → vehicle value rating (with the catalogue price as a floor) → age
band multiplier → declared-risk loadings, summed **additively** rather than
compounded → rounded to whole currency units. Cover is capped at a configured
multiple of annual income for term products. Every step is recorded and shown.

Worked example — Daniel Fernandes, 45, smoker, Term Life Plus:

| Step | Calculation | Total |
| --- | --- | --- |
| Base premium | Term Life Plus | ₹11,400 |
| Age band adjustment | age 45 (band 41–50) × 1.6 | ₹18,240 |
| Declared risk loading | +45% (smoker) | ₹26,448 |

## PDF generation

PDFKit renders a one-page A4 quotation containing the company name, the
customer's name, contact details and location, the product and category, sum
assured, annual premium, the premium breakdown, key benefits, four stated
assumptions, the agent's name, the quotation reference, the generation date, and
the disclaimer:

> This document is for illustration/MVP purposes and does not constitute a final
> insurance contract.

Every value comes from the quotation. Nothing about the customer is hardcoded.

**No PDF bytes are stored.** The document record is metadata only; the file is
rendered on demand from the quotation's immutable snapshots, so the same
reference always produces the same document. This is what makes it work on
Vercel, where the filesystem is ephemeral and per-invocation.

Amounts appear as `INR 26,448.00` rather than `₹26,448` because PDFKit's built-in
fonts are WinAnsi-encoded and have no glyph for U+20B9. The UI shows the symbol.

## WhatsApp integration

The agent clicks **Share PDF via WhatsApp** or **Share payment link via
WhatsApp**. The browser opens:

```
https://wa.me/<digits>?text=<url-encoded message>
```

with the recipient and message pre-filled. **The agent presses send.**

> **This application does not send WhatsApp messages.** It builds click-to-chat
> deep links. No WhatsApp Business API account, Meta business verification or
> pre-approved message templates are required. The UI says so, not just this
> README.

Both share panels also expose the raw link with a copy button, so the flow works
even if WhatsApp is not installed on the agent's machine.

## Payment flow

> [docs/diagrams/payment-flow.md](docs/diagrams/payment-flow.md)

```
Agent clicks "Generate payment link"
   → POST /api/payments/create-link { quotationId }        ← the ONLY field
   → amount read from the stored quotation
   → payment row inserted under a partial unique index
   → Stripe Checkout Session created with the same idempotency key
   → paymentUrl + pre-filled WhatsApp link returned

Customer opens the link → pays with a test card → Stripe redirects back
   → the return page asks the SERVER for the status and polls

Stripe → POST /api/webhooks/stripe (signed)
   → verify signature over the raw bytes
   → claim the event in webhook_events
   → conditional transition CREATED|PENDING → SUCCEEDED
   → amount_total must equal the stored amount
   → insert the policy under a unique index on paymentId
   → quotation → CONVERTED
   → send the confirmation email (failures logged, never rethrown)
```

Three properties:

1. **No client ever supplies an amount.** A request such as `{"amount": 1}` has
   nothing to attach to — the endpoint accepts one field.
2. **The frontend cannot mark a payment successful.** There is no endpoint that
   would let it. Only a signature-verified webhook can.
3. **One logical payment produces one policy**, under every retry, replay and
   concurrency scenario.

## Idempotency strategy

> Full analysis, including every scenario and the tests that hold it up:
> [docs/payment-idempotency.md](docs/payment-idempotency.md) ·
> [diagram](docs/diagrams/idempotency-flow.md)

**The property:** one logical payment → one successful financial effect → one
active policy → one confirmation email.

| Layer | Mechanism | Stops |
| --- | --- | --- |
| 1 | Deterministic key `pay_<quotationRef>_<attempt>`, unique-indexed and sent to Stripe | Retries creating a second row or a second Stripe session |
| 2 | Partial unique index: one open payment per quotation; insert-first, read back the winner on duplicate key | Double-clicks and concurrent requests |
| 3 | Webhook signature verified over raw bytes | Forged activation requests |
| 4 | Unique index on `webhook_events.eventId`, with stale-claim takeover | Duplicate Stripe deliveries |
| 5 | Conditional `findOneAndUpdate` on open statuses | Replays and out-of-order events |
| 6 | Unique index on `policies.paymentId`; duplicate key ⇒ `created: false` | A second policy, under any concurrency |
| 7 | Unique index on `notifications.(policyId, type)` | A second confirmation email |

It rests on **none** of: a disabled button, in-memory state, Redis, a
distributed lock, or a read-then-write check.

> The concurrency test found a real bug during development. An earlier version
> derived the payment attempt number from a `countDocuments` call and relied on
> the key's uniqueness alone; under five concurrent requests the count advanced
> between reads and produced two payment rows. The fix was to put the constraint
> on the thing that must be unique — one *open payment per quotation* — as a
> partial index. That test is in the suite.

## Stripe test mode

Everything runs in Stripe **test mode**. No real money moves, and no business
verification or bank details are needed.

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |

Any future expiry, any CVC, any postcode.

Going live is a key swap plus a new webhook endpoint. No code changes.

## Webhook handling

`POST /api/webhooks/stripe` — mounted **outside** `requireAuth`, because Stripe
is the caller and its signature is the credential.

Handled events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`,
`checkout.session.async_payment_failed`, `payment_intent.payment_failed`.
Unknown types are acknowledged with `200` rather than retried forever.

| Situation | Response |
| --- | --- |
| Valid, first delivery | `200 { processed: true }` |
| Duplicate delivery | `200 { processed: false, reason: "duplicate_event_already_processed" }` |
| Invalid signature | `400`, nothing written |
| Amount mismatch | Payment `FAILED` (`amount_mismatch`), no policy, logged at error level |
| Processing threw | `5xx` so Stripe retries with backoff |

Signature verification needs the **exact** bytes Stripe signed. The JSON body
parser preserves the raw buffer, and the Vercel adapter disables the platform's
own body parsing and buffers the stream itself — a re-serialised body would not
verify.

## Email flow

After a policy is activated (and only when *this* delivery created it), the
customer is emailed: their name, policy number, product, sum assured, premium
paid, cover period and quotation reference.

The provider is behind an interface:

```ts
interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
```

`ResendEmailProvider` when `RESEND_API_KEY` is set, `ConsoleEmailProvider`
otherwise — so the whole flow stays demonstrable with no email account, and the
test suite is deterministic.

**Email is outside the money path.** A `notifications` row is written *before*
the provider is called, so a crash mid-send leaves an auditable record rather
than silence. Every failure is caught, recorded on that row with the error and
an attempt count, and **never rethrown** — a provider outage cannot fail the
webhook or undo an activation. Failed sends are visible at
`GET /api/notifications` and retryable via `POST /api/notifications/retry-failed`
(max 3 attempts).

It is `await`ed rather than fired and forgotten, because a serverless instance is
frozen the moment the response is returned.

## Error handling

One handler turns any thrown value into the response envelope.

| Status | Code | When |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Malformed request, bad enum, malformed ObjectId |
| `401` | `UNAUTHENTICATED` | Missing, invalid or expired session |
| `403` | `FORBIDDEN` | Wrong role; invalid or expired document link |
| `404` | `NOT_FOUND` | Absent — **or owned by another agent** |
| `409` | `CONFLICT` | Uniqueness or terminal-state violation |
| `422` | `BUSINESS_RULE_VIOLATION` | Well-formed but breaks a domain rule |
| `429` | `RATE_LIMITED` | Too many requests |
| `500` | `INTERNAL_ERROR` | Unexpected — message generic, details logged only |
| `503` | `SERVICE_UNAVAILABLE` | A dependency is not configured |

Another agent's record returns **404, not 403**: a 403 would confirm the record
exists. Stack traces are returned only outside production. Malformed ids are
rejected at the edge so Mongoose never throws a `CastError` mid-service.

On the client, every screen renders four states — loading, error (with a retry
action), empty, loaded — and forms surface server field errors against the right
inputs.

## Security considerations

| Control | Implementation |
| --- | --- |
| Password storage | bcrypt, cost 10. `select: false`, stripped by the `toJSON` transform |
| Session | JWT issued twice: an httpOnly `SameSite=Lax` cookie (used when same-origin) **and** a body token the SPA sends as `Authorization: Bearer` (used across origins) |
| XSS token theft | **A real residual risk in the split deployment.** The Bearer token lives in `localStorage`, so an XSS bug could exfiltrate it. See [Architecture trade-offs](#architecture-trade-offs) |
| CSRF | Bearer tokens are not sent automatically by the browser, so the cross-origin path is inherently CSRF-immune; the cookie path relies on `SameSite=Lax`, and no `GET` mutates state |
| CORS | Strict allow-list of `CLIENT_URL` plus `CORS_ADDITIONAL_ORIGINS`; an unknown origin is refused |
| User enumeration | Login returns one message and comparable work for unknown email and wrong password |
| Privilege escalation | `role` is never accepted from a client; validation strips unknown keys |
| Authorisation | Every query scoped by `createdByAgent`/`agentId`; cross-agent access is a 404 |
| Input validation | zod on body, query and params, before any logic |
| Price tampering | No endpoint accepts an amount; the charge is read from the stored quotation |
| Webhook forgery | Stripe signature verified over the raw bytes |
| Charge tampering | `session.amount_total` compared to the stored amount; mismatch blocks activation |
| Public document links | 256-bit HMAC-derived tokens, never stored, constant-time compared, expiring, revoked on regeneration |
| ReDoS | User input escaped before reaching any `$regex` |
| Rate limiting | 20 / 15 min on auth, 20 / min on payment links, 30 / min on public documents, 300 / min general |
| Headers | helmet; `x-powered-by` disabled |
| CORS | Explicit origin allow-list with credentials |
| Secrets | Environment variables only; `.env` is git-ignored; `.env.example` has placeholders |
| Information leakage | Generic 500s; no stack traces in production; PDFs served `private, no-store` |
| Logging | Request lines carry method, path, status, duration and agent id — never bodies, headers or cookies |

Honest gaps are listed under [Known limitations](#known-limitations).

## Testing

**208 tests: 124 backend, 84 frontend.** Strategy and rationale:
[docs/testing-strategy.md](docs/testing-strategy.md).

```bash
npm test              # both suites
npm run test:server   # Jest + Supertest + mongodb-memory-server
npm run test:client   # Vitest + React Testing Library
npm run test:server -- --coverage
npm run typecheck     # tsc --noEmit
npm run lint
```

The backend runs against a **real** in-memory MongoDB, not a mock, because the
idempotency guarantees are made of unique indexes, partial indexes and atomic
updates — mocking the database would test the mock. Stripe and the email
provider are stubbed at their boundaries; the Stripe double reproduces
idempotency-key behaviour so the key path is genuinely exercised.

Highlights:

- 5 concurrent `createPaymentLink` calls → **one** payment, **one** link
- the same webhook event delivered 3× → one policy, one email
- three *different* events for one session, concurrently → one policy, one email
- a crash after settling the payment → the next delivery completes activation
- a tampered amount → payment `FAILED`, no policy
- an email provider outage → payment and policy intact, failure recorded
- a customer is not eligible → `422`, no quotation written
- an agent cannot read another agent's customer, quotation or document
- a customer holding a policy or a live payment cannot be deleted
- the SPA sends its session as a Bearer token, so cross-origin auth works
- the payment return page does **not** claim success on the Stripe redirect alone
- a background poll never blanks the screen it is refreshing

## How to run

There are two ways to run this application: against the **deployed instance**
(nothing to install) or **locally**.

### Option A — use the deployed application

Open the live demo URL at the top of this README and sign in with the
[demo credentials](#demo-credentials). Nothing to install or configure; the
database is already seeded.

### Option B — run it locally

**Prerequisites:** Node 20+ (22 recommended), npm 9+, and MongoDB — either local
or an Atlas connection string.

```bash
# --- the API (this repository) ---
git clone https://github.com/abnair715-png/Insurance-Agent-Platform-server.git
cd Insurance-Agent-Platform-server
npm install

# Create .env with the keys from the Environment variables table below.
# At minimum:
#   MONGODB_URI
#   JWT_SECRET            (32+ chars)
#   DOCUMENT_LINK_SECRET  (32+ chars, different from JWT_SECRET)
#   SEED_AGENT_EMAIL
#   SEED_AGENT_PASSWORD
#
# Generate a secret:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

npm run check-env -- --seed   # confirms nothing required is missing
npm run seed                  # creates indexes, agent, products, customers
npm run dev                   # http://localhost:4000

# --- the client, in a second terminal ---
git clone https://github.com/abnair715-png/Insurance-Agent-Platform-client.git
cd Insurance-Agent-Platform-client
npm install
cp .env.example .env          # leave VITE_API_URL EMPTY locally
npm run dev                   # http://localhost:5173
```

Open <http://localhost:5173> and sign in with the credentials you chose.

Locally, Vite proxies `/api` to the Express process, so the browser stays on a
single origin. **Deployed, the two projects are on different origins** — which
is why the SPA authenticates with a Bearer token rather than a cookie, and why
the API needs `CLIENT_URL` set for CORS. See
[Architecture trade-offs](#architecture-trade-offs).

Locally the Vite dev server proxies `/api` to this API on port 4000, so the
browser stays on one origin — unlike production, where the two are on different
hosts.

Every other command:

| Command | What it does |
| --- | --- |
| `npm run dev` | Watch mode via `tsx`, on `:4000` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | Runs `dist/index.js` — exactly what Render executes |
| `npm test` | 124 tests against a real in-memory MongoDB |
| `npm run test:coverage` | Same, with coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Idempotent demo data + index creation |
| `npm run seed:reset` | Also clears quotations, payments, policies, notifications |
| `npm run check-env` | Reports which variables are set or missing — never their values |

The client repository has its own equivalents.

**Exercising Stripe locally** needs a tunnel, because Stripe cannot reach
`localhost`. Payments will not settle without one: the browser redirect back
from Checkout is never treated as proof of payment, so the policy is activated
only by the webhook.

```bash
stripe login
stripe listen --forward-to localhost:4000/api/webhooks/stripe
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET, restart the server
```

The signing secret printed by `stripe listen` is valid only while that session
is running, and is a **different value** from the one shown for a dashboard
webhook endpoint. If you would rather not install the CLI, test the payment leg
against the deployed instance instead, where Stripe posts to the public URL
directly — see [Push to GitHub, then deploy](#push-to-github-then-deploy).

## Environment variables

Every variable is listed in the table below. `.env.example` is deliberately not
committed, so this table is the single source of truth — copy the keys from it
into your own `.env`.

**The client has exactly one variable.** `VITE_API_URL` is inlined by Vite at
**build time**, so changing it on Vercel requires a redeploy — and no secret may
ever go in a `VITE_*` variable, because it ships to the browser in plain text.

**The server reads `server/.env` first, then a repo-root `.env` as a fallback.**
Precedence is *real environment* → `server/.env` → `../.env`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | yes | `development` \| `production` \| `test`. On Vercel this also makes npm skip devDependencies, which is why `vercel.json` pins `installCommand` to `npm install --include=dev` |
| `PORT` | no (4000) | Local API port; ignored on Vercel |
| `CLIENT_URL` | yes | Public origin **of the client deployment**. A single URL. Used for the CORS allow-list and Stripe's post-checkout redirects |
| `API_PUBLIC_URL` | when split | Public origin **of this API**. Used to build the public document links a customer opens from WhatsApp. Defaults to `CLIENT_URL`, which is correct only when both share an origin |
| `CORS_ADDITIONAL_ORIGINS` | no | Extra browser origins allowed through CORS, comma-separated — e.g. a Vercel preview build of the client |
| `MONGODB_URI` | yes | Connection string |
| `JWT_SECRET` | yes | Session signing key, 32+ chars |
| `JWT_EXPIRES_IN` | no (`12h`) | Session lifetime |
| `DOCUMENT_LINK_SECRET` | yes | HMAC key for public document links, 32+ chars, **different** from `JWT_SECRET` |
| `DOCUMENT_LINK_TTL_HOURS` | no (168) | Share-link lifetime |
| `STRIPE_SECRET_KEY` | for payments | `sk_test_…`. Without it, payment routes return 503 and the rest of the app works |
| `STRIPE_WEBHOOK_SECRET` | for payments | `whsec_…` for **this** endpoint |
| `STRIPE_CURRENCY` | no (`inr`) | ISO-4217, must match the quoted amounts |
| `RESEND_API_KEY` | no | `re_…`. Empty ⇒ emails are logged, not sent |
| `EMAIL_FROM` | no | `"Name <address@domain>"` — must be a verified sender |
| `COMPANY_NAME` | no | Shown on PDFs and emails |
| `COMPANY_SUPPORT_EMAIL` | no | Shown on PDFs and emails |
| `COMPANY_SUPPORT_PHONE` | no | Shown on PDFs and emails |
| `SEED_AGENT_NAME` | no | Demo agent name |
| `SEED_AGENT_EMAIL` | for seeding | **You choose this.** The seed will not run without it |
| `SEED_AGENT_PASSWORD` | for seeding | **You choose this**, 8+ chars. The seed never generates one |
| `SEED_AGENT_PHONE` | no | Demo agent phone |
| `SEED_CUSTOMER_EMAIL_OVERRIDE` | no | Points every seeded customer at one inbox you control, so demo confirmation emails are deliverable. Each gets a distinct plus-addressed alias (`you+ananya@…`), since customers are unique per (agent, email) |

No secret is committed. `.env` is git-ignored; `.env.example` contains
placeholders only.

`npm run check-env` reports which variables are set, missing or falling back to
a default — and whether the two secrets are long enough and distinct. It prints
only "set" or "missing", never a value. Add `--seed` to also require the demo
credentials.

## Seeding demo data

```bash
npm run seed                 # idempotent upsert — safe to re-run anywhere
npm run seed:reset           # also clears quotations, documents, payments,
                             # policies, notifications and webhook events
npm run seed:reset -- --yes  # required when resetting a REMOTE database
```

`--reset` deletes data, so it refuses to run against a non-local database
unless `--yes` is passed. A plain `npm run seed` only upserts and is safe
anywhere.

> **Which `.env` is used?** Precedence is *real environment* → `server/.env` →
> repo-root `.env`. The first source to set a variable wins, so an exported
> shell variable always overrides both files:
> `MONGODB_URI=mongodb://127.0.0.1:27017/scratch npm run seed`.

Creates: **1 agent** (credentials from your environment), **7 products** across
all four categories, and **4 customers** chosen to produce genuinely different
eligibility outcomes:

| Customer | Age | Income | Vehicle | Declarations | Demonstrates |
| --- | --- | --- | --- | --- | --- |
| Ananya Sharma | 32 | ₹12L | Car ₹9L | — | The headline case: 4 eligible products across term, health, vehicle and accident |
| Rahul Verma | 24 | ₹2.4L | Two-wheeler ₹1.1L | Smoker | Ineligibility with reasons — income below the term floor, wrong vehicle class |
| Meera Iyer | 61 | ₹6L | None | Pre-existing | A senior product qualifying where the standard health product excludes |
| Daniel Fernandes | 45 | ₹28L | Commercial ₹22L | Smoker | The smoker loading in the premium breakdown |

The seed also calls `syncIndexes()` on all nine collections — which is why
running it against a fresh production database is **required**, not optional.

It will **never invent a password**: it exits with an error if
`SEED_AGENT_EMAIL` or `SEED_AGENT_PASSWORD` is missing.

## Push to GitHub, then deploy

> Per-platform detail: [client/docs/deployment.md](https://github.com/abnair715-png/Insurance-Agent-Platform-client/blob/main/docs/deployment.md) ·
> [server/docs/deployment.md](docs/deployment-overview.md) ·
> [order of operations](docs/deployment-overview.md)

### Step 1 — push to GitHub

Keep **one repository**. Both platforms deploy a subdirectory via their *Root
Directory* setting, and a single repo is what an evaluator expects to review.

```bash
cd "insurance-agent-platform"

# Confirm no secrets are about to be committed — expect ONLY *.env.example
git status --short | grep -i env

git add -A
git commit -m "Insurance Agent Platform MVP"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git   # skip if already set
git push -u origin main
```

Before pushing, verify the working tree is clean:

```bash
npm run lint && npm run typecheck && npm test
```

<details>
<summary>If you would rather have two separate repositories</summary>

Only the paths change; nothing in the code does.

```bash
# API repo
cd server && git init && git add -A
git commit -m "Insurance Agent Platform API"
git remote add origin https://github.com/<you>/<repo>-api.git && git push -u origin main

# Client repo
cd ../client && git init && git add -A
git commit -m "Insurance Agent Platform client"
git remote add origin https://github.com/<you>/<repo>-client.git && git push -u origin main
```

Set **Root Directory** to the repository root on both platforms instead of
`server` / `client`. You lose shared `docs/` and a single review surface, which
is why one repo is recommended here.

</details>

### Step 2 — deploy the API to Render

**New → Web Service → connect this repository.** Leave Root Directory blank.

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

`--include=dev` is required: Render sets `NODE_ENV=production`, which makes npm
skip devDependencies — and TypeScript is one, so the build would fail with
`sh: tsc: not found`. **Never set `PORT` yourself**; Render injects it.

Add the environment variables from
[server/docs/deployment.md](docs/deployment-overview.md). Leave `CLIENT_URL` as
`http://localhost:5173` for now.

Deploy → note the URL as `<API_URL>` → set `API_PUBLIC_URL=<API_URL>` → redeploy.

```bash
curl <API_URL>/api/health
```

### Step 3 — deploy the client to Vercel

In the **client repository** ([Insurance-Agent-Platform-client](https://github.com/abnair715-png/Insurance-Agent-Platform-client)):
**Add New → Project**, framework preset **Vite**, Root Directory blank. One
environment variable:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `<API_URL>/api` — note the `/api` suffix |

Deploy → note the URL as `<CLIENT_URL>`.

### Step 4 — close the loop (easy to miss)

Back on **Render**, set `CLIENT_URL=<CLIENT_URL>` and redeploy the API.

**Skip this and the dashboard renders but loads nothing** — every request is
blocked by CORS.

### Step 5 — Stripe webhook

**Developers → Webhooks → Add endpoint** (test mode) at
`<API_URL>/api/webhooks/stripe`, with the five events listed above. Put the
signing secret in `STRIPE_WEBHOOK_SECRET` on Render and redeploy.

### Step 6 — seed the production database

Required, not optional: `autoIndex` is off in production, so this is what
creates the unique indexes the idempotency guarantees rest on.

```bash
cd server
cp .env.example .env      # MONGODB_URI + SEED_AGENT_EMAIL/PASSWORD
npm run check-env -- --seed
npm run seed
rm .env
```

### Step 7 — verify

Open `<CLIENT_URL>`, sign in, and walk the checklist below.

> **Render's free plan spins down** after ~15 minutes idle; the next request
> waits ~50s. Open `<API_URL>/api/health` shortly before a demo, or point a free
> uptime pinger at it. A Stripe webhook arriving during a spin-down times out and
> is **retried** — harmless, because the handler is idempotent.

### Manual verification checklist

- [ ] `GET /api/health` returns `{"success":true,…}`
- [ ] Sign up creates a new agent and lands on the dashboard
- [ ] Sign in with the demo credentials works
- [ ] Visiting `/customers` while signed out redirects to `/login`
- [ ] Products page lists 7 products with eligibility criteria
- [ ] Category filters refetch from the API
- [ ] Creating a customer with a bad email or a missing country code shows field errors
- [ ] Creating a valid customer lands on their profile
- [ ] Edit on a customer row opens the form without opening the profile
- [ ] Saving that edit returns to the customers table, not the profile
- [ ] Editing from a customer's profile returns to that profile
- [ ] Delete on a customer row asks for confirmation before doing anything
- [ ] Deleting a customer with no policy removes them and refreshes the list
- [ ] Deleting a customer who holds a policy is refused, with the reason shown
- [ ] Applicable products shows eligible products with prices
- [ ] "Show reasons" explains each not-applicable product
- [ ] Selecting a product creates a quotation with a premium breakdown
- [ ] Clicking select twice reuses the same quotation reference
- [ ] Generate PDF produces a document reference and a share link
- [ ] Open PDF shows the customer's own details, premium and disclaimer
- [ ] The share link opens the PDF in a private browser window (no login)
- [ ] Regenerating the document invalidates the previous share link
- [ ] Share PDF via WhatsApp opens `wa.me` with the message pre-filled
- [ ] Generate payment link returns a Stripe Checkout URL
- [ ] Clicking it again returns the **same** link (toast says "reused")
- [ ] The Checkout page shows the exact quoted premium
- [ ] Paying with `4242 4242 4242 4242` succeeds
- [ ] The return page says "confirming", then shows the policy number
- [ ] Stripe → Webhooks shows the delivery returned `200`
- [ ] The quotation page flips to Policy active without a manual refresh
- [ ] The policy appears on `/policies` and on the dashboard
- [ ] The confirmation email arrives (or appears in the function logs)
- [ ] Resending the event in Stripe creates **no** second policy or email
- [ ] `GET /api/notifications` shows one `SENT` row for the policy

## Third-party services

Five external services are used. All of them run in a free or test tier — this
application never touches live payment credentials or real money.

| Service | Mode / plan | Used for | Credential | Degrades to |
| --- | --- | --- | --- | --- |
| **MongoDB Atlas** | M0 free tier, shared cluster | All persistence | `MONGODB_URI` | Required — no fallback |
| **Stripe** | **Test mode only** | Checkout Sessions, webhooks | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payment routes return `503`; everything else works |
| **Resend** | Free tier (3,000/mo, 100/day) | Policy confirmation email | `RESEND_API_KEY`, `EMAIL_FROM` | Console provider — emails logged, not sent |
| **WhatsApp** | `wa.me` click-to-chat — **no API account** | Sharing documents and payment links | None | N/A — pure URL construction |
| **Vercel** | Hobby | Hosting the SPA + serverless API | None in code | N/A |

### Configuration detail

**MongoDB Atlas** — an M0 free-tier cluster. Network Access is set to
`0.0.0.0/0` because Vercel Hobby functions have no static egress IP, so the
database is protected by credentials and TLS rather than by network position.
`autoIndex` is disabled under `NODE_ENV=production`, which is why seeding a
fresh production database is required: it calls `syncIndexes()` and creates the
unique indexes the idempotency guarantees depend on.

**Stripe** — **test mode throughout**. Keys are `sk_test_…`; no live key exists
in any environment. Payments use hosted **Checkout Sessions** (no card data ever
reaches this server, so PCI scope stays with Stripe) and settlement is driven
entirely by the signature-verified webhook at `POST /api/webhooks/stripe`, never
by the browser redirect. Currency is configurable via `STRIPE_CURRENCY`
(default `inr`). Stripe is read lazily, so the API boots and serves every
non-payment route even when it is unconfigured. Going live would be a key swap
plus a new webhook endpoint — no code changes.

**Resend** — free tier, used only for the policy confirmation email. It sits
behind an `EmailProvider` interface with two implementations, selected at
runtime: `ResendEmailProvider` when `RESEND_API_KEY` is set, `ConsoleEmailProvider`
otherwise. Because the deployment uses Resend's shared `onboarding@resend.dev`
sender rather than a verified custom domain, Resend will only deliver to the
address that owns the Resend account; `SEED_CUSTOMER_EMAIL_OVERRIDE` points every
seeded customer at that inbox so the demo actually delivers mail. Email is
deliberately **outside the money path** — every failure is caught, recorded on
the `notifications` row, and never rethrown, so a provider outage cannot undo a
payment or a policy activation.

**WhatsApp** — no Business API account, no token, no cost. Sharing is
click-to-chat: the client builds a `https://wa.me/<phone>?text=<message>` URL
containing the signed public document link or the Stripe Checkout link, and the
user's own WhatsApp sends it. This is an explicit MVP trade-off — it needs no
approval process, but it cannot template, schedule or track delivery.

**Vercel** — Hobby plan, one project serving both the SPA and the API from a
single origin. `vercel.json` builds the client to `client/dist` and routes every
`/api/*` request to the catch-all serverless function at
`api/index.ts`, which wraps the same Express app that runs locally.
Functions are capped at `maxDuration` 30s, and the pdfkit font files are pulled
in via `includeFiles`.

## Demo credentials

These are the working agent credentials for the deployed application. They are
created by the seed script from `SEED_AGENT_EMAIL` and `SEED_AGENT_PASSWORD`.

```
URL:      https://insurance-agent-platform.vercel.app  
Email:    demo@sentinelinsurance.com
Password: seedagent@insurance
```

Signing in lands on the dashboard with four seeded customers and seven products
already in place, so the full journey — eligibility, quotation, PDF, WhatsApp
share, payment, policy activation — can be walked immediately.

**Stripe test cards** (test mode only, no real money):

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |

Any future expiry, any CVC, any postcode.

> These are demo-only credentials for a test-mode application. They are not
> reused for any other service. No credential is hardcoded in application code —
> the seed script reads them from the environment and **will not generate a
> password**, exiting with an error if they are unset.

## Known limitations

**Scope**

- One role (`AGENT`). `ADMIN` exists in the enum and the role gate but has no
  screens.
- No claims, renewals, endorsements, cancellations, refunds or commission.
- No customer login; customers only see the PDF, Checkout and the return page.
- One vehicle per customer; no fleet support.
- Eligibility rules are conjunctive — no "either A or B".
- No *refer to underwriter* outcome; eligibility is binary.
- Single currency per deployment.
- Policy term is fixed at 12 months for every product.
- Desktop-oriented, as specified. Usable on a tablet, not designed for phones.

**Technical**

- **The session token is readable by JavaScript.** Splitting the deployments
  forced the SPA onto a `localStorage` Bearer token, because a cross-site cookie
  is not delivered. An XSS bug could exfiltrate it. Mitigations in place: a
  strict CORS allow-list, a 12-hour expiry, React's default output escaping, and
  no `dangerouslySetInnerHTML` anywhere. Deploying both projects behind one
  domain (a Vercel rewrite, or a reverse proxy) would restore the httpOnly
  cookie without any application change — the server still issues and accepts it.
- **Two projects must be kept in step.** `VITE_API_URL` on the client and
  `CLIENT_URL` on the server point at each other; changing one URL without the
  other breaks the app with a CORS error rather than a clear message.

- **Rate limiting is per serverless instance.** The effective global limit is
  higher than configured and resets on cold starts. A shared store (Upstash
  Redis) is the fix — a store swap, no logic change.
- **No refresh tokens.** A stolen JWT is valid until it expires (12h); there is
  no server-side revocation.
- **Email retry is manual** — `POST /api/notifications/retry-failed`. The
  `notifications` collection is an outbox with a manual drain; a Vercel Cron job
  calling the same function is the production step.
- **Atlas allows `0.0.0.0/0`**, because Render's free plan has no static
  outbound IP.
  Protection is credentials and TLS, not network position.
- **PDFs re-render on every download** (~50 ms) rather than being cached.
- **The rupee glyph is absent from PDFs and emails**; amounts read `INR 26,448.00`
  there and `₹26,448` in the UI.
- **No end-to-end browser tests.** The webhook seam is covered by integration
  tests; the browser path is covered by the manual checklist.
- **Search uses `$regex`** (escaped), not Atlas Search — fine at this size,
  unindexed at scale.
- **Render's free plan spins down** after ~15 minutes idle, so the first request
  afterwards waits ~50s. A Stripe webhook arriving then is retried, which the
  idempotent handler absorbs, but a live demo needs the service warmed first.

## Future improvements

**Next, in order**

1. Vercel Cron draining failed notifications, replacing the manual retry.
2. Distributed rate limiting via Upstash Redis.
3. Refresh-token rotation with server-side revocation.
4. Playwright end-to-end test covering login → quote → PDF → pay → active.
5. Admin role: product management UI, cross-agent reporting.

**Then**

6. Renewals and a policy-anniversary re-rating job.
7. *Refer to underwriter* as a third eligibility outcome.
8. Multi-currency, with the currency resolved per product.
9. WhatsApp Business API behind a `WhatsAppProvider` interface, keeping
   click-to-chat as the fallback.
10. Object storage for generated PDFs, with a signed URL on the document record.
11. Structured audit log of every state transition.
12. Atlas Search for customer search.
13. Observability: OpenTelemetry traces, Sentry, a dashboard for webhook
    processing lag.

## Architecture trade-offs

Every decision below is argued in full — including what it costs and what it
would take to change — in
[docs/technical-decisions.md](docs/technical-decisions.md).

| Question | Answer in one line |
| --- | --- |
| **Why a modular monolith?** | Microservices buy independent deployment and scaling; neither is a constraint here, and they would fragment the payment→policy→email guarantee across a network |
| **Why MongoDB?** | Per-product rule documents and quotation snapshots fit a document model; every invariant this system needs is single-document, which MongoDB guarantees natively |
| **Why no transactions?** | The payment→policy sequence is already safe via a conditional update plus a unique index, and a crash mid-way is recovered by the next Stripe retry — a tested path |
| **Why Stripe test mode?** | Full API fidelity with no real money and no business verification; going live is a key swap |
| **Why Stripe Checkout, not Elements?** | The session URL is a *link*, which is exactly what WhatsApp delivery needs, and card data never touches our servers |
| **Why WhatsApp click-to-chat?** | The Business API needs Meta verification and approved templates — days of onboarding to demonstrate a flow. Only `utils/whatsapp.ts` changes later |
| **Why PDFKit, not headless Chrome?** | A ~300 MB Chromium binary does not fit a serverless function; the cost is imperative layout |
| **Why not store PDFs?** | Serverless storage is ephemeral, and regenerating from an immutable quotation is deterministic — so storage buys nothing |
| **Why an httpOnly cookie?** | JavaScript cannot read it, so XSS cannot steal the session. Same origin plus `SameSite=Lax` covers CSRF |
| **Why two Vercel projects?** | The client and API deploy, roll back and scale independently, and each has its own build. The cost is real: cross-origin auth, a CORS allow-list, a build-time API URL, and two sets of variables to keep in step |
| **Why a Bearer token, not the httpOnly cookie?** | Across origins a `SameSite=Lax` cookie is not sent at all, and `SameSite=None` is blocked by Safari's ITP and Chrome's third-party cookie restrictions. The token in `localStorage` is readable by JavaScript — an accepted XSS trade-off, taken deliberately and documented |
| **Why REST, not GraphQL?** | One known client with predictable payloads; GraphQL's benefits do not apply while its costs do |
| **Why abstract email but not payments?** | Email providers are genuinely interchangeable behind `send()`. Payment providers are not — a `PaymentProvider` interface would either leak Stripe's model or hide the guarantees that matter |
| **Why rules as data?** | Launching a product becomes a database change, and the criteria shown in the UI come from the same source the engine reads |
| **Why integer minor units?** | No floating-point arithmetic in the money path, and Stripe expects minor units anyway |
| **Why Vitest on the client?** | Jest on Vite + ESM + `import.meta.env` needs transform overrides and is slower; Vitest is Jest-compatible and shares the Vite config. Jest is used on the backend as specified |

---

## Documentation

| Document | Contents |
| --- | --- |
| **System-wide** | |
| [docs/architecture.md](docs/architecture.md) | Layers, request path, module structure, frontend architecture |
| [docs/system-flow.md](docs/system-flow.md) | The demo path step by step, plus failure paths |
| [docs/technical-decisions.md](docs/technical-decisions.md) | Every trade-off, argued |
| [docs/testing-strategy.md](docs/testing-strategy.md) | What is tested, what is not, and why |
| [docs/deployment.md](docs/deployment-overview.md) | Deployment overview and order of operations |
| [docs/diagrams/](docs/diagrams/) | 7 Mermaid diagrams |
| **API — `server/`** | |
| [server/README.md](#readme) | Running, commands, layout |
| [server/docs/api-design.md](docs/api-design.md) | Full endpoint reference, envelopes, status codes |
| [server/docs/database-design.md](docs/database-design.md) | Every collection, every index and why it exists |
| [server/docs/payment-idempotency.md](docs/payment-idempotency.md) | All seven layers, every scenario, the tests |
| [server/docs/eligibility-rules.md](docs/eligibility-rules.md) | Rule vocabulary, assumptions, premium calculation |
| [server/docs/deployment.md](docs/deployment-overview.md) | **Render** deployment, with troubleshooting |
| **Client — `client/`** | |
| [client/README.md](https://github.com/abnair715-png/Insurance-Agent-Platform-client#readme) | Running, commands, layout |
| [client/docs/deployment.md](https://github.com/abnair715-png/Insurance-Agent-Platform-client/blob/main/docs/deployment.md) | **Vercel** deployment, with troubleshooting |

## Licence

Written as an interview assignment. Not licensed for production use.
