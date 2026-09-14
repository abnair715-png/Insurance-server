import PDFDocument from 'pdfkit';
import { env } from '../../config/env';
import { formatMoneyPlain } from '../../utils/money';
import { formatDisplayDate } from '../../utils/dates';
import type { QuotationDocument } from '../quotations/quotation.model';

/**
 * PDF generation
 * --------------
 * PDFKit is used rather than an HTML-to-PDF renderer: it is pure JavaScript with
 * no Chromium dependency, which is what makes it viable inside a 30-second
 * Vercel function. The trade-off is that layout is imperative — see
 * docs/technical-decisions.md.
 *
 * Every value on the page comes from the quotation document. Nothing about the
 * customer is hardcoded.
 */

const PAGE_MARGIN = 44;
const BRAND = '#1F47D6';
const INK = '#111827';
const MUTED = '#6B7280';
const RULE = '#E5E7EB';

const CATEGORY_LABELS: Record<string, string> = {
  TERM: 'Term Life Insurance',
  HEALTH: 'Health Insurance',
  VEHICLE: 'Vehicle Insurance',
  OTHER: 'General Insurance',
};

const DISCLAIMER =
  'This document is for illustration/MVP purposes and does not constitute a final insurance contract.';

const ASSUMPTIONS = [
  'The premium shown is an annual premium for a 12-month policy term and is inclusive of all quoted loadings.',
  'Pricing is based on the details declared by the customer at the time of this quotation. Any correction to age, income, vehicle value or declared health information will re-rate the premium.',
  'Cover begins only once payment has been received and the policy has been activated by the insurer.',
  'This quotation is valid until the expiry date shown above and is subject to standard underwriting acceptance.',
];

export interface GeneratedPdf {
  buffer: Buffer;
  filename: string;
}

export async function generateQuotationPdf(quotation: QuotationDocument): Promise<GeneratedPdf> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: `Insurance Quotation ${quotation.reference}`,
      Author: env.COMPANY_NAME,
      Subject: quotation.productSnapshot.name,
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  renderHeader(doc, quotation);
  renderPartyDetails(doc, quotation);
  renderProductSummary(doc, quotation);
  renderPremiumBreakdown(doc, quotation);
  renderBenefits(doc, quotation);
  renderAssumptions(doc);
  renderFooter(doc, quotation);

  doc.end();
  const buffer = await finished;

  return { buffer, filename: `quotation-${quotation.reference}.pdf` };
}

function renderHeader(doc: PDFKit.PDFDocument, quotation: QuotationDocument) {
  const width = doc.page.width;

  doc.rect(0, 0, width, 84).fill(BRAND);

  doc
    .fillColor('#FFFFFF')
    .font('Helvetica-Bold')
    .fontSize(19)
    .text(env.COMPANY_NAME, PAGE_MARGIN, 24, { width: width - PAGE_MARGIN * 2 });

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#DCE6FF')
    .text('Personalised Insurance Quotation', PAGE_MARGIN, 48);

  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#FFFFFF')
    .text(quotation.reference, width / 2, 26, { width: width / 2 - PAGE_MARGIN, align: 'right' })
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#DCE6FF')
    .text(`Generated ${formatDisplayDate(new Date())}`, width / 2, 42, {
      width: width / 2 - PAGE_MARGIN,
      align: 'right',
    })
    .text(`Valid until ${formatDisplayDate(quotation.expiresAt)}`, width / 2, 56, {
      width: width / 2 - PAGE_MARGIN,
      align: 'right',
    });

  doc.y = 108;
}

/**
 * Vector shapes ignore page margins but text does not: PDFKit silently pushes
 * text past the bottom margin onto a new page, which would leave a drawn box
 * empty on one page and its text on the next. Every block that draws a shape
 * therefore reserves its height first.
 */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN) {
    doc.addPage();
    doc.y = PAGE_MARGIN;
  }
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  ensureSpace(doc, 34);
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text(title.toUpperCase(), PAGE_MARGIN);
  const y = doc.y + 2;
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(0.75)
    .strokeColor(RULE)
    .stroke();
  doc.y = y + 7;
}

/** Two-column label/value grid used for the customer and agent blocks. */
function detailGrid(doc: PDFKit.PDFDocument, rows: [string, string][], columns = 2) {
  const usable = doc.page.width - PAGE_MARGIN * 2;
  const columnWidth = usable / columns;
  const rows_ = Math.ceil(rows.length / columns);
  ensureSpace(doc, rows_ * 28);

  const startY = doc.y;
  let maxY = startY;

  rows.forEach(([label, value], index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = PAGE_MARGIN + column * columnWidth;
    const y = startY + row * 28;

    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), x, y, {
      width: columnWidth - 12,
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(INK)
      .text(value || '—', x, y + 11, { width: columnWidth - 12 });

    maxY = Math.max(maxY, y + 26);
  });

  doc.y = maxY;
}

function renderPartyDetails(doc: PDFKit.PDFDocument, quotation: QuotationDocument) {
  const { customerSnapshot: customer } = quotation;
  sectionTitle(doc, 'Prepared for');
  detailGrid(doc, [
    ['Customer name', customer.fullName],
    ['Age', `${customer.age} years`],
    ['Email', customer.email],
    ['Phone', customer.phone],
    ['Location', `${customer.city}, ${customer.state}`],
    ['Quotation reference', quotation.reference],
  ]);
}

