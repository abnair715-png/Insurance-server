import type { Gender, VehicleType } from '../../config/constants';

/** The only customer facts the eligibility engine is allowed to see. Deriving
 *  this once keeps rules pure functions of a small, testable input. */
export interface CustomerProfile {
  age: number;
  gender: Gender;
  /** Minor currency units. */
  annualIncome: number;
  ownsVehicle: boolean;
  vehicleType?: VehicleType;
  vehicleValue?: number;
  smoker: boolean;
  preExistingConditions: boolean;
}

export interface EligibilityFailure {
  /** Stable machine-readable identifier for the rule that rejected the customer. */
  rule: string;
  /** Agent-facing explanation, shown next to the ineligible product in the UI. */
  message: string;
}

export interface ProductEligibility {
  eligible: boolean;
  failures: EligibilityFailure[];
}
