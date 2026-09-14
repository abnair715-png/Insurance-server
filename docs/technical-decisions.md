# Technical decisions and trade-offs

Each entry states the decision, the alternative, why the alternative was
rejected, and what it would take to change course.

---

## Modular monolith, not microservices

**Decision.** One deployable Express application, split internally into modules
that own their model, validators, service, controller and routes.

**Alternative.** Separate services for customers, quotations, payments and
notifications.

**Why not.** Microservices buy independent deployment, independent scaling and
team autonomy. None of those is a constraint here: one codebase, one deployment
target, one developer. What they cost is immediate — network hops inside a single
user action, distributed transactions across the payment/policy boundary, an
inter-service contract to version, and much harder local development. The
payment→policy→email sequence in particular is *easier* to make exactly-once
inside one process with database constraints than across a network.

**Changing course.** The module boundaries are already the seams. `notifications`
would extract first (it is purely reactive and already behind an interface),
then `documents` (CPU-bound PDF work). `payments` should extract last, because
its guarantees currently rest on single-database constraints.

---

## MongoDB, not PostgreSQL

**Decision.** MongoDB Atlas with Mongoose.

**Why.** Three things about this domain fit a document store well:

1. `eligibilityRules` and `pricingFactors` are per-product structures with
   different shapes per category. In a relational schema this is either a sparse
   table of nullable columns, an EAV table, or a JSONB column — the last of which
   is the document model with extra steps.
2. A quotation's customer/product/eligibility snapshots are naturally nested and
   are always read as a unit.
3. The MERN stack was specified.

**What it costs, honestly.** There are no foreign keys: referential integrity is
the application's responsibility. There are no cross-collection joins beyond
`$lookup`, so listing views denormalise. Ad-hoc reporting is harder than SQL.

**What it does *not* cost.** The atomicity this system needs. Every invariant is
single-document — a conditional status transition, a unique index, an upsert —
which MongoDB guarantees natively.

**When PostgreSQL wins.** Once there are commissions, ledgers and regulatory
reporting — genuinely relational, multi-table-transactional workloads.

---

## Idempotency by database constraint, not application check

**Decision.** Unique and partial-unique indexes plus conditional atomic updates.

**Alternative.** Read-then-write: "does a payment already exist? no → create".

**Why not.** That leaves a window between the read and the write. Under two
concurrent requests both read "no" and both create. The concurrency test in the
suite reproduces exactly this — and it caught a real instance of it during
development.

Full analysis in [payment-idempotency.md](payment-idempotency.md).

---

## No MongoDB transactions

Atlas supports them. They are not used because the one sequence that appears to
need one — settle the payment, then create the policy — is already safe:
a single-document conditional update, then a single-document insert under a
unique index. If the process dies between the two, the next Stripe retry
completes the missing step, and a test asserts that recovery.

A transaction would add a session, transient-error retry handling and a
performance cost to buy a guarantee that already exists. Its rollback semantics
would also be wrong: once Stripe has taken the money, the correct response to a
downstream failure is to retry forward, not to unwind.

---

## Stripe Checkout, not Stripe Elements or a custom form

**Decision.** Hosted Checkout Sessions in test mode.

**Why.** The session URL is a link, which is exactly what the brief needs — the
agent shares it over WhatsApp and the customer opens it on their own device.
Elements would require the customer to be inside our application, which they
never are. Hosted Checkout also keeps card data entirely off our servers (SAQ-A
rather than SAQ-A-EP), and it supports the idempotency key we need.

**Test mode.** No real money, no business verification, and the reviewer can pay
with `4242 4242 4242 4242`. Going live is a key swap and a new webhook endpoint —
no code change.

---

## WhatsApp click-to-chat, not the Business API

**Decision.** `https://wa.me/<number>?text=<message>` deep links.

**What this actually does.** Opens WhatsApp on the *agent's* machine with the
recipient and message pre-filled. The agent presses send. **The application does
not send WhatsApp messages.** This is stated in the UI, not just in the docs.

**Why not the Business API.** It needs a Meta Business account, business
verification, a WhatsApp Business Account, a registered phone number, and
pre-approved message templates for business-initiated conversations — days of
approval before a single message. It also costs per conversation. For an MVP
whose point is to show the *flow*, that is entirely disproportionate.

