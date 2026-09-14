import type { ProductDocument } from '../products/product.model';
import type { CustomerProfile } from '../eligibility/eligibility.types';
import { formatMoneyPlain, roundToWholeUnits } from '../../utils/money';

/**
 * Premium calculation
 * -------------------
 * The premium is derived ENTIRELY on the server from the stored product and the
 * stored customer. No amount is ever accepted from the client, so a tampered
 * request cannot reduce what Stripe charges.
 *
 * The steps are deliberately linear and each one is recorded in `breakdown`, so
 * the same explanation appears on the quotation screen and on the PDF.
 */

export interface PremiumStep {
  label: string;
  /** Running amount after this step, in minor currency units. */
  amount: number;
  detail?: string;
}

export interface PremiumQuote {
  /** Annual premium payable, minor currency units. */
  premiumAmount: number;
  /** Sum assured for this specific customer, minor currency units. */
  coverageAmount: number;
  breakdown: PremiumStep[];
}

const DEFAULT_MULTIPLIER = 1;

function ageMultiplier(product: ProductDocument, age: number): { multiplier: number; band?: string } {
  const band = product.pricingFactors?.ageBands?.find((b) => age >= b.minAge && age <= b.maxAge);
  if (!band) return { multiplier: DEFAULT_MULTIPLIER };
  return { multiplier: band.multiplier, band: `${band.minAge}-${band.maxAge}` };
}

export function calculatePremium(product: ProductDocument, profile: CustomerProfile): PremiumQuote {
  const factors = product.pricingFactors ?? { ageBands: [] };
  const breakdown: PremiumStep[] = [];

  // 1. Starting amount. Vehicle cover is priced off the declared asset value
  //    when a rate is configured, with the catalogue base premium as a floor.
  let amount = product.basePremium;
  breakdown.push({ label: 'Base premium', amount, detail: product.name });

  if (factors.vehicleValueRatePct && profile.vehicleValue) {
    const valueBased = Math.round((profile.vehicleValue * factors.vehicleValueRatePct) / 100);
    amount = Math.max(product.basePremium, valueBased);
    breakdown.push({
      label: 'Vehicle value rating',
      amount,
      // formatMoneyPlain, not formatMoney: this string is rendered into the PDF,
      // whose built-in font has no glyph for the rupee sign.
      detail: `${factors.vehicleValueRatePct}% of declared value ${formatMoneyPlain(profile.vehicleValue)}`,
    });
  }

  // 2. Age band loading.
  const { multiplier, band } = ageMultiplier(product, profile.age);
  if (multiplier !== DEFAULT_MULTIPLIER) {
    amount = Math.round(amount * multiplier);
    breakdown.push({
      label: 'Age band adjustment',
      amount,
      detail: `Age ${profile.age} (band ${band}) × ${multiplier}`,
    });
  }

  // 3. Declared-risk loadings, applied additively so two loadings do not compound.
  const loadings: number[] = [];
  if (profile.smoker && factors.smokerLoadingPct) loadings.push(factors.smokerLoadingPct);
  if (profile.preExistingConditions && factors.preExistingLoadingPct) {
    loadings.push(factors.preExistingLoadingPct);
  }
  if (loadings.length > 0) {
    const totalLoadingPct = loadings.reduce((sum, pct) => sum + pct, 0);
    amount = Math.round(amount * (1 + totalLoadingPct / 100));
    breakdown.push({
      label: 'Declared risk loading',
      amount,
      detail: `+${totalLoadingPct}% (${[
        profile.smoker && factors.smokerLoadingPct ? 'smoker' : null,
        profile.preExistingConditions && factors.preExistingLoadingPct ? 'pre-existing conditions' : null,
      ]
        .filter(Boolean)
        .join(', ')})`,
    });
  }

  // 4. Round to whole currency units — quoted premiums are never fractional.
  const premiumAmount = roundToWholeUnits(amount);
  if (premiumAmount !== amount) {
    breakdown.push({ label: 'Rounded to whole units', amount: premiumAmount });
  }

  // 5. Cover. Term products cap the sum assured at a multiple of annual income
  //    so the quotation cannot exceed a realistic underwriting limit.
  let coverageAmount = product.coverageAmount;
  if (factors.coverageIncomeMultiple && profile.annualIncome > 0) {
    const incomeCap = profile.annualIncome * factors.coverageIncomeMultiple;
    coverageAmount = Math.min(product.coverageAmount, incomeCap);
  }

  return { premiumAmount, coverageAmount, breakdown };
}
