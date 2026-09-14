import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendCreated, sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import * as customerService from './customer.service';
import type { ListCustomersQuery } from './customer.validators';

const agentId = (req: Request): string => {
  if (!req.agent) throw AppError.unauthenticated();
  return req.agent.id;
};

export const createCustomer = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.createCustomer(agentId(req), req.body);
  return sendCreated(res, { customer });
});

export const listCustomers = asyncHandler(async (req: Request, res: Response) => {
  const { items, meta } = await customerService.listCustomers(
    agentId(req),
    req.query as unknown as ListCustomersQuery,
  );
  return sendSuccess(res, { customers: items }, 200, meta);
});

export const getCustomer = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.getCustomerById(agentId(req), req.params.id);
  return sendSuccess(res, { customer });
});

export const updateCustomer = asyncHandler(async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomer(agentId(req), req.params.id, req.body);
  return sendSuccess(res, { customer });
});

export const deleteCustomer = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.deleteCustomer(agentId(req), req.params.id);
  return sendSuccess(res, { deleted: true, ...result });
});

export const getEligibleProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await customerService.getEligibleProducts(agentId(req), req.params.id);
  return sendSuccess(res, result);
});
