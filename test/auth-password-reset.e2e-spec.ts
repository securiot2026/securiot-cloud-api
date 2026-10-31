import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { MailService } from '../src/mail/mail.service';
import { PasswordResetToken } from '../src/auth/password-reset-token.entity';

const OLD_PASSWORD = 'OldPassw0rd!';
const NEW_PASSWORD = 'BrandNewPass1!';
const WEB_APP_URL = 'http://web.example.test:4200';
const TOKEN_RE = /\/reset-password\?token=([A-Za-z0-9_-]{43})/;

describe('Password reset (e2e)', () => {
  let app: INestApplication;
  let userRepo: Repository<User>;
  let tokenRepo: Repository<PasswordResetToken>;
  let sendSpy: jest.SpyInstance;
  let fetchSpy: jest.SpyInstance;
  let counter = 0;

  beforeAll(async () => {
    process.env.DB_DRIVER = 'sqlite';
    process.env.DB_SQLITE_PATH = ':memory:';
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.ADMIN_EMAIL = 'admin@example.test';
    process.env.WEB_APP_URL = WEB_APP_URL;
    process.env.RESEND_API_KEY = '';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    tokenRepo = moduleFixture.get<Repository<PasswordResetToken>>(getRepositoryToken(PasswordResetToken));

    sendSpy = jest.spyOn(moduleFixture.get(MailService, { strict: false }), 'send').mockResolvedValue(true);
    // Any accidental real send must fail loudly.
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('Unexpected real network call in e2e');
    });
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    await app.close();
  });

  beforeEach(() => {
    sendSpy.mockClear();
  });

  async function createUser(): Promise<User> {
    counter += 1;
    const passwordHash = await bcrypt.hash(OLD_PASSWORD, 10);
    return userRepo.save(userRepo.create({ email: `reset-${counter}@securiot.local`, passwordHash }));
  }

  async function waitFor<T>(fn: () => T | Promise<T>, predicate: (v: T) => boolean = Boolean): Promise<T> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const value = await fn();
      if (predicate(value)) return value;
      if (Date.now() > deadline) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  const forgot = (email: string) => request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email });
  const reset = (token: string, newPassword: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token, newPassword });
  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });

  async function requestToken(user: User): Promise<string> {
    const before = sendSpy.mock.calls.length;
    const res = await forgot(user.email);
    expect(res.status).toBe(202);
    await waitFor(() => sendSpy.mock.calls.length, (n) => n > before);
    const text: string = sendSpy.mock.calls[sendSpy.mock.calls.length - 1][0].text;
    const match = TOKEN_RE.exec(text);
    expect(match).not.toBeNull();
    return match![1];
  }

  it('tracer: forgot-password mails the admin, stores only the hash, reset changes the password, token is single use', async () => {
    const user = await createUser();

    const res = await forgot(user.email);
    expect(res.status).toBe(202);
    expect(typeof res.body.message).toBe('string');

    await waitFor(() => sendSpy.mock.calls.length, (n) => n === 1);
    const arg = sendSpy.mock.calls[0][0];
    expect(arg.to).toBe('admin@example.test');
    expect(arg.subject).toMatch(/contraseña/i);
    expect(arg.text).toContain(`${WEB_APP_URL}/reset-password?token=`);
    expect(arg.text).toContain(user.email);
    expect(arg.text).toContain('30 minutos');
    expect(arg.text).toMatch(/una vez/);
    const match = TOKEN_RE.exec(arg.text);
    expect(match).not.toBeNull();
    const token = match![1];

    const rows = await waitFor(
      () => tokenRepo.find({ where: { userId: user.id } }),
      (r) => r.length === 1,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(Object.values(row).map(String)).not.toContain(token);
    expect(row.usedAt).toBeNull();
    const delta = new Date(row.expiresAt).getTime() - Date.now();
    expect(Math.abs(delta - 30 * 60 * 1000)).toBeLessThan(60 * 1000);

    const resetRes = await reset(token, NEW_PASSWORD);
    expect(resetRes.status).toBe(200);
    expect(typeof resetRes.body.message).toBe('string');

    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
    const loginNew = await login(user.email, NEW_PASSWORD);
    expect(typeof loginNew.body.access_token).toBe('string');
    expect((await login(user.email, OLD_PASSWORD)).status).toBe(401);

    const reuse = await reset(token, 'AnotherPassw0rd!');
    expect(reuse.status).toBe(400);
    expect(reuse.body.code).toBe('invalid_reset_token');
  });
});