**What is lost.** No delivery receipts, no automation, no read status, and the
agent must have WhatsApp on the device they are working from.

**Changing course.** Only `utils/whatsapp.ts` changes: instead of returning a
URL for the browser to open, a `WhatsAppProvider` sends via the Cloud API. The
message-composition functions are already separate from the link building.

---

## PDFKit, not headless Chrome

**Decision.** PDFKit — pure JavaScript, imperative layout.

**Alternative.** Puppeteer or Playwright rendering an HTML template.

**Why not.** A Chromium binary is ~300 MB, far beyond a comfortable Vercel
function bundle, and cold-start rendering would approach the function timeout.
`@sparticuz/chromium` makes it *possible* but adds a fragile binary dependency
for a one-page document.

**What it costs.** Layout is imperative — coordinates and explicit page-break
handling rather than CSS. This produced a real defect during development: a
disclaimer box was drawn on page 1 while its text flowed to page 2, because
PDFKit pushes text past the bottom margin but draws shapes anywhere. The fix was
an `ensureSpace()` helper that reserves a block's height before drawing it.

**The rupee sign.** PDFKit's built-in fonts are WinAnsi-encoded and have no glyph
for `₹` (U+20B9). Rather than ship and bundle a Unicode TTF, PDFs and emails use
the ISO code — `INR 26,448.00`. The UI, which has real fonts, shows `₹26,448`.
`formatMoney` and `formatMoneyPlain` make the distinction explicit.

---

## PDFs rendered on demand, never stored

**Decision.** The `documents` collection holds metadata only. Bytes are
generated per request from the quotation's snapshots.

**Why.** Vercel's filesystem is ephemeral and per-invocation, so a written file
would not survive. The alternatives are object storage (S3/Vercel Blob — another
service, another credential, another lifecycle to manage) or base64 in MongoDB
(bloats documents and working set).

Because the quotation is immutable once created, regenerating is deterministic:
the same reference always produces the same document. Storage buys nothing.

**What it costs.** ~50 ms of CPU per download instead of a cache hit. At MVP
volumes that is irrelevant; at scale, a signed object-storage URL cached on the
document record would be the change.

---

## Derived, unstored link tokens

**Decision.** `token = HMAC-SHA256(DOCUMENT_LINK_SECRET, "<reference>:<version>")`.

**Alternative.** Generate a random token and store its hash.

**Why this instead.** A stored-hash scheme means the raw token exists exactly
once, in the response to the generate call — so an agent who refreshes the page
loses the share link and must regenerate. Deriving it means the link is
reproducible on any later page load, a database dump alone yields no working
link, and incrementing `version` revokes every link already shared. Comparison is
constant-time.

---

## httpOnly cookie for the session, with Bearer also accepted

**Decision.** The JWT is set as an httpOnly, `SameSite=Lax`, `Secure`-in-production
cookie. The middleware also accepts `Authorization: Bearer`.

**Why not localStorage.** JavaScript can read it, so any XSS in the dashboard
exfiltrates a long-lived credential. An httpOnly cookie is unreadable from JS.

**Why CSRF is not the usual trade here.** The SPA and API share one origin in
every environment (Vite proxy in dev, one Vercel project in production), so
`SameSite=Lax` blocks cross-site POSTs. There are no `GET` mutations. If a
separate client origin is ever added, a CSRF token becomes necessary.

**Why Bearer too.** So the API is usable from curl and Postman, the documented
examples work without a cookie jar, and the test suite needs no cookie handling.

---

## No refresh tokens

**Decision.** A single 12-hour access token; expiry means signing in again.

**Why.** Refresh-token rotation needs a token store, revocation, reuse detection
and a silent-refresh path in the client. For an agent's working day, a 12-hour
session is adequate. The cost is honest: a stolen token is valid until it
expires, and there is no server-side revocation. Adding rotation would be an
`auth` module change with no effect on any other module.

---

## Two projects, two platforms — Vercel for the client, Render for the API

**Decision.** The SPA deploys to Vercel as a static build; the API deploys to
Render as a long-lived Node Web Service. One repository, two Root Directories.

**Why Render rather than Vercel for the API.** A persistent process removes a
category of problems this service would otherwise have to work around:

- **No serverless adapter.** Vercel's Node runtime consumes the request stream
  before Express sees it, which breaks Stripe signature verification — it needs
  the exact raw bytes. The adapter that worked around this is gone.
