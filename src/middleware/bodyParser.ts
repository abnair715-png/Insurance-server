import express, { type RequestHandler } from 'express';
import { AppError } from '../utils/AppError';

const BODY_LIMIT = '1mb';

/**
 * JSON body parsing that preserves the raw bytes.
 *
 * Stripe signs the exact request body, so `stripe.webhooks.constructEvent` needs
 * the untouched buffer — a re-serialised object will not verify.
 *
 * On Render the app is an ordinary Node process, so the request stream reaches
 * Express untouched and `express.json`'s `verify` hook captures the buffer as it
 * parses. That is the path in use.
 *
 * The `req.rawBody`-already-present branch below covers a host that consumes the
 * stream before Express sees it (a serverless adapter, or a proxy that buffers).
 * Re-reading a drained stream yields an empty body, so when `rawBody` is already
 * set we parse from it and mark `_body` so no later parser touches the request.
 * Keeping it means the webhook stays correct if the deployment target changes.
 */
const jsonParser = express.json({
  limit: BODY_LIMIT,
  verify: (req, _res, buf) => {
    (req as express.Request).rawBody = Buffer.from(buf);
  },
});

export const jsonBodyParser: RequestHandler = (req, res, next) => {
  const raw = req.rawBody;

  if (!Buffer.isBuffer(raw)) {
    jsonParser(req, res, next);
    return;
  }

  // Mark the body as already consumed so any later parser is a no-op.
  (req as unknown as { _body: boolean })._body = true;

  if (raw.length === 0) {
    req.body = {};
    next();
    return;
  }

  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    req.body = {};
    next();
    return;
  }

  try {
    req.body = JSON.parse(raw.toString('utf8'));
    next();
  } catch {
    next(AppError.badRequest('Request body is not valid JSON.'));
  }
};
