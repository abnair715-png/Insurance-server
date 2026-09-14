import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import { getDashboardStats } from './dashboard.service';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.agent) throw AppError.unauthenticated();
    return sendSuccess(res, await getDashboardStats(req.agent.id));
  }),
);
