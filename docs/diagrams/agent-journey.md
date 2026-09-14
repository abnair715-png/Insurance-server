# Agent journey

```mermaid
flowchart TD
    A["Sign up / Sign in"] --> B["Dashboard<br/>customers · policies · pending payments"]
    B --> C["Products<br/>live catalogue from MongoDB"]
    B --> D["Customers"]
    D --> E["New customer<br/>personal · income · vehicle · declarations"]
    E --> F["Customer profile"]
    D --> F
    F --> G["Applicable products<br/>eligibilityService evaluates every active product"]
    G -->|"eligible"| H["Select and quote<br/>POST /api/quotations"]
    G -->|"not eligible"| G2["Reasons shown per product<br/>e.g. 'Minimum entry age is 55; the customer is 32.'"]
    H --> I["Quotation detail<br/>premium breakdown · eligibility snapshot"]
    I --> J["Generate quotation PDF<br/>POST /api/documents/:id/generate"]
    J --> K["Share PDF via WhatsApp<br/>wa.me deep link, agent presses send"]
    K --> L["Generate payment link<br/>POST /api/payments/create-link"]
    L --> M["Share payment link via WhatsApp"]
    M --> N{"Customer pays?"}
    N -->|"yes"| O["Stripe webhook activates the policy<br/>agent's page polls and updates"]
    N -->|"no / expired"| L
    O --> P["Policy active<br/>confirmation email sent to the customer"]

    style G2 fill:#fef3c7,stroke:#f59e0b
    style O fill:#dcfce7,stroke:#22c55e
    style P fill:#dcfce7,stroke:#22c55e
```

Every step above is a screen in the dashboard. The quotation detail page renders
this sequence as a stepper so the agent can see where a customer has got to
without reading a status field.
