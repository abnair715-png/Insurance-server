import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import * as policyService from './policy.service';

const agentId = (req: Request): string => {
  if (!req.agent) throw AppError.unauthenticated();
  return req.agent.id;
};

export const listPolicies = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await policyService.listPolicies(
    agentId(req),
    req.query as unknown as { page: number; limit: number; customerId?: string },
  );
  return sendSuccess(res, { policies: items }, 200, meta);
});

export const getPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policy = await policyService.getPolicyById(agentId(req), req.params.id);
  return sendSuccess(res, { policy });
});
