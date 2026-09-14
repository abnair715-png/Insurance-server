import type { AgentRole } from '../config/constants';

/** The authenticated principal attached by `requireAuth`. */
export interface AuthenticatedAgent {
  id: string;
  email: string;
  name: string;
  role: AgentRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Present only on routes behind `requireAuth`. */
      agent?: AuthenticatedAgent;
      /** Exact request bytes, preserved for Stripe webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}

export {};
