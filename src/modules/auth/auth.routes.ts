import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rateLimiter';
import { loginSchema, registerSchema } from './auth.validators';
import * as authController from './auth.controller';

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  authController.register,
);
authRouter.post('/login', authRateLimiter, validate({ body: loginSchema }), authController.login);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', requireAuth, authController.me);
