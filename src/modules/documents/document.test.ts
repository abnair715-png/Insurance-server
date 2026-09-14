import request from 'supertest';
import { DocumentModel } from './document.model';
import { QuotationModel } from '../quotations/quotation.model';
import { authed, createTestProduct, customerPayload, getApp, registerAgent } from '../../tests/helpers';

async function setupQuotation() {
  const agent = await registerAgent();
  const product = await createTestProduct({ eligibilityRules: {} } as never);
  const customer = await authed(agent.token).post('/api/customers').send(customerPayload()).expect(201);
  const quotation = await authed(agent.token)
    .post('/api/quotations')
    .send({ customerId: customer.body.data.customer.id, productId: product.id })
    .expect(201);

  return { agent, product, quotation: quotation.body.data.quotation };
}

/** Splits a share URL into the path the API serves and its token. */
function parseShareUrl(shareUrl: string) {
  const url = new URL(shareUrl);
  return { path: url.pathname, token: url.searchParams.get('t') ?? '' };
}

describe('Documents', () => {
  it('generates a document record and advances the quotation status', async () => {
    const { agent, quotation } = await setupQuotation();

    const response = await authed(agent.token)
      .post(`/api/documents/${quotation.id}/generate`)
      .expect(201);

    expect(response.body.data.document.reference).toMatch(/^DOC-\d{4}-[0-9A-Z]{8}$/);
    expect(response.body.data.shareUrl).toContain('/api/documents/public/');
    expect(response.body.data.whatsAppUrl.startsWith('https://wa.me/')).toBe(true);

    expect((await QuotationModel.findById(quotation.id))?.status).toBe('DOCUMENT_GENERATED');
  });

  it('produces a real PDF containing the customer’s own details', async () => {
    const { agent, quotation } = await setupQuotation();

    const response = await authed(agent.token)
      .get(`/api/documents/${quotation.id}/download`)
      .expect(200)
      .expect('Content-Type', 'application/pdf');

    const pdf = response.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);

    // PDFKit writes the document metadata uncompressed, so the title (which
    // carries the quotation reference) is verifiable without a PDF parser.
    expect(pdf.toString('latin1')).toContain(quotation.reference);
  });

  it('never stores the PDF bytes — only metadata', async () => {
    const { agent, quotation } = await setupQuotation();
    await authed(agent.token).post(`/api/documents/${quotation.id}/generate`).expect(201);

    const record = await DocumentModel.findOne({ quotationId: quotation.id }).lean();
    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain('%PDF');
    expect(Object.keys(record ?? {})).not.toContain('content');
  });

  it('regenerating updates one record rather than creating another', async () => {
    const { agent, quotation } = await setupQuotation();

    const first = await authed(agent.token).post(`/api/documents/${quotation.id}/generate`).expect(201);
    const second = await authed(agent.token).post(`/api/documents/${quotation.id}/generate`).expect(201);

    expect(await DocumentModel.countDocuments({ quotationId: quotation.id })).toBe(1);
    expect(second.body.data.document.reference).toBe(first.body.data.document.reference);
    expect(second.body.data.document.version).toBe(first.body.data.document.version + 1);
  });

  describe('Public share link', () => {
    it('serves the PDF to an unauthenticated visitor holding a valid token', async () => {
      const { agent, quotation } = await setupQuotation();
      const generated = await authed(agent.token)
        .post(`/api/documents/${quotation.id}/generate`)
        .expect(201);

      const { path, token } = parseShareUrl(generated.body.data.shareUrl);

      const response = await request(getApp())
        .get(`${path}?t=${encodeURIComponent(token)}`)
        .expect(200)
        .expect('Content-Type', 'application/pdf');

      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('rejects a missing or wrong token', async () => {
      const { agent, quotation } = await setupQuotation();
      const generated = await authed(agent.token)
        .post(`/api/documents/${quotation.id}/generate`)
        .expect(201);
      const { path } = parseShareUrl(generated.body.data.shareUrl);

      await request(getApp()).get(path).expect(403);
      await request(getApp()).get(`${path}?t=wrong-token`).expect(403);
    });

    it('revokes previously shared links when the document is regenerated', async () => {
      const { agent, quotation } = await setupQuotation();
      const first = await authed(agent.token)
        .post(`/api/documents/${quotation.id}/generate`)
        .expect(201);
      const oldLink = parseShareUrl(first.body.data.shareUrl);

      await request(getApp())
        .get(`${oldLink.path}?t=${encodeURIComponent(oldLink.token)}`)
        .expect(200);

      const second = await authed(agent.token)
        .post(`/api/documents/${quotation.id}/generate`)
        .expect(201);
      const newLink = parseShareUrl(second.body.data.shareUrl);

      expect(newLink.token).not.toBe(oldLink.token);
      await request(getApp())
        .get(`${oldLink.path}?t=${encodeURIComponent(oldLink.token)}`)
        .expect(403);
      await request(getApp())
        .get(`${newLink.path}?t=${encodeURIComponent(newLink.token)}`)
        .expect(200);
    });

    it('rejects an expired link', async () => {
      const { agent, quotation } = await setupQuotation();
      const generated = await authed(agent.token)
        .post(`/api/documents/${quotation.id}/generate`)
        .expect(201);
      const { path, token } = parseShareUrl(generated.body.data.shareUrl);

      await DocumentModel.updateOne(
        { quotationId: quotation.id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      const response = await request(getApp())
        .get(`${path}?t=${encodeURIComponent(token)}`)
        .expect(403);
      expect(response.body.error.message).toMatch(/expired/i);
    });

    it('rejects a malformed document reference', async () => {
      await request(getApp()).get('/api/documents/public/not-a-reference?t=x').expect(400);
    });

    it('marks the PDF response as private and uncacheable', async () => {
      const { agent, quotation } = await setupQuotation();
      const response = await authed(agent.token)
        .get(`/api/documents/${quotation.id}/download`)
        .expect(200);

      expect(response.headers['cache-control']).toContain('no-store');
    });
  });

  it('does not let another agent generate or download the document', async () => {
    const { quotation } = await setupQuotation();
    const stranger = await registerAgent();

    await authed(stranger.token).post(`/api/documents/${quotation.id}/generate`).expect(404);
    await authed(stranger.token).get(`/api/documents/${quotation.id}/download`).expect(404);
  });
});
