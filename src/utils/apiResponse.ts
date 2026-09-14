import type { Response } from 'express';

/**
 * Every successful response has the same envelope:
 *   { "success": true, "data": <payload>, "meta"?: <pagination etc.> }
 * Every failure has:
 *   { "success": false, "error": { "code", "message", "details"? } }
 * A single shape keeps the React API client simple and the contract documented
 * in one place (docs/api-design.md).
 */
export interface ResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  [key: string]: unknown;
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200, meta?: ResponseMeta) {
  return res.status(statusCode).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function sendCreated<T>(res: Response, data: T) {
  return sendSuccess(res, data, 201);
}

export function sendNoContent(res: Response) {
  return res.status(204).send();
}
