/** Machine-readable error codes returned to the client as `error.code`. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface FieldIssue {
  field: string;
  message: string;
}

/**
 * The only error type controllers and services should throw deliberately.
 * Anything else reaching the error handler is treated as an unexpected 500 and
 * its message is not surfaced to the client.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: FieldIssue[];
  /** `true` marks an error we raised on purpose and whose message is safe to show. */
  readonly isOperational = true;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(message: string, details?: FieldIssue[]) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthenticated(message = 'Authentication required.') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(resource = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${resource} not found.`);
  }

  static conflict(message: string) {
    return new AppError(409, 'CONFLICT', message);
  }

  /** 422: the request was well-formed but violates a domain rule. */
  static businessRule(message: string) {
    return new AppError(422, 'BUSINESS_RULE_VIOLATION', message);
  }

  static serviceUnavailable(message: string) {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
}
