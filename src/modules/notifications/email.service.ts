import { env } from '../../config/env';
import { logger } from '../../config/logger';
import type { EmailProvider } from './email.provider';
import { ConsoleEmailProvider } from './providers/console.provider';
import { ResendEmailProvider } from './providers/resend.provider';

let provider: EmailProvider | null = null;

/** Lazily constructed and cached for the lifetime of the serverless instance. */
export function getEmailProvider(): EmailProvider {
  if (provider) return provider;

  if (env.RESEND_API_KEY) {
    provider = new ResendEmailProvider();
  } else {
    logger.warn('RESEND_API_KEY is not set — falling back to the console email provider.');
    provider = new ConsoleEmailProvider();
  }

  return provider;
}

/** Test seam: lets the suite assert on send calls without network access. */
export function setEmailProvider(next: EmailProvider | null) {
  provider = next;
}
