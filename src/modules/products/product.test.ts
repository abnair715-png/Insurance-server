import request from 'supertest';
import { authed, createTestProduct, getApp, registerAgent } from '../../tests/helpers';

describe('Products', () => {
  it('requires authentication', async () => {
    await request(getApp()).get('/api/products').expect(401);
  });

  it('returns products from the database, not a hardcoded list', async () => {
    const { token } = await registerAgent();
    const created = await createTestProduct({ name: 'Database Sourced Cover' } as never);

    const response = await authed(token).get('/api/products').expect(200);

    expect(response.body.data.products).toHaveLength(1);
    expect(response.body.data.products[0]).toMatchObject({
      id: created.id,
      name: 'Database Sourced Cover',
    });
  });

  it('hides inactive products from the catalogue by default', async () => {
    const { token } = await registerAgent();
    await createTestProduct({ name: 'Live Product' } as never);
    await createTestProduct({ name: 'Withdrawn Product', active: false } as never);

    const response = await authed(token).get('/api/products').expect(200);
    expect(response.body.data.products.map((p: { name: string }) => p.name)).toEqual(['Live Product']);

    const withInactive = await authed(token).get('/api/products?includeInactive=true').expect(200);
    expect(withInactive.body.data.products).toHaveLength(2);
  });

  it('filters by category', async () => {
    const { token } = await registerAgent();
    await createTestProduct({ name: 'A Term Plan', category: 'TERM' } as never);
    await createTestProduct({ name: 'A Health Plan', category: 'HEALTH' } as never);

    const response = await authed(token).get('/api/products?category=HEALTH').expect(200);
    expect(response.body.data.products).toHaveLength(1);
    expect(response.body.data.products[0].category).toBe('HEALTH');
  });

  it('rejects an unknown category with a validation error', async () => {
    const { token } = await registerAgent();
    const response = await authed(token).get('/api/products?category=SPACESHIP').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('paginates and reports totals', async () => {
    const { token } = await registerAgent();
    await Promise.all([
      createTestProduct({ name: 'Plan A' } as never),
      createTestProduct({ name: 'Plan B' } as never),
      createTestProduct({ name: 'Plan C' } as never),
    ]);

    const response = await authed(token).get('/api/products?page=1&limit=2').expect(200);
    expect(response.body.data.products).toHaveLength(2);
    expect(response.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('treats a regex metacharacter in search as a literal', async () => {
    const { token } = await registerAgent();
    await createTestProduct({ name: 'Plan (Premium)' } as never);

    // An unescaped "(" would make this an invalid regex and a 500.
    const response = await authed(token).get('/api/products?search=Plan (Prem').expect(200);
    expect(response.body.data.products).toHaveLength(1);
  });

  it('returns 404 for an unknown product id', async () => {
    const { token } = await registerAgent();
    await authed(token).get('/api/products/507f1f77bcf86cd799439011').expect(404);
  });

  it('returns 400, not 500, for a malformed product id', async () => {
    const { token } = await registerAgent();
    await authed(token).get('/api/products/not-a-valid-id').expect(400);
  });
});
