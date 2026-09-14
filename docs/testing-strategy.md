# Testing strategy

208 tests: 124 backend (Jest + Supertest), 84 frontend (Vitest + React Testing
Library).

```bash
# in this repository (API)
npm test
npm run test:coverage

# in the client repository
npm test
```

The two repositories have independent dependency trees, so each suite runs on
its own — neither install is needed to run the other.

## What is tested, and what is not

The tests target **business rules and their failure modes**, not line coverage.
There are no tests that assert a getter returns what was set, and none that
re-state a framework's behaviour.

| Tested | Not tested | Why not |
| --- | --- | --- |
| Eligibility rules, each with pass/fail/boundary | Tailwind class names | Churns on every visual change; asserts nothing about behaviour |
| Premium arithmetic, including rounding and caps | Mongoose schema defaults | Testing the library, not our logic |
| Payment idempotency under concurrency | Stripe's own API | Stubbed at the boundary |
| Webhook replay, crash recovery, tampering | Real email delivery | Provider is behind an interface and stubbed |
| Ownership scoping across agents | | |
| Validation: what is rejected and with which field error | | |
| Error mapping: 400 vs 404 vs 409 vs 422 | | |

## Backend

**Real MongoDB, not a mock.** One `mongodb-memory-server` instance for the whole
run. The idempotency guarantees are *made of* unique indexes, partial indexes and
atomic `findOneAndUpdate` — mocking the database would test the mock. Indexes are
built in `beforeAll` via `syncIndexes()`; collections are cleared with
`deleteMany` between tests so indexes survive.

**External services are stubbed at their boundary.**
`src/tests/stripe.double.ts` reproduces the two behaviours the code depends on:
`checkout.sessions.create` returns a session, and requests carrying the same
idempotency key return the *same* session — exactly as Stripe does. The email
double records sends and can be told to fail once.

| Suite | Tests | Covers |
| --- | --- | --- |
| `auth.test.ts` | 10 | Signup, password hashing, httpOnly cookie, role injection blocked, duplicate email 409, login, enumeration resistance, protected routes, tampered token |
| `eligibility.test.ts` | 14 | Every rule's pass/fail/boundary, unconfigured products, all-failures-reported, profile derivation |
| `premium.test.ts` | 10 | Age bands, additive loadings, vehicle floor, income cap, whole-unit rounding, breakdown consistency |
| `product.test.ts` | 9 | DB-sourced catalogue, active filtering, category filter, pagination, regex escaping, 400 vs 404 |
| `customer.test.ts` | 23 | Creation, validation, per-agent uniqueness, cross-agent isolation, eligibility split, vehicle clearing, re-evaluation after edit, **guarded deletion**: cascade to quotations and documents, share-link invalidation, refusal on a policy or a live payment, dead attempts removed, cross-agent refusal, repeat deletes |
| `quotation.test.ts` | 8 | Server-side pricing, snapshots, ineligible refusal, idempotent re-selection, re-pricing, income cap, ownership |
| `payment.test.ts` | 11 | Amount from the quotation, client amount ignored, idempotent link, **5-way concurrency**, deterministic Stripe key, already-paid 409, DB-level duplicate rejection, expiry, ownership, WhatsApp link shape |
| `webhook.test.ts` | 18 | Signature rejection, activation, 12-month term, duplicate/different/concurrent deliveries, crash recovery, amount mismatch, unpaid session, expiry, late events, unknown sessions and types, email failure isolation, retry |
| `seed.test.ts` | 10 | Plus-addressed aliases stay unique, malformed override ignored, idempotent re-runs, **turning the email override on after a plain seed**, turning it back off, seeded ages exactly as declared, two agents do not collide |
| `document.test.ts` | 11 | Record creation, real PDF bytes, no stored bytes, regeneration in place, public link, wrong/expired token, link revocation, cache headers, ownership |

### The concurrency tests

These are the ones worth reading:

```ts
// Five simultaneous requests must produce ONE payment and ONE link.
const results = await Promise.all(
  Array.from({ length: 5 }, () => createPaymentLink(agentId, quotationId)),
);
expect(await PaymentModel.countDocuments({ quotationId })).toBe(1);
expect(new Set(results.map((r) => r.paymentUrl)).size).toBe(1);
```

```ts
// Three concurrent deliveries of DIFFERENT events for one session.
// The event ledger cannot help here — the conditional transition and the
// policy unique index must carry it alone.
await Promise.all([
  handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_a' })),
  handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_b' })),
  handleStripeEvent(checkoutCompletedEvent(session, { id: 'evt_c' })),
]);
expect(await PolicyModel.countDocuments()).toBe(1);
expect(await NotificationModel.countDocuments()).toBe(1);
```

