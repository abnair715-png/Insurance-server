import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema, phoneSchema } from '../../utils/validators';

/**
 * `role` is deliberately absent: it is assigned by the server. Because
 * `validate` replaces the body with the parse result, a client sending
 * `{"role":"ADMIN"}` has that field stripped before it reaches the service.
 */
export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: login must not leak the password policy, and an old
  // account whose password predates the current rules must still be able to
  // sign in.
  password: z.string().min(1, 'Password is required.'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
