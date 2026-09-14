import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { publicDocumentRateLimiter } from '../../middleware/rateLimiter';
import { objectIdSchema } from '../../utils/validators';
import * as documentController from './document.controller';

export const documentRouter = Router();

const quotationParamSchema = z.object({ quotationId: objectIdSchema });
const referenceParamSchema = z.object({
  reference: z.string().regex(/^DOC-\d{4}-[0-9A-Z]{8}$/, 'Invalid document reference.'),
});

/**
 * Public route first, and deliberately BEFORE `requireAuth` is applied: this is
 * the link the customer opens from WhatsApp, and they have no account.
 * Authorisation comes from the HMAC token in the query string.
 */
documentRouter.get(
  '/public/:reference',
  publicDocumentRateLimiter,
  validate({ params: referenceParamSchema }),
  documentController.downloadPublicDocument,
);

documentRouter.use(requireAuth);

documentRouter.post(
  '/:quotationId/generate',
  validate({ params: quotationParamSchema }),
  documentController.generateDocument,
);
documentRouter.get(
  '/:quotationId',
  validate({ params: quotationParamSchema }),
  documentController.getDocument,
);
documentRouter.get(
  '/:quotationId/download',
  validate({ params: quotationParamSchema }),
  documentController.downloadDocument,
);
