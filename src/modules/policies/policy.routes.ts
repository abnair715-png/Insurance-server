import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { idParamSchema } from '../../utils/validators';
import { listPoliciesQuerySchema } from './policy.validators';
import * as policyController from './policy.controller';

export const policyRouter = Router();

policyRouter.use(requireAuth);

policyRouter.get('/', validate({ query: listPoliciesQuerySchema }), policyController.listPolicies);
policyRouter.get('/:id', validate({ params: idParamSchema }), policyController.getPolicy);
