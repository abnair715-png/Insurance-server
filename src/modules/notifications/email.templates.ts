import { env } from '../../config/env';
import { formatMoneyPlain } from '../../utils/money';
import { formatDisplayDate } from '../../utils/dates';
import type { PolicyDocument } from '../policies/policy.model';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Inline styles and a table-free single column: the two things that survive
 * Gmail, Outlook and Apple Mail without a templating framework.
 */
export function renderPolicyActivatedEmail(policy: PolicyDocument): RenderedEmail {
  const firstName = policy.customerName.split(' ')[0] || 'there';
  const premium = formatMoneyPlain(policy.premiumAmount, policy.currency);
  const coverage = formatMoneyPlain(policy.coverageAmount, policy.currency);
  const startDate = formatDisplayDate(policy.startDate);
  const endDate = formatDisplayDate(policy.endDate);

  const subject = `Your ${policy.productName} policy is active — ${policy.policyNumber}`;

  const rows: [string, string][] = [
    ['Policy number', policy.policyNumber],
    ['Product', policy.productName],
    ['Sum assured', coverage],
    ['Premium paid', premium],
    ['Cover starts', startDate],
    ['Cover ends', endDate],
    ['Quotation reference', policy.quotationReference],
  ];

  const text = [
    `Hi ${firstName},`,
    '',
    `Your payment has been received and your ${policy.productName} policy is now active.`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    `If anything above looks wrong, reply to this email or call us on ${env.COMPANY_SUPPORT_PHONE}.`,
    '',
    `— ${env.COMPANY_NAME}`,
    '',
    'This confirmation relates to an illustration/MVP application and does not constitute a final insurance contract.',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="background:#1f47d6;padding:24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(env.COMPANY_NAME)}</div>
        <div style="color:#dce6ff;font-size:13px;margin-top:4px;">Policy confirmation</div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:15px;">Hi ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">
          We have received your payment and your <strong>${escapeHtml(policy.productName)}</strong>
          policy is now active. Here are your details:
        </p>
        <div style="border:1px solid #e5e7eb;border-radius:8px;">
          ${rows
            .map(
              ([label, value], index) => `
          <div style="display:flex;justify-content:space-between;padding:11px 16px;${
            index < rows.length - 1 ? 'border-bottom:1px solid #f3f4f6;' : ''
          }">
            <span style="font-size:13px;color:#6b7280;">${escapeHtml(label)}</span>
            <span style="font-size:13px;font-weight:bold;color:#111827;">${escapeHtml(value)}</span>
          </div>`,
            )
            .join('')}
        </div>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">
          If anything above looks wrong, reply to this email or call us on
          ${escapeHtml(env.COMPANY_SUPPORT_PHONE)}.
        </p>
      </div>
      <div style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6;">
        This confirmation relates to an illustration/MVP application and does not constitute a
        final insurance contract.
      </div>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}
