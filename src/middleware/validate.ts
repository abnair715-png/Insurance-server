import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../utils/AppError';

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validation runs before any controller or service, so business logic can rely
 * on well-typed, already-coerced input. The parsed result replaces the raw
 * value, which also strips unknown keys — a client cannot smuggle extra fields
 * (e.g. `role: "ADMIN"` or `premiumAmount`) into a create call.
 */
export const validate = (schemas: ValidationSchemas): RequestHandler => {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // req.query has only a getter in Express 5; assigning per-key keeps this
        // forward-compatible and works identically on Express 4.
        const parsed = schemas.query.parse(req.query);
        Object.keys(req.query).forEach((key) => delete (req.query as Record<string, unknown>)[key]);
        Object.assign(req.query, parsed);
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          AppError.badRequest(
            'Request validation failed.',
            error.issues.map((issue) => ({
              field: issue.path.join('.') || '(body)',
              message: issue.message,
            })),
          ),
        );
        return;
      }
      next(error);
    }
  };
};
