import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import * as quotationService from './quotation.service';
import type { ListQuotationsQuery } from './quotation.validators';

const requireAgent = (req: Request) => {
  if (!req.agent) throw AppError.unauthenticated();
  return req.agent;
};

export const createQuotation = asyncHandler(async (req: Request, res: Response) => {
  const agent = requireAgent(req);
  const quotation = await quotationService.createOrGetQuotation(agent.id, agent.name, req.body);
  return sendCreated(res, { quotation });
});

export const listQuotations = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await quotationService.listQuotations(
    requireAgent(req).id,
    req.query as unknown as ListQuotationsQuery,
  );
  return sendSuccess(res, { quotations: items }, 200, meta);
});

export const getQuotation = asyncHandler(async (req: Request, res: Response) => {
  const quotation = await quotationService.getQuotationById(requireAgent(req).id, req.params.id);
  return sendSuccess(res, { quotation });
});
