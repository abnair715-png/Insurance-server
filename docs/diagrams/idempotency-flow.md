# Idempotency flow

## Creating a payment link

```mermaid
flowchart TD
    START(["POST /api/payments/create-link"]) --> OWN{"Quotation belongs<br/>to this agent?"}
    OWN -->|no| E404["404 NOT_FOUND"]
    OWN -->|yes| EXP{"Quotation expired?"}
    EXP -->|yes| E422["422 BUSINESS_RULE_VIOLATION"]
    EXP -->|no| PAID{"SUCCEEDED payment<br/>exists for it?"}
    PAID -->|yes| E409["409 CONFLICT<br/>'already been paid for'"]
    PAID -->|no| OPEN{"OPEN payment with a<br/>live checkout URL?"}
    OPEN -->|yes| REUSE["200 · reused: true<br/>same paymentUrl"]
    OPEN -->|no| INS["INSERT payment<br/>isOpen: true<br/>key = pay_&lt;ref&gt;_&lt;attempt&gt;"]
    INS --> DUP{"Duplicate key?"}
    DUP -->|"yes — a concurrent request won"| READ["Read back the winner"]
    READ --> REUSE2["Return the winner's link"]
    DUP -->|no| STRIPE["Stripe checkout.sessions.create<br/>with the SAME idempotency key"]
    STRIPE --> UPD["payment → PENDING<br/>+ sessionId + checkoutUrl"]
    UPD --> OK["201 · reused: false"]

    style E409 fill:#fee2e2,stroke:#ef4444
    style REUSE fill:#dcfce7,stroke:#22c55e
    style REUSE2 fill:#dcfce7,stroke:#22c55e
    style OK fill:#dcfce7,stroke:#22c55e
```

## Processing a webhook

```mermaid
flowchart TD
    W(["POST /api/webhooks/stripe"]) --> SIG{"Signature valid<br/>over the RAW bytes?"}
    SIG -->|no| B400["400 · nothing written"]
    SIG -->|yes| CLAIM["INSERT webhook_events { eventId }"]

    CLAIM --> C1{"Duplicate eventId?"}
    C1 -->|"no — claimed"| PAY
    C1 -->|yes| C2{"Previous claim state?"}
    C2 -->|PROCESSED| SKIP["200 · processed: false<br/>duplicate_event_already_processed"]
    C2 -->|"PROCESSING, fresh"| SKIP2["200 · another instance has it"]
    C2 -->|"PROCESSING &gt; 2 min, or FAILED"| PAY

    PAY["Resolve our payment<br/>by sessionId, then by metadata"] --> AMT{"session.amount_total<br/>== payment.amount?"}
    AMT -->|no| FAIL["payment → FAILED<br/>reason: amount_mismatch<br/>NO policy"]
    AMT -->|yes| COND["findOneAndUpdate<br/>{_id, status ∈ (CREATED, PENDING)}<br/>→ SUCCEEDED"]

    COND --> C3{"Matched a document?"}
    C3 -->|"no — already terminal"| RECHK{"Is it already SUCCEEDED?"}
    RECHK -->|no| STOP["Stop · terminal non-success"]
    RECHK -->|"yes — earlier delivery crashed<br/>before writing the policy"| UPSERT
    C3 -->|yes| UPSERT["INSERT policy<br/>unique index on paymentId"]

    UPSERT --> C4{"Inserted?"}
    C4 -->|"no — duplicate key"| EXIST["Read existing policy<br/>created: false · no email"]
    C4 -->|yes| EMAIL["Send confirmation email<br/>(errors caught and logged)"]
    EMAIL --> DONE["200 · processed: true"]
    EXIST --> DONE

    style B400 fill:#fee2e2,stroke:#ef4444
    style FAIL fill:#fee2e2,stroke:#ef4444
    style DONE fill:#dcfce7,stroke:#22c55e
    style SKIP fill:#e0e7ff,stroke:#6366f1
    style SKIP2 fill:#e0e7ff,stroke:#6366f1
```

The narrative version, with the failure modes each layer covers, is in
[../payment-idempotency.md](../payment-idempotency.md).
