# Architecture

> Diagram: [diagrams/high-level-architecture.md](diagrams/high-level-architecture.md)

## Shape

A **modular monolith**: one deployable unit, split internally into modules that
own their own model, validators, service, controller and routes.

```
server/src/
├── app.ts                    # Express factory — no listen()
├── index.ts                  # process entry point (what Render runs)
├── config/                   # env (zod-validated), constants, logger
├── db/                       # connection (serverless-safe), plugins, seed
├── middleware/               # auth, validate, errorHandler, bodyParser, rateLimiter
├── routes/index.ts           # mounts every module under /api
├── utils/                    # AppError, money, dates, references, validators, whatsapp
└── modules/
    ├── agents/               # agent model
    ├── auth/                 # register, login, logout, me, JWT/cookie handling
    ├── products/             # catalogue
    ├── customers/            # CRUD + eligible-products
    ├── eligibility/          # the rule engine (no HTTP surface of its own)
    ├── quotations/           # quotation lifecycle + premium calculation
    ├── documents/            # PDF generation + public share links
    ├── payments/             # Stripe, webhook, idempotency
    ├── policies/             # activation, listing
    ├── notifications/        # email provider abstraction + outbox
    └── dashboard/            # aggregate counts
```

## Request path

```
HTTP request
  → helmet / CORS / cookie parser
  → JSON body parser (preserves raw bytes for webhook signatures)
  → request logger
  → rate limiter
  → database connection (cached promise)
  → route
      → requireAuth / requireRole        (authorisation)
      → validate({ body, query, params }) (zod — runs BEFORE any logic)
      → controller                        (thin: translate HTTP ↔ domain)
      → service                           (all business rules)
      → model / external service
  → response envelope
  → centralised error handler (on any throw)
```

Two properties are worth stating explicitly because they are what keep the
layering honest:

- **Controllers contain no `if`s about the domain.** They read `req`, call one
  service function, and pass the result to `sendSuccess`. The auth controller is
  the longest at 35 lines.
- **Services never touch `req` or `res`.** They take plain arguments and throw
  `AppError`. That is why the eligibility engine can be unit-tested against
  plain objects with no HTTP or database involved.

## Two deployable repositories

The client and the API are **separate repositories**, each a standalone npm
project. Neither imports from the other; the only contract between them is the
HTTP API and the three URLs in
[deployment-overview.md](deployment-overview.md).

- API — this repository
- Client — [Insurance-Agent-Platform-client](https://github.com/abnair715-png/Insurance-Agent-Platform-client)

## One application, two consumers

`createApp()` builds the Express app and returns it without listening.


- `api/index.ts` passes the Vercel `(req, res)` pair straight to the same
  app — an Express application already *is* a Node request handler.
- The test suite hands the same app to Supertest.

There is therefore no deployment-specific variant of the API that could behave
differently from the one covered by tests.

## Where each concern lives

| Concern | Location | Note |
| --- | --- | --- |
| Who may call this endpoint | `middleware/auth.ts` | JWT from cookie or Bearer — the SPA uses Bearer, since it is cross-origin |
| Who may see this record | inside each service | every query filtered by `createdByAgent` / `agentId` |
| Is this input well-formed | `middleware/validate.ts` + `*.validators.ts` | parse result replaces the body, stripping unknown keys |
| Is this allowed by the business | service layer | throws `AppError.businessRule` → 422 |
| Is this state transition legal | MongoDB conditional updates + unique indexes | not application-level checks |
| What the customer is charged | `premiumService` → quotation → payment | never from a request body |

## Error handling

One handler (`middleware/errorHandler.ts`) turns any thrown value into the
response envelope. It recognises `AppError`, `ZodError`, Mongoose validation and
cast errors, and MongoDB duplicate-key errors; anything else becomes a generic
500 whose message is logged but not returned. Stack traces are included only
outside production.

See [api-design.md](api-design.md) for the status-code contract.

## Frontend architecture

```
client/src/
├── App.tsx                 # routes: public auth · public customer · protected dashboard
├── components/
│   ├── ui/                 # Button, Card, Badge, Field, DataTable, Alert, …
│   └── layout/             # AppLayout, PageHeader, ProtectedRoute
├── features/               # cross-page domain UI (CustomerForm, EligibleProducts, …)
├── pages/                  # one file per screen
├── hooks/                  # useAuth, useAsync, useToast
├── services/               # apiClient + one typed function per endpoint
├── types/api.ts            # the API contract
└── utils/                  # formatting, class names
```

Deliberate choices:

- **No data-fetching library.** `useAsync` is 40 lines and gives every screen the
  same four states (loading, error, empty, loaded) with abort-on-unmount. React
  Query would be the right call once caching, background refetch or optimistic
  updates are needed; at this size it is a dependency that earns nothing.
- **No global store.** Only the session is global (`AuthProvider`). Everything
  else is server state fetched by the screen that shows it.
- **One HTTP entry point.** `apiClient.ts` owns the base URL, the credentials
  mode, the response envelope and the 401 hook, so a session expiring logs the
  user out from one place rather than from every caller.
- **Money is never arithmetic in a component.** Amounts arrive as integers in
  minor units and pass through `utils/format.ts`.

## What this architecture is not

It is not microservices, not event-driven, and has no message queue. Those are
the right answers to problems this system does not have: independent scaling of
one module, independent deployment by separate teams, or work that must survive
a process restart mid-flight. The reasoning is in
[technical-decisions.md](technical-decisions.md).
