# System flow

> Diagrams: [agent journey](diagrams/agent-journey.md) ·
> [customer journey](diagrams/customer-journey.md) ·
> [payment flow](diagrams/payment-flow.md)

The complete demo path, with what happens on the server at each step.

## 1. Sign in

`POST /api/auth/login` → bcrypt compare → JWT signed → httpOnly cookie set.

A wrong password and an unknown email return the **same** message after
comparable work, so the endpoint cannot be used to enumerate registered
addresses.

## 2. View products

`GET /api/products` → active products from MongoDB, ordered by category.

Nothing about the catalogue is hardcoded in the frontend. The eligibility
criteria shown on each card are rendered from the product's stored
`eligibilityRules`.

## 3. Create a customer

`POST /api/customers` → zod validation → `createdByAgent` stamped from the
session → insert.

Unique indexes on `(createdByAgent, email)` and `(createdByAgent, phone)` make a
duplicate a 409. If `vehicle.owns` is false, vehicle details are dropped so the
eligibility engine never sees contradictory facts.

## 4. Applicable products

`GET /api/customers/:id/eligible-products`:

1. Load the customer (scoped to the agent) and all active products.
2. `buildCustomerProfile` derives age, income, vehicle and declarations.
3. For each product, `evaluateEligibility` returns eligible/failures.
4. For eligible products only, `calculatePremium` produces the price.

Ineligible products come back with their reasons, so the agent can tell the
customer *why* something is not on the table.

## 5. Select a product

`POST /api/quotations { customerId, productId }`:

1. Ownership check on the customer; the product must be active.
2. **Eligibility is re-checked server-side** — the UI hiding a product is not a
   control. Ineligible ⇒ `422`.
3. `calculatePremium` produces the premium, cover and breakdown.
4. If an open quotation already exists for this pair it is returned (re-priced
   if the customer's details changed); otherwise one is created with a
   `QTN-YYYY-XXXXXXXX` reference.
5. Customer, product and eligibility facts are **snapshotted** onto it.

## 6. Generate the PDF

`POST /api/documents/:quotationId/generate`:

1. Upsert the document record on `quotationId` (unique index ⇒ one per
   quotation), `$inc` the `version`.
2. Advance the quotation to `DOCUMENT_GENERATED`.
3. Derive the share token as `HMAC(secret, "<reference>:<version>")` and return
   `shareUrl` plus a pre-filled `whatsAppUrl`.

The PDF itself is rendered on demand by PDFKit from the quotation's snapshots —
no bytes are stored anywhere. Regenerating bumps `version`, which invalidates
every previously shared link.

## 7. Share on WhatsApp

The agent clicks "Share PDF via WhatsApp". The browser opens
`https://wa.me/<digits>?text=<message>` with the recipient and message
pre-filled. **The agent presses send.** The application does not send WhatsApp
messages and does not need a WhatsApp Business API account.

## 8. Customer opens the PDF

`GET /api/documents/public/DOC-…?t=<token>` — unauthenticated. Three checks:
the reference exists, the token matches the current version in constant time,
and the link has not expired. Then the PDF is rendered fresh.

## 9. Generate a payment link

`POST /api/payments/create-link { quotationId }`:

Expiry check → already-paid check (`409`) → reuse an open link if one is live →
otherwise insert a payment row under the partial unique index, create a Stripe
Checkout Session with the same idempotency key, and store the URL.

The charged amount is `quotation.premiumAmount`. Nothing about money comes from
the request.

## 10. Customer pays

Stripe Checkout, test mode. Card `4242 4242 4242 4242`, any future expiry, any
CVC. Stripe redirects to `/payment/success?ref=QTN-…`.

That redirect is **not** treated as proof of payment. The page asks
`GET /api/payments/public/status/:reference` and polls until the server reports
the payment settled.

## 11. Webhook

`POST /api/webhooks/stripe`:

1. Verify the signature over the raw bytes — else `400`, nothing written.
2. Claim the event in `webhook_events` — duplicate ⇒ acknowledge and stop.
3. Resolve our payment by session id, falling back to session metadata.
4. Check `session.amount_total` equals the stored amount — mismatch ⇒ mark
   `FAILED`, activate nothing, log it.
5. Conditionally transition `CREATED|PENDING → SUCCEEDED`.
6. Insert the policy, guarded by a unique index on `paymentId` ⇒ exactly one.
7. Advance the quotation to `CONVERTED`.
8. If (and only if) this delivery created the policy, send the confirmation
   email.

Full analysis: [payment-idempotency.md](payment-idempotency.md).

## 12. Policy active, email sent

The policy carries a `POL-YYYY-XXXXXXXX` number, a 12-month cover period from
the payment date, and the premium actually paid.

The email is attempted after activation, inside a try/catch that records the
outcome on a `notifications` row. A provider failure is logged as `FAILED` and
never propagates — the payment and policy stand regardless.

The agent's quotation page is polling while a payment is outstanding, so it
flips to "Policy active" without a manual refresh.

## Failure paths

| What goes wrong | What the system does |
| --- | --- |
| Customer abandons checkout | Payment stays `PENDING`; the same link is reused |
| Checkout session expires | `checkout.session.expired` → `EXPIRED`; agent can create attempt 2 |
| Card declined | `payment_intent.payment_failed` → `FAILED` with the reason |
| Charged amount ≠ quoted | Payment `FAILED` (`amount_mismatch`); no policy; logged at error level |
| Webhook delivered twice | Second delivery acknowledged, no effect |
| Server dies mid-webhook | Stripe retries; the handler completes the missing step |
| Email provider down | Policy active; notification row `FAILED`; retryable |
| Stripe not configured | `503` with a clear message; every other route still works |
| MongoDB unreachable | Connection promise cleared so the next request retries rather than resolving to a permanently rejected promise |
