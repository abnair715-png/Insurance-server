import mongoose from 'mongoose';
import { z } from 'zod';

/** Rejects malformed ids at the edge so Mongoose never throws a CastError
 *  mid-service and a bad id is a clean 400 rather than a 500. */
export const objectIdSchema = z
  .string()
  .refine((value) => mongoose.Types.ObjectId.isValid(value), { message: 'Must be a valid id.' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Email is required.')
  .max(255)
  .email('Must be a valid email address.');

/**
 * E.164-style phone number. A country code is required because the WhatsApp
 * click-to-chat link (`wa.me/<number>`) will not resolve without one.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Must be a valid phone number including country code, e.g. +919876543210.');

/** Strips everything but digits — the exact format `wa.me` expects. */
export const normalisePhone = (phone: string): string => phone.replace(/\D/g, '');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter.')
  .regex(/\d/, 'Password must contain at least one number.');

export const nameSchema = z.string().trim().min(2, 'Must be at least 2 characters.').max(120);

/** Accepts an ISO date string or `YYYY-MM-DD` and coerces to a Date. */
export const pastDateSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine((date) => !Number.isNaN(date.getTime()), { message: 'Must be a valid date.' })
  .refine((date) => date < new Date(), { message: 'Must be a date in the past.' });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParamSchema = z.object({ id: objectIdSchema });
