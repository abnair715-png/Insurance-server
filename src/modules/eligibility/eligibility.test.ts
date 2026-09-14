import { buildCustomerProfile, evaluateEligibility } from './eligibility.service';
import type { CustomerProfile } from './eligibility.types';
import { lakh } from '../../tests/helpers';

/**
 * Unit tests for the rule engine. They run against plain objects — no database,
 * no HTTP — because the engine is the single source of truth for who may be
 * offered what, and it must be cheap to assert exhaustively.
 */
const baseProfile: CustomerProfile = {
  age: 32,
  gender: 'FEMALE',
  annualIncome: lakh(12),
  ownsVehicle: true,
  vehicleType: 'CAR',
  vehicleValue: lakh(9),
  smoker: false,
  preExistingConditions: false,
};

const profile = (overrides: Partial<CustomerProfile> = {}): CustomerProfile => ({
  ...baseProfile,
  ...overrides,
});

describe('eligibilityService', () => {
  it('treats a product with no configured rules as open to everyone', () => {
    expect(evaluateEligibility(profile(), {}).eligible).toBe(true);
    expect(evaluateEligibility(profile({ age: 19, ownsVehicle: false }), {}).eligible).toBe(true);
  });

  describe('age rules', () => {
    it('accepts a customer inside the entry-age band', () => {
      expect(evaluateEligibility(profile({ age: 32 }), { minAge: 18, maxAge: 60 }).eligible).toBe(true);
    });

    it('rejects a customer below the minimum age and explains why', () => {
      const result = evaluateEligibility(profile({ age: 17 }), { minAge: 18 });
      expect(result.eligible).toBe(false);
      expect(result.failures[0].rule).toBe('MIN_AGE');
      expect(result.failures[0].message).toContain('17');
    });

    it('rejects a customer above the maximum age', () => {
      const result = evaluateEligibility(profile({ age: 61 }), { maxAge: 60 });
      expect(result.eligible).toBe(false);
      expect(result.failures.map((f) => f.rule)).toEqual(['MAX_AGE']);
    });

    it('treats the band boundaries as inclusive', () => {
      expect(evaluateEligibility(profile({ age: 18 }), { minAge: 18, maxAge: 60 }).eligible).toBe(true);
      expect(evaluateEligibility(profile({ age: 60 }), { minAge: 18, maxAge: 60 }).eligible).toBe(true);
    });
  });

  describe('income rules', () => {
    it('rejects a customer below the income floor', () => {
      const result = evaluateEligibility(profile({ annualIncome: lakh(2) }), {
        minAnnualIncome: lakh(3),
      });
      expect(result.eligible).toBe(false);
      expect(result.failures[0].rule).toBe('MIN_ANNUAL_INCOME');
    });

    it('accepts a customer exactly at the income floor', () => {
      expect(
        evaluateEligibility(profile({ annualIncome: lakh(3) }), { minAnnualIncome: lakh(3) }).eligible,
      ).toBe(true);
    });
  });

  describe('vehicle rules', () => {
    it('rejects a customer with no vehicle for a vehicle product', () => {
      const result = evaluateEligibility(
        profile({ ownsVehicle: false, vehicleType: undefined, vehicleValue: undefined }),
        { requiresVehicle: true },
      );
      expect(result.eligible).toBe(false);
      expect(result.failures[0].rule).toBe('REQUIRES_VEHICLE');
    });

    it('rejects a vehicle of the wrong type', () => {
      const result = evaluateEligibility(profile({ vehicleType: 'TWO_WHEELER' }), {
        requiresVehicle: true,
        allowedVehicleTypes: ['CAR', 'COMMERCIAL'],
      });
      expect(result.eligible).toBe(false);
      expect(result.failures.map((f) => f.rule)).toContain('ALLOWED_VEHICLE_TYPE');
    });

    it('rejects a vehicle below the minimum insured value', () => {
      const result = evaluateEligibility(profile({ vehicleValue: lakh(0.5) }), {
        requiresVehicle: true,
        minVehicleValue: lakh(1),
      });
      expect(result.eligible).toBe(false);
      expect(result.failures.map((f) => f.rule)).toContain('MIN_VEHICLE_VALUE');
    });
  });

  describe('declared health rules', () => {
    it('excludes smokers when the product says so', () => {
      const result = evaluateEligibility(profile({ smoker: true }), { excludeSmokers: true });
      expect(result.eligible).toBe(false);
      expect(result.failures[0].rule).toBe('EXCLUDES_SMOKERS');
    });

    it('excludes declared pre-existing conditions when the product says so', () => {
      const result = evaluateEligibility(profile({ preExistingConditions: true }), {
        excludePreExistingConditions: true,
      });
      expect(result.eligible).toBe(false);
      expect(result.failures[0].rule).toBe('EXCLUDES_PRE_EXISTING');
    });
  });

  it('reports EVERY failing rule, not just the first', () => {
    const result = evaluateEligibility(
      profile({ age: 70, annualIncome: lakh(1), smoker: true, ownsVehicle: false, vehicleType: undefined }),
      {
        maxAge: 60,
        minAnnualIncome: lakh(3),
        excludeSmokers: true,
        requiresVehicle: true,
      },
    );

    expect(result.eligible).toBe(false);
    expect(result.failures.map((f) => f.rule).sort()).toEqual(
      ['EXCLUDES_SMOKERS', 'MAX_AGE', 'MIN_ANNUAL_INCOME', 'REQUIRES_VEHICLE'].sort(),
    );
  });

  describe('buildCustomerProfile', () => {
    it('derives age in completed years from the date of birth', () => {
      const asOf = new Date('2026-09-14T00:00:00Z');
      const result = buildCustomerProfile(
        {
          dateOfBirth: new Date('1994-09-15T00:00:00Z'),
          gender: 'MALE',
          annualIncome: lakh(10),
          vehicle: { owns: false },
          health: { smoker: false, preExistingConditions: false },
        },
        asOf,
      );
      // Birthday is one day away, so the customer is still 31.
      expect(result.age).toBe(31);
    });

    it('defaults missing vehicle and health sub-documents to safe values', () => {
      const result = buildCustomerProfile({
        dateOfBirth: new Date('1990-01-01T00:00:00Z'),
        gender: 'OTHER',
        annualIncome: 0,
        vehicle: undefined as never,
        health: undefined as never,
      });
      expect(result.ownsVehicle).toBe(false);
      expect(result.smoker).toBe(false);
      expect(result.preExistingConditions).toBe(false);
    });
  });
});