- **No execution ceiling** on PDF generation.
- **A genuinely warm connection pool** rather than one cached on `globalThis`.
  (That caching is still in the code and still correct; it simply stops being
  load-bearing.)

**What Render costs.** The free plan spins down after ~15 minutes idle, and the
next request waits ~50s. A Stripe webhook arriving during a spin-down times out
and is retried — harmless here, because the handler is idempotent by
construction, which is precisely the property
[../server/docs/payment-idempotency.md](payment-idempotency.md)
argues for. For a live demo the service needs warming first.

**Why Vercel keeps the client.** A static Vite build on a CDN is what it is best
at, with per-branch previews.

**What it buys.** Independent deploys and rollbacks — a UI fix cannot break the
API and does not redeploy it. Independent build pipelines, so a client build
failure leaves the API untouched. Independent scaling and logs. The API is also
consumable by something other than this SPA (a mobile client, a partner) without
restructuring.

**What it costs — and none of this is hypothetical.**

1. **Cookie auth stops working.** Cross-site requests do not carry a
   `SameSite=Lax` cookie, and `SameSite=None` is blocked by Safari's ITP and
   Chrome's third-party cookie restrictions. The SPA therefore stores the JWT and
   sends it as a Bearer token, which the API already accepted. That token is
   readable by JavaScript — the exact exposure the httpOnly cookie was chosen to
   prevent. See the next section.
2. **CORS becomes load-bearing** rather than a formality, with a preflight on
   most requests.
3. **A build-time API URL.** `VITE_API_URL` is inlined by Vite, so changing it
   requires a client redeploy.
4. **Two sets of environment variables that reference each other.**
   `CLIENT_URL` and `API_PUBLIC_URL` on the server, `VITE_API_URL` on the client.
   Changing one URL without the others fails as a CORS error rather than a clear
   message.
5. **A second public origin to reason about** for document share links, which is
   why `API_PUBLIC_URL` exists: those links are served by the API, so building
   them from `CLIENT_URL` would 404.

**Reverting is cheap.** Putting both behind one domain — a Vercel rewrite, or any
reverse proxy — restores same-origin, at which point the httpOnly cookie starts
working again with no application change, because the server never stopped
issuing or accepting it.

---

## httpOnly cookie, not a token in localStorage

**Decision.** The session is an httpOnly cookie set by the server. The client
holds no token: nothing in `localStorage`, nothing in memory, nothing an XSS bug
can read.

**Why not a token the client stores.** Any token JavaScript can read, JavaScript
can exfiltrate. A single XSS bug anywhere in the dashboard — including in a
dependency — hands an attacker a live session for its full lifetime. An httpOnly
cookie is unreadable from script by construction, so that entire class of attack
does not apply.

**What it costs across origins.** The client is on Vercel and the API on Render,
which are different sites, so the cookie is cross-site and must be
`SameSite=None; Secure`. That is set automatically: `resolveCookiePolicy()`
compares the hosts of `CLIENT_URL` and `API_PUBLIC_URL` and picks `Lax` when
they match (local development behind the Vite proxy) and `None; Secure` when
they do not. Hard-coding either value breaks one of the two environments.

**The remaining limitation, stated plainly.** A cross-site cookie is a
*third-party* cookie. Safari blocks those by default under ITP, and Chrome has
been restricting them. On `*.vercel.app` + `*.onrender.com` there is no way
around that, because both are public suffixes — two subdomains of them are still
different sites, so a shared parent-domain cookie is impossible.

**The fix, when it matters.** Serve both from one registrable domain —
`app.example.com` and `api.example.com`. The cookie then becomes first-party,
works in every browser, and `SameSite=Lax` returns along with its free CSRF
defence. That is a DNS and custom-domain change; no application code moves,
because the policy is derived rather than configured.

**CSRF.** With `SameSite=None` the cookie *is* attached to cross-site requests,
so `Lax`'s implicit protection is gone. What stands in its place: a strict CORS
allow-list, so a hostile origin cannot read any response; no state-changing
`GET`; and `credentials: 'include'` only ever pointed at our own API. A CSRF
token is the next step if this ever serves a broader audience.

**Bearer is still accepted server-side**, so `curl`, Postman and the test suite
work without a cookie jar. Browsers never use that path.

