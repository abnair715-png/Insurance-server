import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/apiResponse';
import { AppError } from '../../utils/AppError';
import type { GeneratedPdf } from './pdf.service';
import * as documentService from './document.service';

const agentId = (req: Request): string => {
  if (!req.agent) throw AppError.unauthenticated();
  return req.agent.id;
};

function streamPdf(res: Response, pdf: GeneratedPdf, disposition: 'inline' | 'attachment') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', pdf.buffer.length);
  res.setHeader('Content-Disposition', `${disposition}; filename="${pdf.filename}"`);
  // Quotation PDFs contain personal data: never let a shared cache keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf.buffer);
}

export const generateDocument = asyncHandler(async (req: Request, res: Response) => {
  const result = await documentService.generateQuotationDocument(
    agentId(req),
    req.params.quotationId,
  );
  return sendSuccess(res, result, 201);
});

export const getDocument = asyncHandler(async (req: Request, res: Response) => {
  const result = await documentService.getDocumentForQuotation(agentId(req), req.params.quotationId);
  return sendSuccess(res, result);
});

export const downloadDocument = asyncHandler(async (req: Request, res: Response) => {
  const pdf = await documentService.renderQuotationPdfForAgent(
    agentId(req),
    req.params.quotationId,
  );
  return streamPdf(res, pdf, 'inline');
});

/** Unauthenticated: reached from the WhatsApp link the customer received. */
export const downloadPublicDocument = asyncHandler(async (req: Request, res: Response) => {
  const token = typeof req.query.t === 'string' ? req.query.t : '';
  if (!token) throw AppError.forbidden('This document link is not valid.');

  const pdf = await documentService.renderQuotationPdfForPublicLink(req.params.reference, token);
  return streamPdf(res, pdf, 'inline');
});
