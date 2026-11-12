import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { Zone } from '../src/zones/zone.entity';
import { Device } from '../src/devices/device.entity';

describe('Devices rotate API key (e2e)', () => {
  let app: INestApplication;
  let jwtA: string;
  let jwtB: string;
  let device: Device;
  let deviceRepo: Repository<Device>;

  beforeAll(async () => {
    process.env.DB_DRIVER = 'sqlite';
    process.env.DB_SQLITE_PATH = ':memory:';
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.JWT_EXPIRES_IN = '1h';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    const zoneRepo = moduleFixture.get<Repository<Zone>>(getRepositoryToken(Zone));
    deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));

    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    const userA = await userRepo.save(userRepo.create({ email: 'rotate-a@securiot.local', passwordHash }));
    await userRepo.save(userRepo.create({ email: 'rotate-b@securiot.local', passwordHash }));
    const login = async (email: string): Promise<string> =>
      (await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'ChangeMe123!' }))
        .body.access_token;
    jwtA = await login('rotate-a@securiot.local');
    jwtB = await login('rotate-b@securiot.local');

    const zone = await zoneRepo.save(zoneRepo.create({ name: 'Rotate Zone', ownerId: userA.id }));
    device = await deviceRepo.save(
      deviceRepo.create({ name: 'Rotate Device', zoneId: zone.id, apiKey: crypto.randomBytes(24).toString('hex') }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a JWT', async () => {
    await request(app.getHttpServer()).post(`/api/v1/devices/${device.id}/rotate-key`).expect(401);
  });

  it('answers 404 to an owner that does not own the device and keeps the key', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/rotate-key`)
      .set('Authorization', `Bearer ${jwtB}`)
      .expect(404);
    const unchanged = await deviceRepo.findOneByOrFail({ id: device.id });
    expect(unchanged.apiKey).toBe(device.apiKey);
  });

  it('returns a new key once, stores it, and the old key no longer works for telemetry', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/rotate-key`)
      .set('Authorization', `Bearer ${jwtA}`)
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.apiKey).toMatch(/^[0-9a-f]{48}$/);
    expect(res.body.apiKey).not.toBe(device.apiKey);

    const stored = await deviceRepo.findOneByOrFail({ id: device.id });
    expect(stored.apiKey).toBe(res.body.apiKey);

    await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', device.apiKey)
      .send({})
      .expect(401);
  });
});