---

## REST, not GraphQL

One known client, a small stable set of screens, each needing a predictable
payload. GraphQL's benefits — client-specified shapes across many consumers —
do not apply; its costs (schema plus resolver layers, N+1 risk, query-depth
limiting, a less obvious home for per-endpoint rate limits and idempotency
semantics) do. REST also leaves the webhook endpoint as an entirely ordinary
signed POST.

---

## Provider abstractions for email, but not for payments

**Decision.** `EmailProvider` is an interface with `ResendEmailProvider` and
`ConsoleEmailProvider`. Stripe is used directly through a thin accessor.

**Why the asymmetry.** Email providers are genuinely interchangeable — the
interface is `send({to, subject, html, text})` and every provider implements it.
The abstraction also pays for itself immediately: the console provider keeps the
whole flow demonstrable with no email account, and the test double makes the
suite deterministic.

Payment providers are *not* interchangeable. Stripe's Checkout Sessions,
idempotency-key semantics and webhook signature scheme have no common shape with
a competitor's. A `PaymentProvider` interface would either leak Stripe's model
(a fake abstraction) or be so generic it hides the guarantees this system
depends on. Instead Stripe is isolated in `stripe.client.ts` and
`payment.service.ts`; a real migration would rewrite those two files, which is
honest work rather than pretend-portability.

---

## In-memory rate limiting

**Decision.** `express-rate-limit` with the default memory store.

**The limitation, stated plainly.** Limits are per serverless instance, so the
effective global limit is higher than configured and resets on every cold start.
It stops a single client hammering an endpoint; it is not a distributed limit.

**The fix, when needed.** A shared store (Upstash Redis) — a store swap, no logic
change. Vercel's own WAF rate limiting is the alternative.

---

## No queue for the confirmation email

**Decision.** Send inline in the webhook handler, inside a try/catch, recording
the outcome on a `notifications` row.

**Why not a queue.** BullMQ needs Redis and a worker process — neither exists in
a serverless deployment. SQS or Inngest adds a service and a credential to a
system whose only async work is one email.

**Why the current design is defensible.** The email is outside the money path:
the payment is recorded and the policy is active before it is attempted, and
failures are caught and persisted rather than thrown. The `notifications`
collection *is* an outbox — it just has a manual drain
(`POST /api/notifications/retry-failed`) instead of a scheduled one. Replacing
that trigger with a Vercel Cron job calling the same service function is a
configuration change; the data model does not move.

---

## `isOpen` booleans denormalised alongside `status`

**Decision.** `quotations` and `payments` carry a boolean derived from `status`.

**Why.** MongoDB's `partialFilterExpression` supports equality and a limited set
of operators; `$in` is not portable across versions. The invariants that matter —
one open quotation per customer/product, one open payment per quotation — need to
be enforced *by the database*, so the filter must be an equality on a field that
exists. A maintained boolean is the cost of getting a real constraint instead of
an application-level check.

**The risk.** `status` and `isOpen` can drift if a new transition forgets to set
both. They are set together in every transition, and the tests assert `isOpen`
after settlement.

---

## Money as integer minor units

Every amount is a whole number of paise. No floating-point arithmetic touches
the money path, Stripe expects minor units so there is no boundary conversion,
and the values are safe to compare and index. Conversion to a display string
happens only in the UI, PDFs and emails. A test asserts the round-trip through
19.99 — the classic binary-floating-point trap.

---

## Eligibility rules as data

**Decision.** Rules live in each product document; one evaluator interprets them.

**Why.** Launching a product or changing who qualifies becomes a database change
rather than a deployment, and the criteria shown in the UI are rendered from the
same source the engine reads — so the screen cannot disagree with the rule.

**What it costs.** Only rules in the evaluator's vocabulary can be expressed. A
genuinely novel rule needs a new entry in `RULES` as well as data. The
alternative — a general expression language — buys flexibility at the cost of
being untestable and unreadable. Eleven named rules with explicit failure
messages is the better trade at this size.

---

## No data-fetching library on the client

`useAsync` is 40 lines and gives every screen loading/error/empty/loaded plus
abort-on-unmount. React Query becomes the right call when caching, background
refetch, or optimistic updates are needed. None of those is needed yet, and at
this size it would be a dependency that earns nothing.
