# Customer journey

The customer never signs in and never sees the dashboard. They interact with
exactly three things: a WhatsApp message, a PDF, and Stripe Checkout.

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant WA as WhatsApp
    participant API as Insurance API
    participant S as Stripe Checkout
    participant M as Inbox

    Note over C,WA: The agent presses send in their own WhatsApp
    WA->>C: "Here is your personalised quotation …link"
    C->>API: GET /api/documents/public/DOC-…?t=<HMAC token>
    API->>API: verify token (constant time) + expiry
    API-->>C: PDF rendered on demand from the quotation
    Note over C: Reviews cover, premium, benefits, disclaimer

    WA->>C: "Complete your payment here …link"
    C->>S: Opens Stripe Checkout (test mode)
    C->>S: Pays with a test card
    S-->>C: Redirects to /payment/success?ref=QTN-…

    Note over C,API: The redirect proves nothing — the page asks the server
    C->>API: GET /api/payments/public/status/QTN-…
    API-->>C: "Confirming your payment…" (polls until the webhook lands)
    S->>API: checkout.session.completed (signed webhook)
    API->>API: verify → settle payment → activate policy → send email
    C->>API: (next poll)
    API-->>C: Policy number, cover period, status ACTIVE
    API->>M: Confirmation email
```

## Why the return page does not simply say "success"

Stripe's `success_url` is an ordinary browser redirect. A customer can reach it
by editing the address bar, and it can arrive before the webhook has been
processed. The page therefore reports the status the **server** holds, and polls
until the webhook has settled the payment. The frontend is never the authority
on whether money moved.