**The first of these found a real bug.** An earlier implementation derived the
payment `attempt` from a `countDocuments` call and relied on the idempotency
key's uniqueness alone; under concurrency the count advanced between reads and
produced two payment rows. The fix was to put the unique constraint on the thing
that must actually be unique — one open payment per quotation — via a partial
index. This is exactly why the concurrency case is tested rather than assumed.

## Frontend

Vitest + React Testing Library, jsdom. Tests query by role and label, as a user
would, so they survive markup changes.

| Suite | Tests | Covers |
| --- | --- | --- |
| `apiClient.test.ts` | 12 | **Bearer token attached cross-origin**, no header when signed out, credentials still sent for the cookie path, content type only with a body, the 401 hook, network errors normalised, field errors keyed by name, and `VITE_API_URL` base resolution including a trailing slash |
| `format.test.ts` | 9 | Minor/major round-trip (including 19.99), lakh/crore shorthand, UTC date rendering, age in completed years |
| `useAsync.test.ts` | 7 | First load vs **background refresh**, refreshing flag, a failed poll keeping data on screen, first-load errors surfaced, stale data cleared on dependency change, abort on unmount |
| `usePolling.test.ts` | 6 | Inactive does nothing, interval ticking, ticks skipped while the tab is hidden with one catch-up tick on return, `maxAttempts` exhaustion, reset on deactivation, cleanup on unmount |
| `CustomerForm.test.tsx` | 12 | Validation rules, payload shaping, conditional vehicle fields, submission blocked when invalid |
| `LoginPage.test.tsx` | 5 | Rendering, client validation, successful sign-in and navigation, server error surfaced, field errors mapped |
| `ProductsPage.test.tsx` | 7 | DB-sourced rendering, cover/premium/benefits, plain-language rules, category refetch, empty state, recoverable error |
| `EditCustomerPage.test.tsx` | 6 | Returns to the table when opened from the table and to the profile when opened from the profile, fallback with no origin, Cancel matches Save, and a crafted origin is ignored |
| `CustomersPage.test.tsx` | 9 | Row actions present, edit does not also open the profile, row click still does, confirmation required before any API call, cancel and Escape, delete refreshes the list, **a 409 keeps the dialog open with the reason visible**, error cleared on reopen |
| `PaymentReturnPage.test.tsx` | 7 | **Does not claim success on redirect alone**, confirms once the server reports active, server-sourced amounts, cancellation, already-paid cancel link, missing reference, unknown reference |

The payment-return tests encode a security property, not just UI behaviour:
Stripe's `success_url` is an ordinary browser navigation that anyone can type,
so the page must report the status the **server** holds.

### The background-refresh regression

`useAsync` originally set `loading: true` on every refetch. Pages guard their
first paint with `if (loading) return <LoadingPanel/>`, so once the quotation
screen started polling for webhook confirmation every few seconds, each tick
replaced the whole page with a spinner — a visible flash roughly every five
seconds while a payment was outstanding.

The fix separates a first load from a background refresh, and `useAsync.test.ts`
now asserts the property directly: across a `reload()`, `loading` is never true
and `data` is never `null`. A failed background refresh is also swallowed rather
than replacing a working page with an error banner, since a single dropped poll
is not worth surfacing.

### Why Vitest on the client and Jest on the server

The brief named Jest. Jest is used on the backend, where it is the natural fit
and the assignment's intent is met directly. On the frontend the project is
Vite + ESM + `import.meta.env`; running Jest there needs `babel-jest` or a
`ts-jest` ESM configuration plus transform overrides, and the result is slower
and more brittle. Vitest is Jest-compatible (`describe`/`it`/`expect`, the same
RTL API), shares the Vite config, and is the standard runner for this stack.
The trade-off is two runners in one repo, which `npm test` hides behind a single
command.

## Not covered

- **No end-to-end browser tests.** Playwright against a live Stripe Checkout
  page would be the real end-to-end proof. The manual checklist in the README
  covers it instead, and the seam between them is the webhook — which *is*
  tested, in both replay and concurrency forms.
- **No load or soak testing.**
- **No visual regression testing.**
- **PDF content is asserted structurally, not visually.** The tests check the
  `%PDF-` header, a plausible size and that the quotation reference appears in
  the document metadata. Layout was verified by rendering and inspecting the
  output during development.
