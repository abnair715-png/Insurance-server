import { calculatePremium } from './premium.service';
import type { ProductDocument } from '../products/product.model';
import type { CustomerProfile } from '../eligibility/eligibility.types';
import { toMinorUnits } from '../../utils/money';
import { lakh } from '../../tests/helpers';

/** Minimal stand-in for a hydrated product — the calculator only reads these. */
const product = (overrides: Partial<ProductDocument> = {}) =>
  ({
    name: 'Test Cover',
    basePremium: toMinorUnits(10_000),
    coverageAmount: lakh(50),
    pricingFactors: {
      ageBands: [
        { minAge: 18, maxAge: 30, multiplier: 0.8 },
        { minAge: 31, maxAge: 60, multiplier: 1.5 },
      ],
      smokerLoadingPct: 50,
      preExistingLoadingPct: 20,
    },
    ...overrides,
  }) as ProductDocument;

const profile = (overrides: Partial<CustomerProfile> = {}): CustomerProfile => ({
  age: 35,
  gender: 'MALE',
  annualIncome: lakh(12),
  ownsVehicle: false,
  smoker: false,
  preExistingConditions: false,
  ...overrides,
});

describe('premiumService', () => {
  it('applies the matching age band multiplier', () => {
    const young = calculatePremium(product(), profile({ age: 25 }));
    const older = calculatePremium(product(), profile({ age: 35 }));

    expect(young.premiumAmount).toBe(toMinorUnits(8_000));
    expect(older.premiumAmount).toBe(toMinorUnits(15_000));
  });

  it('falls back to the base premium when no age band matches', () => {
    const result = calculatePremium(product(), profile({ age: 75 }));
    expect(result.premiumAmount).toBe(toMinorUnits(10_000));
  });

  it('adds declared-risk loadings additively rather than compounding them', () => {
    const result = calculatePremium(
      product(),
      profile({ age: 25, smoker: true, preExistingConditions: true }),
    );

    // 10,000 x 0.8 = 8,000, then +70% (50 + 20) = 13,600.
    // Compounding (x1.5 x 1.2) would give 14,400.
    expect(result.premiumAmount).toBe(toMinorUnits(13_600));
  });

  it('prices vehicle cover off the declared value when a rate is configured', () => {
    const vehicleProduct = product({
      basePremium: toMinorUnits(5_000),
      pricingFactors: { ageBands: [], vehicleValueRatePct: 3 },
    });

    const result = calculatePremium(
      vehicleProduct,
      profile({ ownsVehicle: true, vehicleValue: lakh(10) }),
    );

    // 3% of 10,00,000 = 30,000, which exceeds the 5,000 base floor.
    expect(result.premiumAmount).toBe(toMinorUnits(30_000));
  });

  it('keeps the base premium as a floor for low-value vehicles', () => {
    const vehicleProduct = product({
      basePremium: toMinorUnits(5_000),
      pricingFactors: { ageBands: [], vehicleValueRatePct: 3 },
    });

    const result = calculatePremium(
      vehicleProduct,
      profile({ ownsVehicle: true, vehicleValue: lakh(1) }),
    );

    expect(result.premiumAmount).toBe(toMinorUnits(5_000));
  });

  it('caps term cover at the configured multiple of annual income', () => {
    const termProduct = product({
      coverageAmount: lakh(100),
      pricingFactors: { ageBands: [], coverageIncomeMultiple: 10 },
    });

    const result = calculatePremium(termProduct, profile({ annualIncome: lakh(6) }));

    // 10 x 6,00,000 = 60,00,000, below the product's 1,00,00,000 headline cover.
    expect(result.coverageAmount).toBe(lakh(60));
  });

  it('never exceeds the product cover even for a high earner', () => {
    const termProduct = product({
      coverageAmount: lakh(100),
      pricingFactors: { ageBands: [], coverageIncomeMultiple: 10 },
    });

    const result = calculatePremium(termProduct, profile({ annualIncome: lakh(50) }));
    expect(result.coverageAmount).toBe(lakh(100));
  });

  it('returns a breakdown that explains the final figure', () => {
    const result = calculatePremium(product(), profile({ age: 25, smoker: true }));

    expect(result.breakdown[0].label).toBe('Base premium');
    expect(result.breakdown.map((step) => step.label)).toContain('Declared risk loading');
    expect(result.breakdown[result.breakdown.length - 1].amount).toBe(result.premiumAmount);
  });

  it('always produces a whole-currency-unit premium', () => {
    const odd = product({
      basePremium: 999_99,
      pricingFactors: { ageBands: [{ minAge: 18, maxAge: 99, multiplier: 1.0333 }] },
    });
    const result = calculatePremium(odd, profile());
    expect(result.premiumAmount % 100).toBe(0);
  });
});
