import { normalisePhone } from './validators';

/**
 * WhatsApp click-to-chat
 * ----------------------
 * This application does NOT send WhatsApp messages. It builds a `wa.me` deep
 * link that opens WhatsApp (web or desktop) on the agent's own machine with the
 * recipient and message pre-filled; the agent presses send. That needs no
 * WhatsApp Business API account, no Meta business verification and no message
 * templates — see docs/technical-decisions.md.
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const recipient = normalisePhone(phone);
  return `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`;
}

export function quotationShareMessage(params: {
  customerFirstName: string;
  productName: string;
  companyName: string;
  documentUrl: string;
}): string {
  return [
    `Hi ${params.customerFirstName}, here is your personalised insurance quotation for ${params.productName}.`,
    '',
    params.documentUrl,
    '',
    `The PDF has your cover amount, premium and key benefits. Happy to walk you through it — just reply here.`,
    `— ${params.companyName}`,
  ].join('\n');
}

export function paymentShareMessage(params: {
  customerFirstName: string;
  productName: string;
  companyName: string;
  amountLabel: string;
  paymentUrl: string;
}): string {
  return [
    `Hi ${params.customerFirstName}, you can complete the payment of ${params.amountLabel} for your ${params.productName} policy here:`,
    '',
    params.paymentUrl,
    '',
    'Your cover starts as soon as the payment is confirmed, and you will get an email confirmation.',
    `— ${params.companyName}`,
  ].join('\n');
}
