import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Phase 1 e2e — real Postgres + Redis (local dev). Covers the full auth
 * surface: signup/login, JWT guard, refresh rotation, OTP, RBAC, logout.
 * Run with: npm test  (requires local pg + redis, like the dev server).
 */
describe('SSC Prep Hub API (e2e)', () => {
  let app: INestApplication;
  const email = `e2e_${Date.now()}@example.com`;
  const password = 'TestPass123!';
  const fullName = 'E2E Tester';
  const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'admin@sscprephub.in';
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'ChangeMeInProduction123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is public', () => {
    return request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  describe('Auth', () => {
    let accessToken = '';
    let refreshToken = '';
    let sessionId = '';

    it('rejects signup with short password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password: 'short', fullName })
        .expect(400);
    });

    it('signs up a new user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password, fullName })
        .expect(201);
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.role).toBe('STUDENT');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
      sessionId = res.body.sessionId;
    });

    it('rejects duplicate signup', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email, password, fullName })
        .expect(409);
    });

    it('rejects login with wrong password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPass999!' })
        .expect(401);
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password, platform: 'WEB', deviceId: 'e2e-device' })
        .expect(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('protects /users/me (no token → 401)', () => {
      return request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    });

    it('protects /users/me (garbage token → 401)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('returns profile with valid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.email).toBe(email);
      expect(res.body.role).toBe('STUDENT');
    });

    it('rotates refresh tokens (old token unusable after refresh)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // Old token must now be rejected.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      refreshToken = res.body.refreshToken;
    });

    it('logs out and revokes the refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('OTP login', () => {
    const otpEmail = `otp_${Date.now()}@example.com`;

    it('requests an OTP (dev mode returns devOtp)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/otp/request')
        .send({ email: otpEmail })
        .expect(200);
      expect(res.body.sent).toBe(true);
    });

    it('rejects a wrong OTP', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/otp/verify')
        .send({ email: otpEmail, otp: '000000' })
        .expect(401);
    });
  });

  describe('RBAC', () => {
    it('student cannot list another user sessions (403)', async () => {
      const signup = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: `rbac_${Date.now()}@example.com`, password, fullName })
        .expect(201);
      const token = signup.body.accessToken;
      const victim = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: `victim_${Date.now()}@example.com`, password, fullName })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/api/v1/users/${victim.body.user.id}/sessions`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('admin can list user sessions (200)', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: adminPassword })
        .expect(200);
      const victim = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ email: `adm_${Date.now()}@example.com`, password, fullName })
        .expect(201);
      await request(app.getHttpServer())
        .get(`/api/v1/users/${victim.body.user.id}/sessions`)
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
    });
  });
});
