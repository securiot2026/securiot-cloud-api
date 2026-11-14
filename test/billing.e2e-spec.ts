import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { Subscription } from '../src/billing/subscription.entity';
import { Payment } from '../src/billing/payment.entity';

describe('Billing simulated gateway (e2e)', () => {
  let app: INestApplication;
  let subRepo: Repository<Subscription>;
  let payRepo: Repository<Payment>;
  const jwts: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const card = (number = '4242 4242 4242 4242') => ({
    number,
    holder: 'Test User',
    expMonth: 12,
    expYear: new Date().getFullYear() + 3,
    cvc: '123',
  });
  const body = (number?: string) => ({ planId: 'standard', cameras: 2, card: card(number) });
  const post = (path: string, who?: string) => {
    const r = request(app.getHttpServer()).post(`/api/v1${path}`);
    return who ? r.set('Authorization', `Bearer ${jwts[who]}`) : r;
  };
  const get = (path: string, who?: string) => {
    const r = request(app.getHttpServer()).get(`/api/v1${path}`);
    return who ? r.set('Authorization', `Bearer ${jwts[who]}`) : r;
  };

  beforeAll(async () => {
    process.env.DB_DRIVER = 'sqlite';
    process.env.DB_SQLITE_PATH = ':memory:';
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.BILLING_SIMULATED_LATENCY_MS = '0';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    subRepo = moduleFixture.get<Repository<Subscription>>(getRepositoryToken(Subscription));
    payRepo = moduleFixture.get<Repository<Payment>>(getRepositoryToken(Payment));
    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const email = `billing-${name}@securiot.local`;
      ids[name] = (await userRepo.save(userRepo.create({ email, passwordHash }))).id;
      jwts[name] = (
        await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'ChangeMe123!' })
      ).body.access_token;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the plans publicly', async () => {
    const res = await get('/billing/plans').expect(200);
    expect(res.body.currency).toBe('PEN');
    expect(res.body.igvRate).toBe(0.18);
    expect(res.body.plans.map((p: { id: string }) => p.id)).toEqual(['basic', 'standard', 'plus']);
    expect(res.body.plans[0]).toEqual({
      id: 'basic',
      name: 'Basic',
      monthlyPerCamera: 39,
      installFeePerCamera: 350,
      features: ['Person detection', 'Phone alerts', 'Web live view', 'Remote updates'],
    });
  });

  it('requires a JWT on the guarded endpoints', async () => {
    await post('/billing/checkout').send(body()).expect(401);
    await get('/billing/subscription').expect(401);
    await post('/billing/subscription/cancel').expect(401);
  });

  it('approves the test card, creates a subscription and a payment, and stores no card secrets', async () => {
    const res = await post('/billing/checkout', 'a').send(body()).expect(201);
    expect(res.body.payment).toMatchObject({
      status: 'approved',
      subtotal: 798,
      igv: 143.64,
      total: 941.64,
      currency: 'PEN',
      cardBrand: 'visa',
      last4: '4242',
    });
    expect(res.body.subscription).toMatchObject({
      planId: 'standard',
      cameras: 2,
      status: 'active',
      monthlyPerCamera: 49,
    });
    expect(new Date(res.body.subscription.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());

    const stored = JSON.stringify(await payRepo.find({ where: { ownerId: ids.a } }));
    expect(stored).not.toContain('4242424242424242');
    expect(stored).not.toContain('Test User');
    expect(stored).not.toContain('123"');
    const columns = Object.keys((await payRepo.find())[0]);
    expect(columns).not.toEqual(expect.arrayContaining(['number']));
    expect(columns).not.toEqual(expect.arrayContaining(['cvc']));
    expect(columns).not.toEqual(expect.arrayContaining(['holder']));
  });

  it('answers 409 to a second checkout while a subscription is active, before charging', async () => {
    const before = await payRepo.count({ where: { ownerId: ids.a } });
    const res = await post('/billing/checkout', 'a').send(body()).expect(409);
    expect(res.body.message).toBe('Active subscription already exists');
    expect(await payRepo.count({ where: { ownerId: ids.a } })).toBe(before);
  });

  it.each([
    ['b', '4000 0000 0000 0002', 'card_declined'],
    ['c', '4000-0000-0000-9995', 'insufficient_funds'],
    ['d', '4000000000000069', 'expired_card'],
    ['e', '5555 5555 5555 4444', 'unknown_test_card'],
  ])('user %s with card %s gets 402 %s and no subscription', async (who, number, reason) => {
    const res = await post('/billing/checkout', who).send(body(number)).expect(402);
    expect(res.body.subscription).toBeUndefined();
    expect(res.body.payment).toMatchObject({ status: 'declined', reason, total: 941.64 });
    expect(await subRepo.count({ where: { ownerId: ids[who] } })).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain(number.replace(/\D/g, ''));
  });

  it('allows a new checkout after a decline', async () => {
    await post('/billing/checkout', 'b').send(body()).expect(201);
  });

  it('rejects invalid bodies with 400', async () => {
    const bad = [
      { ...body(), planId: 'gold' },
      { ...body(), cameras: 0 },
      { ...body(), cameras: 9 },
      { ...body(), cameras: 1.5 },
      { ...body(), card: { ...card(), cvc: '12' } },
      { ...body(), card: { ...card(), cvc: '12a' } },
      { ...body(), card: { ...card(), expMonth: 13 } },
      { ...body(), card: { ...card(), expYear: 99 } },
      { ...body(), card: { ...card(), expYear: new Date().getFullYear() - 1 } },
      { ...body(), card: { ...card(), number: 'abcd' } },
      { ...body(), card: { ...card(), holder: '' } },
      { planId: 'basic', cameras: 1 },
    ];
    for (const payload of bad) await post('/billing/checkout', 'f').send(payload).expect(400);
    expect(await payRepo.count({ where: { ownerId: ids.f } })).toBe(0);
  });

  it('shows only the authenticated user data, newest payment first', async () => {
    const own = await get('/billing/subscription', 'b').expect(200);
    expect(own.body.subscription).toMatchObject({ status: 'active', planId: 'standard' });
    expect(own.body.payments).toHaveLength(2);
    expect(own.body.payments[0].status).toBe('approved');
    expect(own.body.payments[1].status).toBe('declined');

    const other = await get('/billing/subscription', 'g').expect(200);
    expect(other.body).toEqual({ subscription: null, payments: [] });
  });

  it('cancels the active subscription and answers 404 when there is none', async () => {
    await post('/billing/subscription/cancel', 'g').expect(404);
    const res = await post('/billing/subscription/cancel', 'a').expect(200);
    expect(res.body.status).toBe('canceled');
    const read = await get('/billing/subscription', 'a').expect(200);
    expect(read.body.subscription).toBeNull();
    expect(read.body.payments).toHaveLength(1);
    await post('/billing/subscription/cancel', 'a').expect(404);
    await post('/billing/checkout', 'a').send(body()).expect(201);
  });
});
