import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { MailService } from '../src/mail/mail.service';
import { PasswordResetToken } from '../src/auth/password-reset-token.entity';
import { PasswordResetRateLimiter } from '../src/auth/password-reset-rate-limiter';

const OLD_PASSWORD = 'OldPassw0rd!';
const NEW_PASSWORD = 'BrandNewPass1!';
const WEB_APP_URL = 'http://web.example.test:4200';
const TOKEN_RE = /\/reset-password\?token=([A-Za-z0-9_-]{43})/;

describe('Password reset (e2e)', () => {
  let app: INestApplication;
  let userRepo: Repository<User>;
  let tokenRepo: Repository<PasswordResetToken>;
  let sendSpy: jest.SpyInstance;
  let realSend: MailService['send'];
  let limiter: PasswordResetRateLimiter;
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

    const mailService = moduleFixture.get(MailService, { strict: false });
    realSend = mailService.send.bind(mailService);
    limiter = moduleFixture.get(PasswordResetRateLimiter, { strict: false });
    sendSpy = jest.spyOn(mailService, 'send').mockResolvedValue(true);
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
    fetchSpy.mockClear();
    // Every request in this file shares one client IP and would exhaust the 5 and 10 budgets.
    limiter.reset();
  });

  afterEach(() => {
    process.env.ADMIN_EMAIL = 'admin@example.test';
    process.env.RESEND_API_KEY = '';
    process.env.MAIL_DEV_LOG = '';
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

  describe('enumeration safety', () => {
    it('answers the same 202 body for unknown and known emails, with no mail and no token for the unknown one', async () => {
      const user = await createUser();
      const tokensBefore = await tokenRepo.count();
      const known = await forgot(user.email);
      const unknownEmail = 'nobody-here@securiot.local';
      const unknown = await forgot(unknownEmail);

      expect(unknown.status).toBe(202);
      expect(known.status).toBe(202);
      expect(unknown.body).toEqual(known.body);

      await waitFor(() => sendSpy.mock.calls.length, (n) => n >= 1);
      await new Promise((r) => setTimeout(r, 100));
      expect(sendSpy).toHaveBeenCalledTimes(1);
      const unknownUser = await userRepo.findOne({ where: { email: unknownEmail } });
      expect(unknownUser).toBeNull();
      // Exactly one new row in total: the known account's. The unknown email created none.
      expect(await tokenRepo.count()).toBe(tokensBefore + 1);
      expect(await tokenRepo.count({ where: { userId: user.id } })).toBe(1);
    });

    it('still answers 202 promptly when MailService.send never resolves', async () => {
      const user = await createUser();
      sendSpy.mockImplementationOnce(() => new Promise<boolean>(() => undefined));
      const started = Date.now();
      const res = await forgot(user.email);
      expect(res.status).toBe(202);
      expect(Date.now() - started).toBeLessThan(1500);
    });
  });

  describe('token lifecycle', () => {
    it('rejects an expired token, keeps the old password valid, and uses one identical 400 body for unknown, expired and used tokens', async () => {
      const user = await createUser();
      const expiredToken = await requestToken(user);
      await tokenRepo.update({ userId: user.id }, { expiresAt: new Date(Date.now() - 1000) });

      const expired = await reset(expiredToken, NEW_PASSWORD);
      expect(expired.status).toBe(400);
      expect(expired.body.code).toBe('invalid_reset_token');
      expect((await login(user.email, OLD_PASSWORD)).status).toBe(200);

      const unknown = await reset('x'.repeat(43), NEW_PASSWORD);

      const freshToken = await requestToken(user);
      expect((await reset(freshToken, NEW_PASSWORD)).status).toBe(200);
      const used = await reset(freshToken, NEW_PASSWORD);

      expect(unknown.status).toBe(400);
      expect(used.status).toBe(400);
      expect(unknown.body).toEqual(expired.body);
      expect(used.body).toEqual(expired.body);
    });

    it('invalidates older tokens when a new reset is requested', async () => {
      const user = await createUser();
      const first = await requestToken(user);
      const second = await requestToken(user);

      const firstTry = await reset(first, NEW_PASSWORD);
      expect(firstTry.status).toBe(400);
      expect(firstTry.body.code).toBe('invalid_reset_token');
      expect((await reset(second, NEW_PASSWORD)).status).toBe(200);
    });

    it('rejects a 9 character password without consuming the token', async () => {
      const user = await createUser();
      const token = await requestToken(user);

      const short = await reset(token, '123456789');
      expect(short.status).toBe(400);
      expect(JSON.stringify(short.body.message)).toContain('newPassword');
      expect(short.body.code).toBeUndefined();

      expect((await reset(token, NEW_PASSWORD)).status).toBe(200);
    });

    it('limits the new password to 72 BYTES, not characters (multibyte password)', async () => {
      const user = await createUser();
      const token = await requestToken(user);

      const multibyte = 'ñ'.repeat(40); // 40 characters, 80 bytes
      expect(multibyte.length).toBeLessThanOrEqual(72);
      const tooLong = await reset(token, multibyte);
      expect(tooLong.status).toBe(400);
      expect(JSON.stringify(tooLong.body.message)).toContain('newPassword');
      expect(JSON.stringify(tooLong.body.message)).toContain('72 bytes');
      expect(tooLong.body.code).toBeUndefined();

      const exactly72 = 'ñ'.repeat(36); // 72 bytes
      expect((await reset(token, exactly72)).status).toBe(200);
    });
  });

  describe('rate limits', () => {
    it('answers 429 with Retry-After on the sixth forgot-password for the same email', async () => {
      const email = 'limited-email@securiot.local';
      for (let i = 0; i < 5; i += 1) {
        expect((await forgot(email)).status).toBe(202);
      }
      const sixth = await forgot(email);
      expect(sixth.status).toBe(429);
      expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
      expect(sixth.body).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many requests, try again later',
      });
    });

    it('answers 429 on the sixth forgot-password from one IP with six different emails', async () => {
      for (let i = 0; i < 5; i += 1) {
        expect((await forgot(`ip-limited-${i}@securiot.local`)).status).toBe(202);
      }
      const sixth = await forgot('ip-limited-5@securiot.local');
      expect(sixth.status).toBe(429);
      expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('answers 429 on the eleventh reset-password from one IP', async () => {
      for (let i = 0; i < 10; i += 1) {
        expect((await reset('x'.repeat(43), NEW_PASSWORD)).status).toBe(400);
      }
      const eleventh = await reset('x'.repeat(43), NEW_PASSWORD);
      expect(eleventh.status).toBe(429);
      expect(Number(eleventh.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('link integrity and log hygiene', () => {
    it('builds the link from WEB_APP_URL even with spoofed Origin, Host and X-Forwarded-Host', async () => {
      const user = await createUser();
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .set('Origin', 'http://evil.test')
        .set('Host', 'evil.test')
        .set('X-Forwarded-Host', 'evil.test')
        .send({ email: user.email });
      expect(res.status).toBe(202);

      await waitFor(() => sendSpy.mock.calls.length, (n) => n >= 1);
      const text: string = sendSpy.mock.calls[0][0].text;
      expect(text).toContain(`${WEB_APP_URL}/reset-password?token=`);
      expect(text).not.toContain('evil.test');
    });

    it('never passes the raw token or its hash to any logger and never returns it in the response', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
      );
      try {
        const user = await createUser();
        const res = await forgot(user.email);
        await waitFor(() => sendSpy.mock.calls.length, (n) => n >= 1);
        const token = TOKEN_RE.exec(sendSpy.mock.calls[0][0].text)![1];
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        expect(JSON.stringify(res.body)).not.toContain(token);
        expect(res.text).not.toContain(token);

        expect((await reset(token, NEW_PASSWORD)).status).toBe(200);

        const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' '))).join('\n');
        expect(logged).not.toContain(token);
        expect(logged).not.toContain(hash);
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
  });

  describe('dev mode (real MailService, no network)', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    const warnTexts = (): string[] => warnSpy.mock.calls.map((c) => c.map(String).join(' '));

    it('with MAIL_DEV_LOG=1 logs the link exactly once at WARN and never calls fetch', async () => {
      process.env.MAIL_DEV_LOG = '1';
      sendSpy.mockImplementationOnce(realSend);
      const user = await createUser();

      const res = await forgot(user.email);
      expect(res.status).toBe(202);

      await waitFor(warnTexts, (t) => t.some((x) => x.includes('/reset-password?token=')));
      const withLink = warnTexts().filter((x) => x.includes('/reset-password?token='));
      expect(withLink).toHaveLength(1);
      expect(withLink[0]).toContain(`${WEB_APP_URL}/reset-password?token=`);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('without MAIL_DEV_LOG the link is NOT logged and fetch is never called', async () => {
      sendSpy.mockImplementationOnce(realSend);
      const user = await createUser();

      const res = await forgot(user.email);
      expect(res.status).toBe(202);

      await waitFor(warnTexts, (t) => t.some((x) => x.includes('RESEND_API_KEY is not set')));
      expect(warnTexts().filter((x) => x.includes('reset-password'))).toHaveLength(0);
      expect(warnTexts().filter((x) => /token=/.test(x))).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('with a key set but ADMIN_EMAIL blank, creates no token, calls no network and logs no link', async () => {
      process.env.RESEND_API_KEY = 're_fake_key_for_e2e_0123456789';
      process.env.ADMIN_EMAIL = '';
      process.env.MAIL_DEV_LOG = '1';
      sendSpy.mockImplementationOnce(realSend);
      const user = await createUser();

      const res = await forgot(user.email);
      expect(res.status).toBe(202);

      await waitFor(warnTexts, (t) => t.some((x) => x.includes('ADMIN_EMAIL is not configured')));
      await new Promise((r) => setTimeout(r, 100));
      expect(await tokenRepo.count({ where: { userId: user.id } })).toBe(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(warnTexts().filter((x) => x.includes('reset-password'))).toHaveLength(0);
    });
  });
});
