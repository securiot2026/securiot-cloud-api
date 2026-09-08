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

describe('Alerts (e2e)', () => {
  let app: INestApplication;
  let jwtA: string;
  let jwtB: string;
  let zoneA: Zone;
  let deviceA: Device;
  let alertId: string;

  beforeAll(async () => {
    process.env.DB_DRIVER = 'sqlite';
    process.env.DB_SQLITE_PATH = ':memory:';
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.JWT_EXPIRES_IN = '1h';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    const zoneRepo = moduleFixture.get<Repository<Zone>>(getRepositoryToken(Zone));
    const deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));

    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    const userA = await userRepo.save(userRepo.create({ email: 'alerts-a@securiot.local', passwordHash }));
    await userRepo.save(userRepo.create({ email: 'alerts-b@securiot.local', passwordHash }));

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alerts-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alerts-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone A', ownerId: userA.id }));
    deviceA = await deviceRepo.save(
      deviceRepo.create({ name: 'Device A', apiKey: crypto.randomBytes(24).toString('hex'), zoneId: zoneA.id }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists an alert triggered by a real telemetry ingest for the owner', async () => {
    const ingestRes = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', deviceA.apiKey)
      .send({
        reading_id: 'alerts-e2e-reading-1',
        sensor_type: 'door_contact',
        value: { state: 'open' },
        recorded_at: new Date().toISOString(),
      });
    expect(ingestRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${jwtA}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);
    const alert = listRes.body.find((a: { deviceId: string }) => a.deviceId === deviceA.id);
    expect(alert).toBeDefined();
    expect(alert.zoneId).toBe(zoneA.id);
    alertId = alert.id;
  });

  it('filters alerts by zone_id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/alerts?zone_id=${zoneA.id}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body.every((a: { zoneId: string }) => a.zoneId === zoneA.id)).toBe(true);
    expect(res.body.some((a: { id: string }) => a.id === alertId)).toBe(true);
  });

  it('filters alerts by device_id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/alerts?device_id=${deviceA.id}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body.every((a: { deviceId: string }) => a.deviceId === deviceA.id)).toBe(true);
    expect(res.body.some((a: { id: string }) => a.id === alertId)).toBe(true);
  });

  it('returns an empty list for a user with no zones/devices of their own', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${jwtB}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rejects GET without a valid JWT', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/alerts');
    expect(res.status).toBe(401);
  });
});
