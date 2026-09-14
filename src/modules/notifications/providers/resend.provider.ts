import { Resend } from 'resend';
import { env } from '../../../config/env';
import type { EmailMessage, EmailProvider, EmailSendResult } from '../email.provider';

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly client: Resend;

  constructor(apiKey: string = env.RESEND_API_KEY) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { data, error } = await this.client.emails.send({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    // The SDK reports failures in the response rather than by throwing, so the
    // error has to be raised explicitly for the retry/logging path to see it.
    if (error) {
      throw new Error(`${error.name}: ${error.message}`);
    }

    return { id: data?.id };
  }
}
