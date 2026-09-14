import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { productRouter } from '../modules/products/product.routes';
import { customerRouter } from '../modules/customers/customer.routes';
import { quotationRouter } from '../modules/quotations/quotation.routes';
import { documentRouter } from '../modules/documents/document.routes';
import { paymentRouter } from '../modules/payments/payment.routes';
import { webhookRouter } from '../modules/payments/webhook.routes';
import { policyRouter } from '../modules/policies/policy.routes';
import { notificationRouter } from '../modules/notifications/notification.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';

/** Single place where every module's router is mounted under /api. */
export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/customers', customerRouter);
apiRouter.use('/quotations', quotationRouter);
apiRouter.use('/documents', documentRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/webhooks', webhookRouter);
apiRouter.use('/policies', policyRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/dashboard', dashboardRouter);
