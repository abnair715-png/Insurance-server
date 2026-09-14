import { toMinorUnits } from '../utils/money';
import type { EligibilityRules, PricingFactors } from '../modules/products/product.model';
import type { ProductCategory, Gender, VehicleType } from '../config/constants';

/** Shorthand: seed figures are written in rupees and stored in paise. */
const rs = toMinorUnits;
const lakh = (value: number) => rs(value * 100_000);
const crore = (value: number) => rs(value * 10_000_000);

export interface SeedProduct {
  name: string;
  category: ProductCategory;
  description: string;
  basePremium: number;
  coverageAmount: number;
  keyBenefits: string[];
  eligibilityRules: EligibilityRules;
  pricingFactors: PricingFactors;
  active: boolean;
}

/**
 * A catalogue chosen so the demo customers below land on genuinely different
 * outcomes — some products eligible, some not, for explainable reasons.
 */
export const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'Term Life Plus',
    category: 'TERM',
    description:
      'Pure protection term cover that pays a lump sum to your nominee if something happens to you during the policy term. Designed for earning adults supporting a family.',
    basePremium: rs(11_400),
    coverageAmount: crore(1),
    keyBenefits: [
      'Sum assured of up to INR 1 crore payable to your nominee',
      'Fixed premium for the full policy term — no re-rating at renewal',
      'Terminal illness benefit paid in advance of the death benefit',
      'Tax benefit on premiums paid, subject to prevailing tax law',
    ],
    eligibilityRules: {
      minAge: 18,
      maxAge: 60,
      minAnnualIncome: lakh(3),
      excludeSmokers: false,
    },
    pricingFactors: {
      ageBands: [
        { minAge: 18, maxAge: 30, multiplier: 0.85 },
        { minAge: 31, maxAge: 40, multiplier: 1 },
        { minAge: 41, maxAge: 50, multiplier: 1.6 },
        { minAge: 51, maxAge: 60, multiplier: 2.4 },
      ],
      smokerLoadingPct: 45,
      preExistingLoadingPct: 25,
      coverageIncomeMultiple: 15,
    },
    active: true,
  },
  {
    name: 'Term Life Secure 65',
    category: 'TERM',
    description:
      'Extended-age term cover for customers who want protection beyond the standard entry age, typically to cover a loan or a dependent parent.',
    basePremium: rs(26_500),
    coverageAmount: crore(0.5),
    keyBenefits: [
      'Entry permitted up to age 65',
      'Sum assured of up to INR 50 lakh',
      'Option to convert to a reduced paid-up cover after 5 years',
    ],
    eligibilityRules: {
      minAge: 45,
      maxAge: 65,
      minAnnualIncome: lakh(5),
    },
    pricingFactors: {
      ageBands: [
        { minAge: 45, maxAge: 55, multiplier: 1 },
        { minAge: 56, maxAge: 65, multiplier: 1.75 },
      ],
      smokerLoadingPct: 55,
      preExistingLoadingPct: 35,
      coverageIncomeMultiple: 10,
    },
    active: true,
  },
  {
    name: 'Family Health Shield',
    category: 'HEALTH',
    description:
      'Comprehensive family floater hospitalisation cover including pre- and post-hospitalisation expenses, day-care procedures and an annual health check-up.',
    basePremium: rs(16_800),
    coverageAmount: lakh(10),
    keyBenefits: [
      'Family floater cover of INR 10 lakh per year',
      'Cashless treatment at network hospitals',
      '60 days pre- and 90 days post-hospitalisation expenses',
      'Annual preventive health check-up for every adult member',
    ],
    eligibilityRules: {
      minAge: 18,
      maxAge: 60,
      excludePreExistingConditions: true,
    },
    pricingFactors: {
      ageBands: [
        { minAge: 18, maxAge: 35, multiplier: 1 },
        { minAge: 36, maxAge: 45, multiplier: 1.35 },
        { minAge: 46, maxAge: 60, multiplier: 1.9 },
      ],
      smokerLoadingPct: 30,
    },
    active: true,
  },
  {
    name: 'Senior Health Protect',
    category: 'HEALTH',
    description:
      'Hospitalisation cover built for customers aged 55 and above, with pre-existing conditions accepted after a waiting period and no co-payment on day-care treatment.',
    basePremium: rs(32_000),
    coverageAmount: lakh(5),
    keyBenefits: [
      'Entry age 55 to 80 with lifetime renewability',
      'Pre-existing conditions covered after a 24-month waiting period',
      'Domiciliary hospitalisation and AYUSH treatment included',
      'Dedicated claims helpline for senior customers',
    ],
    eligibilityRules: {
      minAge: 55,
      maxAge: 80,
    },
    pricingFactors: {
      ageBands: [
        { minAge: 55, maxAge: 65, multiplier: 1 },
        { minAge: 66, maxAge: 80, multiplier: 1.55 },
      ],
      smokerLoadingPct: 25,
      preExistingLoadingPct: 40,
    },
    active: true,
  },
  {
    name: 'Vehicle Comprehensive Cover',
    category: 'VEHICLE',
    description:
      'Own-damage and third-party motor cover for private cars and commercial vehicles, including natural calamity, fire and theft protection.',
    basePremium: rs(6_500),
    coverageAmount: lakh(15),
    keyBenefits: [
      'Own damage plus mandatory third-party liability cover',
      'Cashless repair at authorised garages',
      '24x7 roadside assistance and towing',
      'No-claim bonus protection available at renewal',
    ],
    eligibilityRules: {
      minAge: 18,
      requiresVehicle: true,
      allowedVehicleTypes: ['CAR', 'COMMERCIAL'],
      minVehicleValue: lakh(1),
    },
    pricingFactors: {
      ageBands: [
        { minAge: 18, maxAge: 25, multiplier: 1.3 },
        { minAge: 26, maxAge: 60, multiplier: 1 },
        { minAge: 61, maxAge: 99, multiplier: 1.15 },
      ],
      vehicleValueRatePct: 3.2,
    },
    active: true,
  },
  {
    name: 'Two-Wheeler Shield',
    category: 'VEHICLE',
    description:
      'Comprehensive two-wheeler insurance covering own damage, theft and third-party liability, with an optional pillion-rider cover.',
    basePremium: rs(1_800),
    coverageAmount: lakh(2),
    keyBenefits: [
      'Own damage and third-party liability in one policy',
      'Personal accident cover for the owner-driver',
      'Instant digital policy issuance',
    ],
    eligibilityRules: {
      minAge: 18,
      requiresVehicle: true,
      allowedVehicleTypes: ['TWO_WHEELER'],
    },
    pricingFactors: {
      ageBands: [
        { minAge: 18, maxAge: 25, multiplier: 1.25 },
        { minAge: 26, maxAge: 99, multiplier: 1 },
      ],
      vehicleValueRatePct: 2.8,
    },
    active: true,
  },
  {
    name: 'Personal Accident Secure',
    category: 'OTHER',
    description:
      'Standalone personal accident cover paying a lump sum on accidental death or permanent disability, plus a weekly benefit during recovery.',
    basePremium: rs(2_400),
    coverageAmount: lakh(25),
    keyBenefits: [
      'Lump sum on accidental death or permanent total disability',
      'Weekly benefit for temporary total disability',
      'Worldwide cover, 24 hours a day',
    ],
    eligibilityRules: {
      minAge: 18,
      maxAge: 70,
    },
    pricingFactors: {
      ageBands: [
        { minAge: 18, maxAge: 45, multiplier: 1 },
        { minAge: 46, maxAge: 70, multiplier: 1.4 },
      ],
    },
    active: true,
  },
];

