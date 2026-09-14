import request from 'supertest';
import { env } from '../../config/env';
import { describeCookiePolicy } from './token.service';
import { authed, getApp, registerAgent, VALID_PASSWORD } from '../../tests/helpers';

/**
 * The session lives in an httpOnly cookie, and the `SameSite` value is derived
 * from whether the client and API share a host. Getting it wrong is the least
 * debuggable failure in the system: login succeeds, the cookie is set, and every
 * later request is 401 because the browser declines to send it back.
 */
function withUrls<T>(clientUrl: string, apiUrl: string, fn: () => T): T {
  const originalClient = env.CLIENT_URL;
  const originalApi = env.API_PUBLIC_URL;
  (env as { CLIENT_URL: string }).CLIENT_URL = clientUrl;
  (env as { API_PUBLIC_URL: string }).API_PUBLIC_URL = apiUrl;
  try {
    return fn();
  } finally {
    (env as { CLIENT_URL: string }).CLIENT_URL = originalClient;
    (env as { API_PUBLIC_URL: string }).API_PUBLIC_URL = originalApi;
  }
}

const sessionCookie = (res: request.Response): string =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
    c.startsWith('iap_session='),
  ) ?? '';

describe('Session cookie policy', () => {
  it('uses SameSite=Lax when the client and API share a host', () => {
    const policy = withUrls('https://example.com', 'https://example.com', describeCookiePolicy);
    expect(policy.sameSite).toBe('lax');
  });

  it('uses SameSite=None; Secure when they are on different hosts', () => {
    // A Lax cookie is simply not sent on a cross-site fetch, so None is the only
    // value that works — and browsers reject None without Secure.
    const policy = withUrls(
      'https://client.vercel.app',
      'https://api.onrender.com',
      describeCookiePolicy,
    );
    expect(policy).toEqual({ sameSite: 'none', secure: true });
  });

  it('treats a different port on the same hostname as a different host', () => {
    const policy = withUrls('http://localhost:5173', 'http://localhost:4000', describeCookiePolicy);
    expect(policy.sameSite).toBe('none');
  });
});

describe('Session cookie', () => {
  it('is set httpOnly on register, and carries the token', async () => {
    const res = await request(getApp())
      .post('/api/auth/register')
      .send({
        name: 'Cookie Agent',
        email: 'cookie.policy@example.com',
        password: VALID_PASSWORD,
        phone: '+919812345699',
      })
      .expect(201);

    const cookie = sessionCookie(res);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/iap_session=[^;]+/);
    // Not readable by JavaScript is the whole point — assert the flag is there
    // rather than assuming it.
    expect(cookie.toLowerCase()).toContain('httponly');
  });

  it('authenticates a subsequent request using only the cookie', async () => {
    const agent = request.agent(getApp());
    const email = `cookie.only.${Date.now()}@example.com`;

    await agent
      .post('/api/auth/register')
      .send({ name: 'Cookie Only', email, password: VALID_PASSWORD, phone: '+919812345698' })
      .expect(201);

    // No Authorization header anywhere — the cookie jar is doing the work.
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.agent.email).toBe(email);
  });

  it('clears the cookie on logout, so the session cannot be reused', async () => {
    const agent = request.agent(getApp());
    const email = `cookie.logout.${Date.now()}@example.com`;

    await agent
      .post('/api/auth/register')
      .send({ name: 'Cookie Logout', email, password: VALID_PASSWORD, phone: '+919812345697' })
      .expect(201);
    await agent.get('/api/auth/me').expect(200);

    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('still accepts a Bearer token, so curl and the test suite work', async () => {
    // The browser never uses this path, but dropping it would make every
    // documented curl example and most of this suite unusable.
    const { token, email } = await registerAgent();
    const res = await authed(token).get('/api/auth/me').expect(200);
    expect(res.body.data.agent.email).toBe(email);
  });
});
