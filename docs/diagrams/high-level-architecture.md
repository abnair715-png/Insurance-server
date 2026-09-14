# High-level architecture

```mermaid
flowchart TB
    subgraph Browser["Browser (desktop)"]
        UI["React 18 + TypeScript SPA<br/>React Router · Tailwind CSS"]
    end

    subgraph Vercel["Vercel (single project, one origin)"]
        CDN["Static hosting<br/>client/dist"]
        FN["Serverless function<br/>api/index.ts"]

        subgraph Express["Express application (server/src/app.ts)"]
            MW["Middleware<br/>helmet · CORS · cookies<br/>body parser (raw-preserving)<br/>rate limiting · request log"]
            AUTH["Auth middleware<br/>JWT verify · role gate"]
            VAL["Validation middleware<br/>zod schemas"]
            CTL["Controllers<br/>thin HTTP adapters"]
            SVC["Services<br/>all business logic"]
            ERR["Centralised error handler"]
        end
    end

    subgraph Data["Data"]
        DB[("MongoDB Atlas<br/>9 collections")]
    end

    subgraph External["External services"]
        STRIPE["Stripe<br/>Checkout · Webhooks<br/>(test mode)"]
        RESEND["Resend<br/>transactional email"]
        WA["wa.me<br/>click-to-chat"]
    end

    UI -->|"cross-origin HTTPS · Authorization: Bearer · CORS"| FN
    UI -.->|"static assets"| CDN
    FN --> MW --> AUTH --> VAL --> CTL --> SVC
    SVC --> DB
    SVC -->|"create Checkout Session"| STRIPE
    SVC -->|"send confirmation"| RESEND
    UI -->|"agent opens deep link"| WA
    STRIPE -->|"signed webhook events"| FN
    MW -.->|"any thrown error"| ERR
    ERR -.->|"consistent JSON envelope"| UI

    classDef ext fill:#fff7ed,stroke:#fdba74
    classDef data fill:#ecfdf5,stroke:#6ee7b7
    class STRIPE,RESEND,WA ext
    class DB data
```

## Layer responsibilities

| Layer | Responsibility | Never does |
| --- | --- | --- |
| Controller | Read the request, call one service, shape the response | Business rules, database access |
| Service | All domain logic, orchestration, external calls | Know about `req`/`res` |
| Model | Schema, indexes, serialisation transform | Decide policy |
| Middleware | Cross-cutting: auth, validation, errors, limits | Domain logic |

The Express app is created by a factory (`createApp()`) that never calls
`listen`. The same object is used by the local server, the Vercel adapter and
the Supertest suite, so there is no separate "serverless" code path that could
drift from the one under test.

The SPA and the API are separate Vercel projects, so every browser request is
cross-origin: CORS is enforced against an allow-list, and the session travels as
a Bearer token rather than a cookie. See
[deployment-architecture.md](deployment-architecture.md).
