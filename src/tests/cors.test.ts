import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { parseOriginList } from '../utils/origins';

/**
 * CORS is the single most common way a split deployment breaks, so the allow-list
 * is exercised directly. The app is rebuilt per test because the allow-list is
 * computed once when `createApp()` runs.
 */
function appWithOrigins(clientUrl: string, additional = '') {
  const originalClient = env.CLIENT_URL;
  const originalOrigins = env.CLIENT_ORIGINS;
  const originalAdditional = env.CORS_ADDITIONAL_ORIGINS;

  const parsed = parseOriginList(clientUrl);
  (env as { CLIENT_URL: string }).CLIENT_URL = parsed[0];
  (env as { CLIENT_ORIGINS: string[] }).CLIENT_ORIGINS = parsed;
  (env as { CORS_ADDITIONAL_ORIGINS: string }).CORS_ADDITIONAL_ORIGINS = additional;

  // `createApp()` reads the allow-list from `env` when it runs, so rebuilding
  // the app is enough — no module reload needed.
  const app = createApp();

  return {
    app,
    restore() {
      (env as { CLIENT_URL: string }).CLIENT_URL = originalClient;
      (env as { CLIENT_ORIGINS: string[] }).CLIENT_ORIGINS = originalOrigins;
      (env as { CORS_ADDITIONAL_ORIGINS: string }).CORS_ADDITIONAL_ORIGINS = originalAdditional;
    },
  };
}

const allowHeader = (res: request.Response) => res.headers['access-control-allow-origin'];

describe('CORS allow-list', () => {
  it('allows every origin in a comma-separated CLIENT_URL', async () => {
    const { app, restore } = appWithOrigins('https://firsturl.com,https://secondurl.com');
    try {
      for (const origin of ['https://firsturl.com', 'https://secondurl.com']) {
        const res = await request(app).get('/api/health').set('Origin', origin).expect(200);
        expect(allowHeader(res)).toBe(origin);
      }
    } finally {
      restore();
    }
  });

  it('allows origins listed only in CORS_ADDITIONAL_ORIGINS', async () => {
    const { app, restore } = appWithOrigins(
      'https://firsturl.com',
      'https://secondurl.com,https://preview.vercel.app',
    );
    try {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://preview.vercel.app')
        .expect(200);
      expect(allowHeader(res)).toBe('https://preview.vercel.app');
    } finally {
      restore();
    }
  });

  it('refuses an origin that is on neither list', async () => {
    const { app, restore } = appWithOrigins('https://firsturl.com');
    try {
      const res = await request(app).get('/api/health').set('Origin', 'https://evil.example.com');
      // Denied by omitting the header, not by erroring: the browser blocks the
      // response, while curl and server-to-server callers are unaffected.
      expect(allowHeader(res)).toBeUndefined();
      expect(res.status).toBe(200);
    } finally {
      restore();
    }
  });

  it('matches despite a trailing slash or different casing in configuration', async () => {
    const { app, restore } = appWithOrigins('https://FirstURL.com/');
    try {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://firsturl.com')
        .expect(200);
      expect(allowHeader(res)).toBe('https://firsturl.com');
    } finally {
      restore();
    }
  });

  it('answers a credentialed preflight for an allowed origin', async () => {
    const { app, restore } = appWithOrigins('https://firsturl.com');
    try {
      const res = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'https://firsturl.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,authorization');

      expect(allowHeader(res)).toBe('https://firsturl.com');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      restore();
    }
  });

  it('allows requests with no Origin header at all', async () => {
    // curl, server-to-server, and the Stripe webhook all send none.
    const { app, restore } = appWithOrigins('https://firsturl.com');
    try {
      await request(app).get('/api/health').expect(200);
    } finally {
      restore();
    }
  });

  it('always allows the local dev server, whatever CLIENT_URL says', async () => {
    const { app, restore } = appWithOrigins('https://firsturl.com');
    try {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173')
        .expect(200);
      expect(allowHeader(res)).toBe('http://localhost:5173');
    } finally {
      restore();
    }
  });
});
