import request from 'supertest';
import { AgentModel } from '../agents/agent.model';
import { authed, getApp, registerAgent, VALID_PASSWORD } from '../../tests/helpers';

describe('Authentication', () => {
  describe('POST /api/auth/register', () => {
    it('creates an agent and never returns or stores the plaintext password', async () => {
      const response = await request(getApp())
        .post('/api/auth/register')
        .send({
          name: 'Priya Nair',
          email: 'priya.nair@example.com',
          password: VALID_PASSWORD,
          phone: '+919812345678',
        })
        .expect(201);

      expect(response.body.data.agent).toMatchObject({
        name: 'Priya Nair',
        email: 'priya.nair@example.com',
        role: 'AGENT',
      });
      expect(response.body.data.agent.password).toBeUndefined();
      expect(response.body.data.agent.passwordHash).toBeUndefined();

      const stored = await AgentModel.findOne({ email: 'priya.nair@example.com' }).select(
        '+passwordHash',
      );
      expect(stored?.passwordHash).toBeDefined();
      expect(stored?.passwordHash).not.toBe(VALID_PASSWORD);
      expect(stored?.passwordHash.startsWith('$2')).toBe(true);
    });

    it('sets an httpOnly session cookie', async () => {
      const response = await request(getApp())
        .post('/api/auth/register')
        .send({
          name: 'Cookie Agent',
          email: 'cookie.agent@example.com',
          password: VALID_PASSWORD,
          phone: '+919812345679',
        })
        .expect(201);

      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((cookie) => cookie.startsWith('iap_session=') && cookie.includes('HttpOnly'))).toBe(
        true,
      );
    });

    it('rejects a weak password with field-level detail', async () => {
      const response = await request(getApp())
        .post('/api/auth/register')
        .send({ name: 'Weak', email: 'weak@example.com', password: 'short', phone: '+919812345670' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(true);
    });

    it('cannot be used to self-assign a privileged role', async () => {
      const response = await request(getApp())
        .post('/api/auth/register')
        .send({
          name: 'Sneaky',
          email: 'sneaky@example.com',
          password: VALID_PASSWORD,
          phone: '+919812345671',
          role: 'ADMIN',
        })
        .expect(201);

      expect(response.body.data.agent.role).toBe('AGENT');
    });

    it('rejects a duplicate email with 409', async () => {
      const payload = {
        name: 'First',
        email: 'duplicate@example.com',
        password: VALID_PASSWORD,
        phone: '+919812345672',
      };
      await request(getApp()).post('/api/auth/register').send(payload).expect(201);

      const response = await request(getApp())
        .post('/api/auth/register')
        .send({ ...payload, name: 'Second', phone: '+919812345673' })
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  describe('POST /api/auth/login', () => {
    it('signs in with correct credentials', async () => {
      const { email } = await registerAgent();

      const response = await request(getApp())
        .post('/api/auth/login')
        .send({ email, password: VALID_PASSWORD })
        .expect(200);

      expect(response.body.data.token).toEqual(expect.any(String));
      expect(response.body.data.agent.email).toBe(email);
    });

    it('returns the same error for a wrong password and an unknown email', async () => {
      const { email } = await registerAgent();

      const wrongPassword = await request(getApp())
        .post('/api/auth/login')
        .send({ email, password: 'WrongPassword1' })
        .expect(401);

      const unknownEmail = await request(getApp())
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: VALID_PASSWORD })
        .expect(401);

      // Identical responses: the endpoint must not reveal which emails exist.
      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });
  });

  describe('Protected routes', () => {
    it('rejects a request with no credentials', async () => {
      const response = await request(getApp()).get('/api/auth/me').expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a tampered token', async () => {
      const { token } = await registerAgent();
      await request(getApp())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token.slice(0, -3)}abc`)
        .expect(401);
    });

    it('returns the current agent for a valid token', async () => {
      const { token, email } = await registerAgent();
      const response = await authed(token).get('/api/auth/me').expect(200);
      expect(response.body.data.agent.email).toBe(email);
    });
  });
});
