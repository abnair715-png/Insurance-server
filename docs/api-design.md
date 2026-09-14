# API design

REST over JSON. Base path `/api`. Same origin as the SPA in every environment.

## Response envelope

Success:

```json
{ "success": true, "data": { "...": "..." }, "meta": { "page": 1, "limit": 20, "total": 7, "totalPages": 1 } }
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "field": "email", "message": "Must be a valid email address." }]
  }
}
```

`meta` appears only on paginated collections. `details` appears only when
individual fields failed. One shape everywhere means the React API client has a
single unwrap path and a single error type.

## Status codes

| Code | Meaning | Example |
| --- | --- | --- |
| `200` | Success | `GET /api/products`; also a reused payment link |
| `201` | Created | New customer, quotation, document, payment |
| `204` | No content | — |
| `400` `VALIDATION_ERROR` | Malformed request | Bad email, malformed ObjectId, invalid enum |
| `401` `UNAUTHENTICATED` | Missing, invalid or expired session | No cookie and no Bearer token |
| `403` `FORBIDDEN` | Authenticated but not permitted | Wrong role; invalid document link token |
| `404` `NOT_FOUND` | Absent, **or owned by another agent** | Someone else's customer |
| `409` `CONFLICT` | Uniqueness or terminal-state violation | Duplicate email; quotation already paid |
| `422` `BUSINESS_RULE_VIOLATION` | Well-formed but breaks a domain rule | Quoting an ineligible product; expired quotation |
| `429` `RATE_LIMITED` | Too many requests | Repeated login attempts |
| `500` `INTERNAL_ERROR` | Unexpected | Message is generic; details are logged only |
| `503` `SERVICE_UNAVAILABLE` | A dependency is not configured | `STRIPE_SECRET_KEY` unset |

**Another agent's record is a 404, not a 403.** A 403 would confirm the record
exists, which leaks information across agents.

## Authentication

`POST /api/auth/login` sets an **httpOnly, SameSite=Lax** cookie (`iap_session`,
`Secure` in production) and *also* returns the JWT in the body. Browsers use the
cookie and ignore the token; scripts, curl and the test suite send
`Authorization: Bearer <token>`. The middleware accepts either.

```bash
# cookie (what the SPA does)
curl -c jar.txt -X POST https://<host>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'
curl -b jar.txt https://<host>/api/auth/me

# bearer
TOKEN=$(curl -s -X POST https://<host>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}' | jq -r .data.token)
curl -H "Authorization: Bearer $TOKEN" https://<host>/api/products
```

---

## Endpoints

Legend: 🔓 public · 🔒 agent session required · 📝 Stripe signature required

### Auth

| Method | Path | | Body | Returns |
| --- | --- | --- | --- | --- |
| `POST` | `/api/auth/register` | 🔓 | `name`, `email`, `password`, `phone` | `201 { agent, token }` |
| `POST` | `/api/auth/login` | 🔓 | `email`, `password` | `200 { agent, token }` |
| `POST` | `/api/auth/logout` | 🔓 | — | `200 { message }` |
| `GET` | `/api/auth/me` | 🔒 | — | `200 { agent }` |

`role` is **not** accepted on register. Validation replaces the body with the
parse result, so an injected `"role": "ADMIN"` is stripped before the service
sees it.

Register and login are rate limited to 20 requests per 15 minutes.

### Products

| Method | Path | | Query | Returns |
| --- | --- | --- | --- | --- |
| `GET` | `/api/products` | 🔒 | `category`, `search`, `includeInactive`, `page`, `limit` | `200 { products } + meta` |
| `GET` | `/api/products/:id` | 🔒 | — | `200 { product }` |

Inactive products are hidden unless `includeInactive=true`. `search` is escaped
before reaching `$regex`, so a crafted term cannot become a catastrophic
backtracking DoS.

### Customers

| Method | Path | | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/customers` | 🔒 | `search`, `page`, `limit`; scoped to the calling agent |
| `POST` | `/api/customers` | 🔒 | `201 { customer }`; `409` on duplicate email/phone for this agent |
| `GET` | `/api/customers/:id` | 🔒 | `404` if owned by another agent |
| `PUT` | `/api/customers/:id` | 🔒 | Partial update; clearing `vehicle.owns` clears the vehicle |
| `DELETE` | `/api/customers/:id` | 🔒 | Cascading delete; `409` when the customer has a policy or a live payment |
| `GET` | `/api/customers/:id/eligible-products` | 🔒 | The eligibility result |

Money fields (`annualIncome`, `vehicle.value`) are integers in **minor units**.

`GET /api/customers/:id/eligible-products` returns:

```json
{
  "success": true,
  "data": {
    "profile": { "age": 32, "annualIncome": 120000000, "ownsVehicle": true, "...": "..." },
    "eligible": [
      {
        "product": { "id": "...", "name": "Term Life Plus", "...": "..." },
        "eligible": true,
        "failures": [],
        "quote": { "premiumAmount": 969000, "coverageAmount": 1000000000 }
      }
    ],
    "ineligible": [
      {
        "product": { "id": "...", "name": "Senior Health Protect", "...": "..." },
        "eligible": false,
        "failures": [
          { "rule": "MIN_AGE", "message": "Minimum entry age is 55; the customer is 32." }
        ]
      }
    ]
  }
}
```

`quote` is present only on eligible entries — an ineligible product has no
meaningful price, and quoting one would mislead.

`DELETE /api/customers/:id` removes the customer, their quotations, the document
records for those quotations, and any dead payment attempts:

```json
{ "success": true,
  "data": { "deleted": true, "deletedQuotations": 2, "deletedDocuments": 1, "deletedPayments": 0 } }
