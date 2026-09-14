export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  /** Provider-side message id, stored for support lookups. */
  id?: string;
}

/**
 * Provider abstraction.
 *
 * Everything above this interface (the notification service, the webhook) knows
 * only `send`. Swapping Resend for SES or Postmark is a new implementation plus
 * one line in `getEmailProvider` — no caller changes.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
