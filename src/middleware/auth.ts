import type { RequestHandler } from 'express';
import { AUTH_COOKIE_NAME, type AgentRole } from '../config/constants';
import { AppError } from '../utils/AppError';
import { verifySessionToken } from '../modules/auth/token.service';

function extractToken(req: Parameters<RequestHandler>[0]): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

  // Bearer is also accepted so the API stays usable from curl/Postman and the
  // documented examples in docs/api-design.md work without a cookie jar.
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;

  return null;
}

/** Rejects the request unless a valid, unexpired session token is present. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = extractToken(req);
  if (!token) {
    next(AppError.unauthenticated());
    return;
  }

  try {
    const payload = verifySessionToken(token);
    req.agent = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role gate, layered on top of `requireAuth`. Only AGENT exists in the MVP, but
 * every route already declares the roles it accepts, so adding ADMIN later is a
 * one-line change per route rather than a refactor.
 */
export const requireRole =
  (...roles: AgentRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.agent) {
      next(AppError.unauthenticated());
      return;
    }
    if (!roles.includes(req.agent.role)) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
