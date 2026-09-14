import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { DocumentModel, type DocumentRecord } from './document.model';
import { generateQuotationPdf, type GeneratedPdf } from './pdf.service';
import { QuotationModel, type QuotationDocument } from '../quotations/quotation.model';
import { advanceQuotationStatus, getOwnedQuotationDocument } from '../quotations/quotation.service';
import { AppError } from '../../utils/AppError';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { addHours } from '../../utils/dates';
import { generateDocumentReference } from '../../utils/references';
import { buildWhatsAppLink, quotationShareMessage } from '../../utils/whatsapp';

/**
 * Public link tokens are DERIVED, never stored.
 *
 *   token = base64url(HMAC-SHA256(DOCUMENT_LINK_SECRET, "<reference>:<version>"))
 *
 * Consequences:
 *   - a database dump contains nothing that yields a working link
 *   - the agent can re-open the share link on any later page load without a
 *     regenerate round-trip
 *   - incrementing `version` invalidates every link shared so far, which is how
 *     "regenerate" revokes a document sent to the wrong number
 */
function deriveToken(reference: string, version: number): string {
  return crypto
    .createHmac('sha256', env.DOCUMENT_LINK_SECRET)
    .update(`${reference}:${version}`)
    .digest('base64url');
}

function tokenMatches(reference: string, version: number, provided: string): boolean {
  const expected = Buffer.from(deriveToken(reference, version), 'utf8');
  const candidate = Buffer.from(provided, 'utf8');
  if (expected.length !== candidate.length) return false;
  return crypto.timingSafeEqual(expected, candidate);
}

export interface DocumentShareResult {
  document: Record<string, unknown>;
  /** Public, unauthenticated URL the customer can open from WhatsApp. */
  shareUrl: string;
  /** Pre-filled WhatsApp click-to-chat link for the agent to press send on. */
  whatsAppUrl: string;
  expiresAt: Date;
}

function buildShareResult(record: DocumentRecord, quotation: QuotationDocument): DocumentShareResult {
  const token = deriveToken(record.reference, record.version);
  // API_PUBLIC_URL, not CLIENT_URL: this link is served by THIS service. When
  // the SPA is deployed separately, pointing it at the SPA would 404.
  const shareUrl = `${env.API_PUBLIC_URL}/api/documents/public/${record.reference}?t=${token}`;
  const customerFirstName = quotation.customerSnapshot.fullName.split(' ')[0] || 'there';

  return {
    document: record.toJSON(),
    shareUrl,
    whatsAppUrl: buildWhatsAppLink(
      quotation.customerSnapshot.phone,
      quotationShareMessage({
        customerFirstName,
        productName: quotation.productSnapshot.name,
        companyName: env.COMPANY_NAME,
        documentUrl: shareUrl,
      }),
    ),
    expiresAt: record.expiresAt,
  };
}

/**
 * Generates — or regenerates — the quotation PDF record.
 *
 * The upsert on `quotationId` (backed by a unique index) means repeated clicks
 * update one document rather than creating several, and `$inc: { version }`
 * rotates the share link on every regeneration.
 */
export async function generateQuotationDocument(
  agentId: string,
  quotationId: string,
): Promise<DocumentShareResult> {
  const quotation = await getOwnedQuotationDocument(agentId, quotationId);

  const record = await DocumentModel.findOneAndUpdate(
    { quotationId: quotation._id },
    {
      $set: {
        expiresAt: addHours(new Date(), env.DOCUMENT_LINK_TTL_HOURS),
        generatedAt: new Date(),
        agentId: new mongoose.Types.ObjectId(agentId),
        customerId: quotation.customerId,
        type: 'QUOTATION',
      },
      $setOnInsert: { reference: generateDocumentReference() },
      $inc: { version: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await advanceQuotationStatus(quotation._id, 'DOCUMENT_GENERATED');

  logger.info('quotation document generated', {
    documentId: record.id,
    quotationId: quotation.id,
    version: record.version,
  });

  return buildShareResult(record, quotation);
}

/** Returns the existing document and a live share link, without rotating it. */
export async function getDocumentForQuotation(
  agentId: string,
  quotationId: string,
): Promise<DocumentShareResult> {
  const quotation = await getOwnedQuotationDocument(agentId, quotationId);
  const record = await DocumentModel.findOne({ quotationId: quotation._id });
  if (!record) throw AppError.notFound('Document');
  return buildShareResult(record, quotation);
}

/** Agent-authenticated download: renders the PDF fresh from the quotation. */
export async function renderQuotationPdfForAgent(
  agentId: string,
  quotationId: string,
): Promise<GeneratedPdf> {
  const quotation = await getOwnedQuotationDocument(agentId, quotationId);
  return generateQuotationPdf(quotation);
}

/**
 * Public download via a shared link. Three independent checks: the reference
 * must exist, the token must verify in constant time against the current
 * version, and the link must not have expired.
 */
export async function renderQuotationPdfForPublicLink(
  reference: string,
  token: string,
): Promise<GeneratedPdf> {
  const record = await DocumentModel.findOne({ reference });
  if (!record) throw AppError.notFound('Document');

  if (!tokenMatches(record.reference, record.version, token)) {
    throw AppError.forbidden('This document link is no longer valid.');
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw AppError.forbidden('This document link has expired. Please ask your agent for a new one.');
  }

  const quotation = await QuotationModel.findById(record.quotationId);
  if (!quotation) throw AppError.notFound('Quotation');

  return generateQuotationPdf(quotation);
}
