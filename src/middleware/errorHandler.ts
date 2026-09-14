import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError, type ErrorCode, type FieldIssue } from '../utils/AppError';
import { isProduction } from '../config/env';
import { logger } from '../config/logger';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} does not exist.`));
};

interface NormalisedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: FieldIssue[];
  /** Unexpected errors are logged at error level with their stack. */
  unexpected: boolean;
}

function normalise(error: unknown): NormalisedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      unexpected: false,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      })),
      unexpected: false,
    };
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: Object.values(error.errors).map((e) => ({ field: e.path, message: e.message })),
      unexpected: false,
    };
  }

  if (error instanceof mongoose.Error.CastError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: `Invalid value for '${error.path}'.`,
      unexpected: false,
    };
  }

  // Duplicate key: surfaces as 409 with the offending field, never the raw driver message.
  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? 'field';
    return {
      statusCode: 409,
      code: 'CONFLICT',
      message: `A record with this ${humanise(field)} already exists.`,
      details: [{ field, message: 'Must be unique.' }],
      unexpected: false,
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Please try again.',
    unexpected: true,
  };
}

interface DuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

export function isDuplicateKeyError(error: unknown): error is DuplicateKeyError {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

const humanise = (field: string) =>
  field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toLowerCase())
    .trim();

/**
 * Centralised error handler — the single place that turns a thrown value into an
 * HTTP response. Internal details (stack traces, driver messages) are logged but
 * never sent to the client in production.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { statusCode, code, message, details, unexpected } = normalise(error);

  const logMeta = {
    method: req.method,
    path: req.originalUrl.split('?')[0],
    statusCode,
    code,
    agentId: req.agent?.id,
  };

  if (unexpected) {
    logger.error('unhandled error', {
      ...logMeta,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } else if (statusCode >= 500) {
    logger.error(message, logMeta);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details?.length ? { details } : {}),
      // Stack traces are a development affordance only.
      ...(!isProduction && unexpected && error instanceof Error ? { stack: error.stack } : {}),
    },
  });
};
