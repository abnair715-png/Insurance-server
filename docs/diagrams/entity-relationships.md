# Entity relationships

```mermaid
erDiagram
    AGENT ||--o{ CUSTOMER : "creates and owns"
    AGENT ||--o{ QUOTATION : raises
    AGENT ||--o{ PAYMENT : initiates
    AGENT ||--o{ POLICY : "writes"

    PRODUCT ||--o{ QUOTATION : "is quoted as"
    PRODUCT ||--o{ POLICY : "is issued as"

    CUSTOMER ||--o{ QUOTATION : "receives"
    QUOTATION ||--o| DOCUMENT : "has one PDF record"
    QUOTATION ||--o{ PAYMENT : "has attempts"
    QUOTATION ||--o| POLICY : "converts to at most one"
    PAYMENT ||--o| POLICY : "activates exactly one"
    POLICY ||--o| NOTIFICATION : "triggers one email"

    AGENT {
        ObjectId _id PK
        string email UK "unique, lowercased"
        string passwordHash "bcrypt, select:false"
        string role "AGENT | ADMIN"
    }

    PRODUCT {
        ObjectId _id PK
        string name "unique with category"
        string category "TERM | HEALTH | VEHICLE | OTHER"
        int basePremium "minor units"
        int coverageAmount "minor units"
        object eligibilityRules "data, not code"
        object pricingFactors "age bands, loadings"
        bool active
    }

    CUSTOMER {
        ObjectId _id PK
        ObjectId createdByAgent FK
        string email "unique per agent"
        string phone "unique per agent"
        date dateOfBirth
        int annualIncome "minor units"
        object vehicle "owns, type, value"
        object health "smoker, preExistingConditions"
    }

    QUOTATION {
        ObjectId _id PK
        string reference UK "QTN-YYYY-XXXXXXXX"
        ObjectId customerId FK
        ObjectId productId FK
        int premiumAmount "frozen at quote time"
        int coverageAmount
        array premiumBreakdown
        object customerSnapshot
        object productSnapshot
        object eligibilitySnapshot
        string status
        bool isOpen "partial unique index key"
        date expiresAt
    }

    DOCUMENT {
        ObjectId _id PK
        string reference UK "DOC-YYYY-XXXXXXXX"
        ObjectId quotationId FK "unique"
        int version "bump revokes shared links"
        date expiresAt
    }

    PAYMENT {
        ObjectId _id PK
        string idempotencyKey UK "pay_<quotationRef>_<attempt>"
        ObjectId quotationId FK
        int amount "copied from the quotation"
        string status "CREATED|PENDING|SUCCEEDED|FAILED|EXPIRED"
        bool isOpen "partial unique index key"
        string stripeSessionId UK "sparse"
        string lastStripeEventId
    }

    POLICY {
        ObjectId _id PK
        string policyNumber UK "POL-YYYY-XXXXXXXX"
        ObjectId paymentId FK "unique"
        ObjectId quotationId FK "unique"
        string status "ACTIVE | CANCELLED | LAPSED"
        date startDate
        date endDate
    }

    NOTIFICATION {
        ObjectId _id PK
        ObjectId policyId FK "unique with type"
        string type "POLICY_ACTIVATED"
        string status "PENDING | SENT | FAILED"
        int attempts
        string lastError
    }
```

A ninth collection, `webhook_events`, has no relationships: it is a flat ledger
of processed Stripe event ids, keyed by a unique index on `eventId`.

Full field lists, index rationale and the snapshot-versus-reference reasoning
are in [../database-design.md](../database-design.md).
