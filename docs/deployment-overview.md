# Deployment overview

The client and the API are deployed **separately, to different platforms**:

| | Platform | Project root | Guide |
| --- | --- | --- | --- |
| **Client** — React SPA | Vercel (static) | [client repo](https://github.com/abnair715-png/Insurance-Agent-Platform-client) | [deployment guide](https://github.com/abnair715-png/Insurance-Agent-Platform-client/blob/main/docs/deployment.md) |
| **API** — Express | Render (Web Service) | this repo | [deployment.md](deployment.md) |

Diagram: [diagrams/deployment-architecture.md](diagrams/deployment-architecture.md)

## Order of operations

The two deployments reference each other, so neither can be finished in one
pass:

```
1. Deploy the API to Render      → gives you <API_URL>
2. Set API_PUBLIC_URL=<API_URL>  → redeploy the API
3. Deploy the client to Vercel   → VITE_API_URL=<API_URL>/api
                                 → gives you <CLIENT_URL>
4. Set CLIENT_URL=<CLIENT_URL>   → redeploy the API   ← easy to forget
5. Add the Stripe webhook at <API_URL>/api/webhooks/stripe
6. Seed the production database  → creates the unique indexes
```

Step 4 is the one people skip. Without it the dashboard renders and every
request fails CORS.

## The three URLs that must agree

| Variable | Set on | Points at | Symptom when wrong |
| --- | --- | --- | --- |
| `VITE_API_URL` | Vercel (client) | `<API_URL>/api` | Requests go nowhere useful |
| `CLIENT_URL` | Render (API) | `<CLIENT_URL>` | CORS blocks the browser; Stripe redirects wrongly |
| `API_PUBLIC_URL` | Render (API) | `<API_URL>` | WhatsApp PDF links 404 |

`VITE_API_URL` is inlined by Vite **at build time** — changing it needs a client
redeploy, not just a dashboard edit.

## Why these platforms

**Render for the API.** It runs a long-lived Node process, which suits this
service: no cold-start caveats around the Stripe webhook beyond the free plan's
spin-down, no execution-time ceiling on PDF generation, and no serverless
adapter to maintain. The trade-off is the free plan's ~15-minute idle spin-down
and ~50s wake — see the API guide.

**Vercel for the client.** A static Vite build on a CDN is exactly what Vercel
is best at, and previews per branch are useful.

Deploying both to one platform behind a single domain would restore same-origin
and let the session return to an httpOnly cookie — see
[technical-decisions.md](technical-decisions.md).
