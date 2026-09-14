import type { RequestHandler } from 'express';
import { logger } from '../config/logger';

/** One line per request with method, path, status and duration. Deliberately
 *  does not log bodies or headers: they carry passwords and session cookies. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const meta = {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      agentId: req.agent?.id,
    };
    if (res.statusCode >= 500) logger.error('request failed', meta);
    else if (res.statusCode >= 400) logger.warn('request rejected', meta);
    else logger.info('request', meta);
  });

  next();
};