```

It refuses with `409` when anything financial has happened to the customer:

| Condition | Message |
| --- | --- |
| Any policy exists | "… has 1 policy on record and cannot be deleted. Policies are financial records and must be retained." |
| A `SUCCEEDED` payment | "… has a payment in progress or already paid. Wait for it to complete or expire before deleting this customer." |
| A `CREATED`/`PENDING` payment | Same — a live Stripe checkout link is still in the customer's hands |

Deleting the document records is what stops a previously shared PDF link from
resolving. `FAILED` and `EXPIRED` payments are abandoned attempts where no money
moved, so they are removed with the customer rather than blocking the delete.

### Quotations

| Method | Path | | Body | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/api/quotations` | 🔒 | `customerId`, `productId` | Idempotent; `422` if ineligible |
| `GET` | `/api/quotations` | 🔒 | — | `customerId`, `page`, `limit` |
| `GET` | `/api/quotations/:id` | 🔒 | — | |

**Only two fields are accepted.** No premium, no coverage, no currency — all are
derived server-side. Re-posting the same pair returns the existing open
quotation rather than creating a second one, and re-prices it if the customer's
details have changed since.

### Documents

| Method | Path | | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/documents/:quotationId/generate` | 🔒 | `201 { document, shareUrl, whatsAppUrl, expiresAt }`; bumps `version`, revoking earlier links |
| `GET` | `/api/documents/:quotationId` | 🔒 | Same shape, without rotating the link |
| `GET` | `/api/documents/:quotationId/download` | 🔒 | `application/pdf`, `Cache-Control: private, no-store` |
| `GET` | `/api/documents/public/:reference?t=<token>` | 🔓 | The link the customer opens from WhatsApp |

The public route is mounted **before** `requireAuth`. Authorisation is the HMAC
token, compared in constant time, plus an expiry check. Rate limited to 30
requests per minute.

### Payments

| Method | Path | | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/payments/create-link` | 🔒 | Body: `{ quotationId }` **only**. `201` new, `200` `{reused:true}` existing, `409` already paid |
| `GET` | `/api/payments/:id` | 🔒 | `{ payment, policy }` |
| `GET` | `/api/payments/by-quotation/:quotationId` | 🔒 | All attempts, newest first |
| `GET` | `/api/payments/public/status/:reference` | 🔓 | The customer's return page |
| `POST` | `/api/webhooks/stripe` | 📝 | Signature-verified; never behind `requireAuth` |

`create-link` is rate limited to 20 requests per minute.

The public status endpoint exposes only what the customer already knows — their
own reference, the product, the amount, whether cover has started — and never
the agent's details or any other customer's data.

### Policies

| Method | Path | | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/policies` | 🔒 | `customerId`, `page`, `limit` |
| `GET` | `/api/policies/:id` | 🔒 | |

There is **no** endpoint that creates or activates a policy. Activation happens
only inside the webhook handler.

### Notifications and dashboard

| Method | Path | | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/notifications` | 🔒 | Delivery log for this agent's policies |
| `POST` | `/api/notifications/retry-failed` | 🔒 | Re-attempts `FAILED` sends (max 3 attempts each) |
| `GET` | `/api/dashboard` | 🔒 | Summary counts + recent policies and customers |
| `GET` | `/api/health` | 🔓 | Liveness |

---

## Design rules applied throughout

1. **Never trust a price from a client.** No mutating endpoint accepts an
   amount. `POST /api/payments/create-link` takes a quotation id and nothing
   else.
2. **Validation precedes logic.** `validate()` runs before every controller, and
   the parse result replaces the raw value — which also strips unknown keys, so
   a client cannot smuggle an extra field into a create call.
3. **Ownership is a query filter, not an `if`.** Services build filters that
   include `createdByAgent`/`agentId`, so an unauthorised id simply matches
   nothing.
4. **Malformed ids are 400, not 500.** `objectIdSchema` rejects them at the edge
   so Mongoose never throws a `CastError` mid-service.
5. **Idempotent writes return the existing resource** rather than erroring, with
   a status code that says which path was taken.

## Why REST rather than GraphQL

The client is one known consumer with a small, stable set of screens, each
needing a predictable payload. GraphQL's advantages — client-specified shapes,
avoiding over-fetching across many consumers — do not apply, while its costs do:
schema and resolver layers, N+1 risk, query-depth limiting, and a less obvious
place to hang per-endpoint rate limits and idempotency semantics. REST also
makes the webhook endpoint, which must be a plain signed POST, entirely ordinary.
