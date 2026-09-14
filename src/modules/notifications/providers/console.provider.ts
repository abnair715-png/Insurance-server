import { logger } from '../../../config/logger';
import type { EmailMessage, EmailProvider, EmailSendResult } from '../email.provider';

/**
 * Fallback used when RESEND_API_KEY is not configured. It logs the message
 * instead of delivering it, which keeps the whole payment -> activation ->
 * notification flow demonstrable locally without an email account, and makes
 * the test suite deterministic.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    logger.info('email (console provider — not delivered)', {
      to: message.to,
      subject: message.subject,
      body: message.text,
    });
    return { id: `console-${Date.now()}` };
  }
}