function renderProductSummary(doc: PDFKit.PDFDocument, quotation: QuotationDocument) {
  sectionTitle(doc, 'Your cover');

  ensureSpace(doc, 140);
  const boxTop = doc.y;
  const boxWidth = doc.page.width - PAGE_MARGIN * 2;

  doc.roundedRect(PAGE_MARGIN, boxTop, boxWidth, 88, 6).fillAndStroke('#F5F8FF', RULE);

  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor(INK)
    .text(quotation.productSnapshot.name, PAGE_MARGIN + 16, boxTop + 12, { width: boxWidth - 32 });

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(
      CATEGORY_LABELS[quotation.productSnapshot.category] ?? quotation.productSnapshot.category,
      PAGE_MARGIN + 16,
      boxTop + 31,
    );

  const half = boxWidth / 2;
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text('SUM ASSURED', PAGE_MARGIN + 16, boxTop + 52);
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(INK)
    .text(
      formatMoneyPlain(quotation.coverageAmount, quotation.currency),
      PAGE_MARGIN + 16,
      boxTop + 64,
    );

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor(MUTED)
    .text('ANNUAL PREMIUM', PAGE_MARGIN + half, boxTop + 52);
  doc
    .font('Helvetica-Bold')
    .fontSize(15)
    .fillColor(BRAND)
    .text(
      formatMoneyPlain(quotation.premiumAmount, quotation.currency),
      PAGE_MARGIN + half,
      boxTop + 64,
    );

  doc.y = boxTop + 96;

  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(quotation.productSnapshot.description, PAGE_MARGIN, doc.y, {
      width: boxWidth,
      lineGap: 1.5,
    });
}

function renderPremiumBreakdown(doc: PDFKit.PDFDocument, quotation: QuotationDocument) {
  if (!quotation.premiumBreakdown?.length) return;

  sectionTitle(doc, 'How this premium was calculated');

  const boxWidth = doc.page.width - PAGE_MARGIN * 2;
  const amountX = doc.page.width - PAGE_MARGIN - 110;

  quotation.premiumBreakdown.forEach((step, index) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(step.label, PAGE_MARGIN, y, {
      width: amountX - PAGE_MARGIN - 10,
    });
    if (step.detail) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(MUTED)
        .text(step.detail, PAGE_MARGIN, doc.y + 1, {
          width: amountX - PAGE_MARGIN - 10,
          lineGap: 1,
        });
    }
    doc
      .font(index === quotation.premiumBreakdown.length - 1 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(INK)
      .text(formatMoneyPlain(step.amount, quotation.currency), amountX, y, {
        width: 110,
        align: 'right',
      });

    const lineY = doc.y + 7;
    doc
      .moveTo(PAGE_MARGIN, lineY)
      .lineTo(PAGE_MARGIN + boxWidth, lineY)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.y = lineY + 7;
  });
}

function renderBenefits(doc: PDFKit.PDFDocument, quotation: QuotationDocument) {
  const benefits = quotation.productSnapshot.keyBenefits ?? [];
  if (!benefits.length) return;

  sectionTitle(doc, 'Key benefits');

  benefits.forEach((benefit) => {
    const y = doc.y;
    doc.circle(PAGE_MARGIN + 3, y + 5, 2).fill(BRAND);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(INK)
      .text(benefit, PAGE_MARGIN + 14, y, {
        width: doc.page.width - PAGE_MARGIN * 2 - 14,
        lineGap: 1.5,
      });
    doc.moveDown(0.22);
  });
}

function renderAssumptions(doc: PDFKit.PDFDocument) {
  sectionTitle(doc, 'Important assumptions');

  ASSUMPTIONS.forEach((assumption, index) => {
    const y = doc.y;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`${index + 1}.`, PAGE_MARGIN, y, { width: 14 });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(assumption, PAGE_MARGIN + 16, y, {
        width: doc.page.width - PAGE_MARGIN * 2 - 16,
        lineGap: 0.5,
      });
    doc.moveDown(0.2);
  });
}

function renderFooter(doc: PDFKit.PDFDocument, quotation: QuotationDocument) {
  // Adviser block (2 rows) plus the disclaimer box must stay together.
  ensureSpace(doc, 132);
  sectionTitle(doc, 'Your adviser');
  detailGrid(doc, [
    ['Agent', quotation.agentName],
    ['Support', env.COMPANY_SUPPORT_EMAIL],
    ['Helpline', env.COMPANY_SUPPORT_PHONE],
    ['Document generated', formatDisplayDate(new Date())],
  ]);

  const boxWidth = doc.page.width - PAGE_MARGIN * 2;
  doc.moveDown(0.5);
  ensureSpace(doc, 46);

  const y = doc.y;
  doc.roundedRect(PAGE_MARGIN, y, boxWidth, 42, 4).fillAndStroke('#FFF7ED', '#FED7AA');
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor('#9A3412')
    .text('DISCLAIMER', PAGE_MARGIN + 12, y + 9);
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor('#7C2D12')
    .text(DISCLAIMER, PAGE_MARGIN + 12, y + 21, { width: boxWidth - 24, lineBreak: false });
}