/**
 * Rewrites a seeded customer's address so demo mail lands in one inbox.
 *
 * Every customer must keep a DISTINCT address: `customers` has a unique index
 * on (createdByAgent, email), so pointing them all at the same mailbox address
 * would mean only one of them could exist. Plus-addressing solves both halves —
 * `you+ananya@gmail.com` and `you+rahul@gmail.com` are different addresses that
 * both deliver to `you@gmail.com`. Gmail, Outlook, Fastmail, Proton and Resend
 * all honour it.
 *
 * Returns the original address unchanged if `override` is not a usable email,
 * so a typo degrades to "no override" rather than corrupting the seed.
 */
export function overrideCustomerEmail(override: string, firstName: string, fallback: string): string {
  const trimmed = override.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1 || trimmed.includes(' ')) return fallback;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const tag = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');

  return `${local}+${tag}@${domain}`;
}

export interface SeedCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Years before "today" — keeps seeded ages stable no matter when it is run. */
  ageYears: number;
  gender: Gender;
  occupation: string;
  annualIncome: number;
  city: string;
  state: string;
  postalCode: string;
  vehicle: { owns: boolean; type?: VehicleType; value?: number; registrationYear?: number };
  health: { smoker: boolean; preExistingConditions: boolean };
  /** Why this customer is in the seed set — printed by the script. */
  note: string;
}

export const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    firstName: 'Ananya',
    lastName: 'Sharma',
    email: 'ananya.sharma@example.com',
    phone: '+919876543210',
    ageYears: 32,
    gender: 'FEMALE',
    occupation: 'Software Engineer',
    annualIncome: lakh(12),
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
    vehicle: { owns: true, type: 'CAR', value: lakh(9), registrationYear: 2021 },
    health: { smoker: false, preExistingConditions: false },
    note: 'The headline demo case: 32, INR 12 LPA, owns a car — eligible for term, health, vehicle and accident cover.',
  },
  {
    firstName: 'Rahul',
    lastName: 'Verma',
    email: 'rahul.verma@example.com',
    phone: '+919812345678',
    ageYears: 24,
    gender: 'MALE',
    occupation: 'Delivery Partner',
    annualIncome: lakh(2.4),
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411014',
    vehicle: { owns: true, type: 'TWO_WHEELER', value: lakh(1.1), registrationYear: 2023 },
    health: { smoker: true, preExistingConditions: false },
    note: 'Income below the term-cover threshold and a two-wheeler only — shows ineligibility reasons alongside the products that do apply.',
  },
  {
    firstName: 'Meera',
    lastName: 'Iyer',
    email: 'meera.iyer@example.com',
    phone: '+919900112233',
    ageYears: 61,
    gender: 'FEMALE',
    occupation: 'Retired Professor',
    annualIncome: lakh(6),
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600020',
    vehicle: { owns: false },
    health: { smoker: false, preExistingConditions: true },
    note: 'Senior with a declared pre-existing condition — qualifies for Senior Health Protect but not the standard family health plan.',
  },
  {
    firstName: 'Daniel',
    lastName: 'Fernandes',
    email: 'daniel.fernandes@example.com',
    phone: '+919845001122',
    ageYears: 45,
    gender: 'MALE',
    occupation: 'Logistics Business Owner',
    annualIncome: lakh(28),
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400051',
    vehicle: { owns: true, type: 'COMMERCIAL', value: lakh(22), registrationYear: 2020 },
    health: { smoker: true, preExistingConditions: false },
    note: 'High income, commercial vehicle, declared smoker — demonstrates the smoker loading in the premium breakdown.',
  },
];
