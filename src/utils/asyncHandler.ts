import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not forward rejected promises to the error middleware, so every
 * async route handler is wrapped once here instead of repeating try/catch.
 */
export const asyncHandler =
  <T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req as T, res, next)).catch(next);
  };
