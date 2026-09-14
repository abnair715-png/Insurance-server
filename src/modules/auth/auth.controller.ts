import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import * as authService from './auth.service';
import { clearSessionCookie, setSessionCookie } from './token.service';

/**
 * Controllers stay thin: translate HTTP <-> domain, delegate to the service,
 * shape the response. No business rules, no database access.
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { agent, token } = await authService.registerAgent(req.body);
  setSessionCookie(res, token);
  // The token is also returned so non-browser clients (curl, Postman, the test
  // suite) can use Bearer auth. Browsers ignore it and rely on the cookie.
  return sendCreated(res, { agent, token });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { agent, token } = await authService.loginAgent(req.body);
  setSessionCookie(res, token);
  return sendSuccess(res, { agent, token });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearSessionCookie(res);
  return sendSuccess(res, { message: 'Signed out.' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.agent) throw AppError.unauthenticated();
  const agent = await authService.getAgentById(req.agent.id);
  return sendSuccess(res, { agent });
});
