import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Response } from 'express';
import { env, isProduction } from '../../config/env';
import { AUTH_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_MS } from '../../config/constants';
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
 * Session cookie policy.
 *
 * The token is delivered ONLY as an httpOnly cookie: JavaScript cannot read it,
 * so an XSS bug in the dashboard cannot exfiltrate a live session.
 *
 * `SameSite` is derived rather than hard-coded, because the correct value
 * depends on where the client is deployed:
 *
 *   - SAME host as the API (local dev behind the Vite proxy, or a combined
 *     deployment): `Lax`. It is not sent on cross-site requests, which is a
 *     free CSRF defence, and it works over plain http on localhost.
 *
 *   - DIFFERENT host (client on Vercel, API on Render): the browser treats the
 *     cookie as cross-site and will not attach it to `fetch` at all under `Lax`.
 *     `None` is the only value that works, and browsers reject `SameSite=None`
 *     unless `Secure` is also set — so it implies HTTPS.
 *
 * Getting this wrong is silent: login succeeds, the cookie is set, and every
 * subsequent request is 401 because the browser never sends it back.
 */
function resolveCookiePolicy(): { sameSite: 'lax' | 'none'; secure: boolean } {
  let sameHost = true;
  try {
    sameHost = new URL(env.CLIENT_URL).host === new URL(env.API_PUBLIC_URL).host;
  } catch {
    // Malformed config is already rejected at boot; assume the safer policy.
    sameHost = true;
  }

  if (sameHost) return { sameSite: 'lax', secure: isProduction };
  return { sameSite: 'none', secure: true };
}

/** Shared so the clear call matches the set call exactly — a cookie is only
 *  removed when name, path, domain, sameSite and secure all match. */
function cookieOptions() {
  const { sameSite, secure } = resolveCookiePolicy();
  return { httpOnly: true, secure, sameSite, path: '/' } as const;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...cookieOptions(),
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}

/** Exposed for the boot-time diagnostic in app.ts and for tests. */
export const describeCookiePolicy = resolveCookiePolicy;

