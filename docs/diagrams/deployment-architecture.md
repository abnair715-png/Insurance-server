# Deployment architecture

The client and the API are **two independently deployable projects** from one
repository, on **two different platforms**.

```mermaid
flowchart TB
    subgraph Dev["Local development — one origin"]
        V["Vite dev server :5173<br/>proxies /api → :4000"]
        EX["Express :4000<br/>tsx watch"]
        LM[("MongoDB local or Atlas")]
        CLI["Stripe CLI<br/>stripe listen --forward-to<br/>localhost:4000/api/webhooks/stripe"]
        V -->|"same-origin /api"| EX --> LM
        CLI --> EX
    end

    subgraph Prod["Production — two origins, two platforms"]
        direction TB
        subgraph VER["Vercel — Root Directory: client"]
            STATIC["Static build on the CDN<br/>client/dist<br/>rewrite /(.*) → /index.html"]
        end
        subgraph REN["Render — Root Directory: server"]
            NODE["Web Service · long-lived Node process<br/>npm start → node dist/index.js<br/>health check /api/health"]
        end
        STATIC -->|"cross-origin fetch<br/>Authorization: Bearer &lt;jwt&gt;<br/>CORS allow-list"| NODE
    end

    ATLAS[("MongoDB Atlas<br/>M0 free tier")]
    STRIPE["Stripe (test mode)"]
    RESEND["Resend"]
    CUST["Customer's phone<br/>PDF link · Checkout"]

    NODE -->|"cached connection"| ATLAS
    NODE -->|"Checkout Sessions"| STRIPE
    STRIPE -->|"webhook → Render origin"| NODE
    NODE -->|"confirmation email"| RESEND
    CUST -->|"public document link<br/>(Render origin)"| NODE
    CUST -->|"payment return page<br/>(Vercel origin)"| STATIC

    classDef prod fill:#eef2ff,stroke:#6366f1
    class STATIC,NODE prod
```

## The three URLs that must agree

```mermaid
flowchart LR
    C["Vercel · client<br/>VITE_API_URL"] -->|"points at"| A["Render origin<br/>&lt;API_URL&gt;"]
    S["Render · API<br/>CLIENT_URL"] -->|"points at"| B["Vercel origin<br/>&lt;CLIENT_URL&gt;"]
    S2["Render · API<br/>API_PUBLIC_URL"] -->|"points at"| A
```

| Variable | Set on | Value | Symptom when wrong |
| --- | --- | --- | --- |
| `VITE_API_URL` | Vercel | `<API_URL>/api` | Requests go nowhere useful |
| `CLIENT_URL` | Render | `<CLIENT_URL>` | CORS blocks the browser; Stripe redirects wrongly |
| `API_PUBLIC_URL` | Render | `<API_URL>` | WhatsApp PDF links 404 |

`VITE_API_URL` is inlined by Vite **at build time** — changing it needs a client
redeploy, not just a dashboard edit.

## Why a long-lived process for the API

Render runs `node dist/index.js` and keeps it alive, rather than invoking a
function per request. For this service that removes several concerns:

- no serverless adapter to maintain, and no host that consumes the request
  stream before Express sees it — which matters because Stripe signature
  verification needs the exact raw bytes;
- no execution-time ceiling on PDF generation;
- one warm MongoDB connection pool instead of a cache keyed on `globalThis`
  (the caching is still there and still correct — it simply stops being
  load-bearing).

The cost is the free plan's idle spin-down: after ~15 minutes the service stops,
and the next request waits ~50 seconds. A Stripe webhook that arrives during a
spin-down times out and is **retried** — harmless here, because the handler is
idempotent by construction. See
[../../server/docs/payment-idempotency.md](../payment-idempotency.md).

## What splitting the deployment changed

| | Single origin | Two origins (current) |
| --- | --- | --- |
| Auth transport | httpOnly `SameSite=Lax` cookie | `Authorization: Bearer` from `localStorage` |
| XSS exposure of the session | None — JS cannot read the cookie | **Token is readable by JS** |
| CSRF | Mitigated by `SameSite=Lax` | Not applicable — Bearer is not sent automatically |
| CORS | Not needed | Load-bearing; strict allow-list |
| API URL in the client | Relative `/api` | Build-time `VITE_API_URL` |
| Deploys | One | Two, independent |

The server still issues and accepts the cookie, so putting both behind one
domain would restore the httpOnly path with no application change.

Full instructions: [../deployment.md](../deployment.md).
