import { z } from 'zod';
import { GENDERS, VEHICLE_TYPES } from '../../config/constants';
import {
  emailSchema,
  nameSchema,
  paginationSchema,
  pastDateSchema,
  phoneSchema,
} from '../../utils/validators';
import { calculateAge } from '../../utils/dates';

const MIN_CUSTOMER_AGE = 18;
const MAX_CUSTOMER_AGE = 100;

const vehicleSchema = z
  .object({
    owns: z.boolean(),
    type: z.enum(VEHICLE_TYPES).optional(),
    /** Declared value in minor currency units (paise). */
    value: z.number().int().nonnegative().max(10_000_000_000).optional(),
    registrationYear: z
      .number()
      .int()
      .min(1950)
      .max(new Date().getFullYear() + 1)
      .optional(),
  })
  .superRefine((vehicle, ctx) => {
    if (!vehicle.owns) return;
    if (!vehicle.type) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'Vehicle type is required when the customer owns a vehicle.' });
    }
    if (vehicle.value === undefined || vehicle.value <= 0) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Vehicle value is required when the customer owns a vehicle.' });
    }
  });

const healthSchema = z.object({
  smoker: z.boolean(),
  preExistingConditions: z.boolean(),
});

const baseCustomerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  dateOfBirth: pastDateSchema.refine(
    (date) => {
      const age = calculateAge(date);
      return age >= MIN_CUSTOMER_AGE && age <= MAX_CUSTOMER_AGE;
    },
    { message: `Customer must be between ${MIN_CUSTOMER_AGE} and ${MAX_CUSTOMER_AGE} years old.` },
  ),
  gender: z.enum(GENDERS),
  occupation: z.string().trim().min(2).max(120),
  /** Annual income in minor currency units (paise). Every monetary value in
   *  this API is an integer in minor units — see docs/api-design.md. */
  annualIncome: z.number().int().nonnegative().max(100_000_000_000),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9\s-]{4,12}$/, 'Must be a valid postal code.'),
  vehicle: vehicleSchema.default({ owns: false }),
  health: healthSchema.default({ smoker: false, preExistingConditions: false }),
});

export const createCustomerSchema = baseCustomerSchema;
/** PUT semantics with partial payloads: any subset of fields may be sent. */
export const updateCustomerSchema = baseCustomerSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field must be provided.' },
);

export const listCustomersQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
