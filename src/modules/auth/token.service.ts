import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isProduction } from '../../config/env';
import { AUTH_COOKIE_NAME } from '../../config/constants';
import type { AgentRole } from '../../config/constants';
import { AppError } from '../../utils/AppError';

export interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: AgentRole;
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'insurance-agent-platform',
  } as SignOptions);
}

export function verifySessionToken(token: string): SessionPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: 'insurance-agent-platform',
    }) as SessionPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthenticated('Your session has expired. Please sign in again.');
    }
    throw AppError.unauthenticated('Invalid session. Please sign in again.');
  }
}

/**
 * The session token is delivered as an httpOnly cookie rather than a body field
 * the client stores in localStorage: JavaScript cannot read it, so an XSS bug
 * in the dashboard cannot exfiltrate a long-lived credential. Client and API
 * share one origin (Vite proxy in dev, same Vercel domain in production), so
 * `SameSite=Lax` is enough and no CSRF-prone cross-site POST is possible.
 */
export function setSessionCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
  });
}
