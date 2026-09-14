# Payment flow

```mermaid
sequenceDiagram
    autonumber
    actor A as Agent
    participant UI as React dashboard
    participant API as Express API
    participant DB as MongoDB
    participant S as Stripe
    actor C as Customer
    participant E as Resend

    A->>UI: "Generate payment link"
    UI->>API: POST /api/payments/create-link { quotationId }
    Note right of API: No amount in the request body

    API->>DB: load quotation (scoped to this agent)
    API->>DB: any SUCCEEDED payment for it?
    alt already paid
        API-->>UI: 409 CONFLICT
    end
    API->>DB: any OPEN payment with a live checkout URL?
    alt link already exists
        API-->>UI: 200 { reused: true, same paymentUrl }
    end

    API->>DB: insert payment {status: CREATED, isOpen: true,<br/>idempotencyKey: pay_<ref>_<attempt>, amount: quotation.premiumAmount}
    Note right of DB: unique index on (quotationId) where isOpen<br/>lets exactly one insert through
    API->>S: checkout.sessions.create(…, {idempotencyKey})
    S-->>API: session { id, url, expires_at }
    API->>DB: payment → PENDING + stripeSessionId + checkoutUrl
    API->>DB: quotation → PAYMENT_PENDING
    API-->>UI: 201 { paymentUrl, whatsAppUrl }

    A->>C: shares the link over WhatsApp (click-to-chat)
    C->>S: pays with a test card
    S-->>C: redirect to /payment/success?ref=…

    par Webhook is the source of truth
        S->>API: POST /api/webhooks/stripe (signed)
        API->>API: constructEvent(rawBody, signature, secret)
        API->>DB: insert webhook_events {eventId} — duplicate ⇒ stop
        API->>DB: payment: CREATED|PENDING → SUCCEEDED (conditional)
        API->>API: amount_total must equal payment.amount
        API->>DB: upsert policy on paymentId ⇒ exactly one
        API->>DB: quotation → CONVERTED
        API->>E: send confirmation email
        E-->>API: message id (failures logged, never rethrown)
        API-->>S: 200 OK
    and Customer's page polls
        C->>API: GET /api/payments/public/status/QTN-…
        API-->>C: policy number + ACTIVE once settled
    end
```

## The three guarantees

1. **The amount is never supplied by a client.** `POST /api/payments/create-link`
   accepts one field, `quotationId`. The charge is read from the stored
   quotation, which was itself priced by `premiumService` from stored product
   and customer records.
2. **The frontend never marks a payment successful.** It has no endpoint that
   could. Only a signature-verified Stripe webhook can move a payment to
   `SUCCEEDED`.
3. **One logical payment produces one policy.** See
   [idempotency-flow.md](idempotency-flow.md).
