# Insurance eligibility rules

`server/src/modules/eligibility/eligibility.service.ts` is the **single** place
in the system that decides whether a customer may be offered a product. The
customer detail screen, the quotation service and the API all consult it; none
of them re-implements any part of it.

## How it works

1. `buildCustomerProfile(customer)` projects the stored customer onto the
   minimal set of facts the rules may see:

   ```ts
   { age, gender, annualIncome, ownsVehicle, vehicleType, vehicleValue,
     smoker, preExistingConditions }
   ```

   Age is computed in completed years at evaluation time, so a customer who has
   a birthday becomes eligible for the next band without any data migration.

2. `evaluateEligibility(profile, product.eligibilityRules)` runs every rule the
   product configures and returns:

   ```ts
   { eligible: boolean, failures: [{ rule, message }] }
   ```

Three properties make this predictable:

- **Rules are pure predicates** over `(profile, rules)` — no database, no
  network, no ordering effects.
- **An unconfigured rule is skipped, not failed.** A product with an empty
  `eligibilityRules` object is open to everyone.
- **Every rule is evaluated, even after the first failure.** The agent sees all
  the reasons at once instead of discovering them one at a time.

## The rule vocabulary

| Rule id | Product field | Passes when | Message shown to the agent |
| --- | --- | --- | --- |
| `MIN_AGE` | `minAge` | `age >= minAge` | "Minimum entry age is 55; the customer is 32." |
| `MAX_AGE` | `maxAge` | `age <= maxAge` | "Maximum entry age is 60; the customer is 61." |
| `MIN_ANNUAL_INCOME` | `minAnnualIncome` | `annualIncome >= min` | "Requires a minimum annual income of ₹3,00,000.00." |
| `MAX_ANNUAL_INCOME` | `maxAnnualIncome` | `annualIncome <= max` | "Only available to customers with an annual income up to …" |
| `ALLOWED_GENDER` | `allowedGenders[]` | gender is listed | "Only available to: FEMALE." |
| `REQUIRES_VEHICLE` | `requiresVehicle` | `ownsVehicle` | "The customer does not own a vehicle." |
| `ALLOWED_VEHICLE_TYPE` | `allowedVehicleTypes[]` | type is listed | "Covers these vehicle types only: CAR, COMMERCIAL." |
| `MIN_VEHICLE_VALUE` | `minVehicleValue` | `vehicleValue >= min` | "Requires a vehicle valued at ₹1,00,000.00 or more." |
| `MAX_VEHICLE_VALUE` | `maxVehicleValue` | `vehicleValue <= max` | "Covers vehicles valued up to …" |
| `EXCLUDES_SMOKERS` | `excludeSmokers` | `!smoker` | "Not available to customers who have declared they smoke." |
| `EXCLUDES_PRE_EXISTING` | `excludePreExistingConditions` | `!preExistingConditions` | "Not available to customers with declared pre-existing conditions." |

All bounds are **inclusive**: `minAge: 18` admits an 18-year-old.

## Assumptions

These are simplifications, chosen so the mechanism is demonstrable without
pretending to be an underwriting engine:

1. **Age is the only time-varying input.** There is no policy-anniversary
   re-rating and no waiting-period modelling.
2. **Health is two self-declared booleans.** Real underwriting asks dozens of
   questions and orders medicals. Collecting genuine medical history would put
   the MVP in scope for health-data regulation and demonstrate nothing extra.
3. **Income is self-declared and unverified.** No document upload, no
   verification step.
4. **One vehicle per customer.** A real motor product handles a fleet.
5. **Rules are conjunctive.** A product's criteria are ANDed. There is no
   "either A or B" rule, because no seeded product needs one; expressing it would
   need a nested rule structure, not just a new rule id.
6. **Eligibility is binary.** Real insurers have a third state — *refer to
   underwriter*. Adding it would be a third return value from the same engine.
7. **No geographic rules.** City, state and postal code are captured and printed
   but do not affect eligibility.

## Enforcement

Eligibility is checked **server-side at quotation creation**, not only when the
UI renders the list:

```ts
const { eligible, failures } = evaluateEligibility(profile, product.eligibilityRules);
if (!eligible) throw AppError.businessRule(`${customer.firstName} is not eligible for …`);
```

So a crafted `POST /api/quotations` naming an ineligible product is a 422, and no
quotation is written. A test asserts this.

## Premium calculation

Separate from eligibility, and equally server-only:
`server/src/modules/quotations/premium.service.ts`.

Applied in order, with every step recorded in `premiumBreakdown` so the same
explanation appears on screen and on the PDF:

1. **Base premium** — the product's catalogue price.
2. **Vehicle value rating** — when `vehicleValueRatePct` is set, the premium
   becomes `max(basePremium, vehicleValue × rate%)`. The catalogue price acts as
   a floor.
3. **Age band multiplier** — the band containing the customer's age. No matching
   band means a multiplier of 1.
4. **Declared risk loadings** — smoker and pre-existing percentages are summed
   and applied **additively**, not compounded: a 50% and a 20% loading give
   ×1.70, not ×1.80. Compounding penalises the same customer twice for
   overlapping risks.
5. **Rounding** — to whole currency units. A quoted premium is never fractional.
6. **Cover** — `min(product.coverageAmount, annualIncome × coverageIncomeMultiple)`
   when the multiple is configured, so a term quotation cannot exceed a realistic
   underwriting limit.

### Worked example — Daniel Fernandes, Term Life Plus

Age 45, annual income ₹28,00,000, declared smoker.

| Step | Calculation | Running total |
| --- | --- | --- |
| Base premium | Term Life Plus | ₹11,400 |
| Age band adjustment | age 45 (band 41–50) × 1.6 | ₹18,240 |
| Declared risk loading | +45% (smoker) | ₹26,448 |
| **Annual premium** | | **₹26,448** |
| Sum assured | min(₹1,00,00,000, ₹28,00,000 × 15) | ₹1,00,00,000 |

## Seeded demo matrix

The four demo customers were chosen to produce genuinely different outcomes:

| Customer | Age | Income | Vehicle | Declarations | Eligible for |
| --- | --- | --- | --- | --- | --- |
| Ananya Sharma | 32 | ₹12L | Car ₹9L | — | Term Life Plus, Family Health Shield, Vehicle Comprehensive, Personal Accident |
| Rahul Verma | 24 | ₹2.4L | Two-wheeler ₹1.1L | Smoker | Family Health Shield, Two-Wheeler Shield, Personal Accident |
| Meera Iyer | 61 | ₹6L | None | Pre-existing | Senior Health Protect, Term Life Secure 65, Personal Accident |
| Daniel Fernandes | 45 | ₹28L | Commercial ₹22L | Smoker | Term Life Plus, Term Life Secure 65, Family Health Shield, Vehicle Comprehensive, Personal Accident |

Rahul demonstrates ineligibility with reasons (income below the term floor, and
a two-wheeler where the comprehensive motor product requires a car or commercial
vehicle). Meera demonstrates a pre-existing-condition exclusion on the standard
health product alongside eligibility for the senior one. Daniel demonstrates the
smoker loading in the premium breakdown.

## Tests

`server/src/modules/eligibility/eligibility.test.ts` covers each rule's pass
case, fail case and boundary, that an unconfigured product is open to everyone,
that all failures are reported rather than just the first, and that a missing
vehicle or health sub-document defaults to safe values.
`premium.test.ts` covers each pricing step, additive loadings, the vehicle floor,
the income cap, and that the result is always a whole number of currency units.
