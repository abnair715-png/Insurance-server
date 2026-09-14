import type { EligibilityRules } from '../products/product.model';
import type { CustomerDocument } from '../customers/customer.model';
import { calculateAge } from '../../utils/dates';
import { formatMoney } from '../../utils/money';
import type { CustomerProfile, EligibilityFailure, ProductEligibility } from './eligibility.types';

/**
 * Eligibility engine
 * ------------------
 * The single place in the system that decides whether a customer may be offered
 * a product. Controllers, the quotation service and the UI all consult this —
 * none of them re-implement any part of it.
 *
 * Design:
 *   - Each rule is an independent, pure predicate over (profile, rules).
 *   - A rule that the product does not configure is skipped, not failed.
 *   - ALL rules are evaluated even after the first failure, so the agent sees
 *     every reason a customer does not qualify rather than discovering them one
 *     at a time.
 * Documented in docs/eligibility-rules.md.
 */

interface Rule {
  id: string;
  /** Whether this product configures the rule at all. */
  configured: (rules: EligibilityRules) => boolean;
  /** `true` when the customer satisfies the rule. */
  satisfied: (profile: CustomerProfile, rules: EligibilityRules) => boolean;
  explain: (profile: CustomerProfile, rules: EligibilityRules) => string;
}

const RULES: Rule[] = [
  {
    id: 'MIN_AGE',
    configured: (r) => r.minAge !== undefined,
    satisfied: (p, r) => p.age >= r.minAge!,
    explain: (p, r) => `Minimum entry age is ${r.minAge}; the customer is ${p.age}.`,
  },
  {
    id: 'MAX_AGE',
    configured: (r) => r.maxAge !== undefined,
    satisfied: (p, r) => p.age <= r.maxAge!,
    explain: (p, r) => `Maximum entry age is ${r.maxAge}; the customer is ${p.age}.`,
  },
  {
    id: 'MIN_ANNUAL_INCOME',
    configured: (r) => r.minAnnualIncome !== undefined,
    satisfied: (p, r) => p.annualIncome >= r.minAnnualIncome!,
    explain: (_p, r) => `Requires a minimum annual income of ${formatMoney(r.minAnnualIncome!)}.`,
  },
  {
    id: 'MAX_ANNUAL_INCOME',
    configured: (r) => r.maxAnnualIncome !== undefined,
    satisfied: (p, r) => p.annualIncome <= r.maxAnnualIncome!,
    explain: (_p, r) =>
      `Only available to customers with an annual income up to ${formatMoney(r.maxAnnualIncome!)}.`,
  },
  {
    id: 'ALLOWED_GENDER',
    configured: (r) => Boolean(r.allowedGenders?.length),
    satisfied: (p, r) => r.allowedGenders!.includes(p.gender),
    explain: (_p, r) => `Only available to: ${r.allowedGenders!.join(', ')}.`,
  },
  {
    id: 'REQUIRES_VEHICLE',
    configured: (r) => r.requiresVehicle === true,
    satisfied: (p) => p.ownsVehicle,
    explain: () => 'The customer does not own a vehicle.',
  },
  {
    id: 'ALLOWED_VEHICLE_TYPE',
    configured: (r) => Boolean(r.allowedVehicleTypes?.length),
    satisfied: (p, r) => Boolean(p.vehicleType && r.allowedVehicleTypes!.includes(p.vehicleType)),
    explain: (_p, r) => `Covers these vehicle types only: ${r.allowedVehicleTypes!.join(', ')}.`,
  },
  {
    id: 'MIN_VEHICLE_VALUE',
    configured: (r) => r.minVehicleValue !== undefined,
    satisfied: (p, r) => (p.vehicleValue ?? 0) >= r.minVehicleValue!,
    explain: (_p, r) => `Requires a vehicle valued at ${formatMoney(r.minVehicleValue!)} or more.`,
  },
  {
    id: 'MAX_VEHICLE_VALUE',
    configured: (r) => r.maxVehicleValue !== undefined,
    satisfied: (p, r) => (p.vehicleValue ?? 0) <= r.maxVehicleValue!,
    explain: (_p, r) => `Covers vehicles valued up to ${formatMoney(r.maxVehicleValue!)}.`,
  },
  {
    id: 'EXCLUDES_SMOKERS',
    configured: (r) => r.excludeSmokers === true,
    satisfied: (p) => !p.smoker,
    explain: () => 'Not available to customers who have declared they smoke.',
  },
  {
    id: 'EXCLUDES_PRE_EXISTING',
    configured: (r) => r.excludePreExistingConditions === true,
    satisfied: (p) => !p.preExistingConditions,
    explain: () => 'Not available to customers with declared pre-existing conditions.',
  },
];

/** Projects a customer document onto the minimal profile the rules operate on. */
export function buildCustomerProfile(
  customer: Pick<
    CustomerDocument,
    'dateOfBirth' | 'gender' | 'annualIncome' | 'vehicle' | 'health'
  >,
  asOf: Date = new Date(),
): CustomerProfile {
  return {
    age: calculateAge(customer.dateOfBirth, asOf),
    gender: customer.gender,
    annualIncome: customer.annualIncome,
    ownsVehicle: customer.vehicle?.owns ?? false,
    vehicleType: customer.vehicle?.type,
    vehicleValue: customer.vehicle?.value,
    smoker: customer.health?.smoker ?? false,
    preExistingConditions: customer.health?.preExistingConditions ?? false,
  };
}

export function evaluateEligibility(
  profile: CustomerProfile,
  rules: EligibilityRules = {},
): ProductEligibility {
  const failures: EligibilityFailure[] = [];

  for (const rule of RULES) {
    if (!rule.configured(rules)) continue;
    if (rule.satisfied(profile, rules)) continue;
    failures.push({ rule: rule.id, message: rule.explain(profile, rules) });
  }

  return { eligible: failures.length === 0, failures };
}

/** Exposed for documentation and tests: the complete rule vocabulary. */
export const SUPPORTED_RULES = RULES.map((rule) => rule.id);
