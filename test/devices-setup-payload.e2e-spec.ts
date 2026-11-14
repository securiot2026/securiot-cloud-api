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

const DEVICE_SECRET = 'e2e-device-secret';

describe('Devices — setup payload for the provisioning QR (e2e)', () => {
  let app: INestApplication;
  let jwtA: string;
  let jwtB: string;
  let zoneA: Zone;
  let deviceRepo: Repository<Device>;
  let zoneRepo: Repository<Zone>;

  beforeAll(async () => {
    process.env.DB_DRIVER = 'sqlite';
    process.env.DB_SQLITE_PATH = ':memory:';
    process.env.JWT_SECRET = 'e2e-test-secret';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.EDGE_DEVICE_SHARED_SECRET = DEVICE_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    zoneRepo = moduleFixture.get<Repository<Zone>>(getRepositoryToken(Zone));
    deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));

    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    const userA = await userRepo.save(
      userRepo.create({ email: 'devices-setup-a@securiot.local', passwordHash }),
    );
    await userRepo.save(userRepo.create({ email: 'devices-setup-b@securiot.local', passwordHash }));

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-setup-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-setup-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone Setup A', ownerId: userA.id }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeviceDirect(edgeUrl: string | null = null): Promise<Device> {
    return deviceRepo.save(
      deviceRepo.create({
        name: 'Setup Device',
        zoneId: zoneA.id,
        apiKey: crypto.randomBytes(24).toString('hex'),
        edgeUrl,
      }),
    );
  }

  it('returns 401 without an Authorization header', async () => {
    const device = await createDeviceDirect('http://192.168.1.50:5000');

    const res = await request(app.getHttpServer()).get(`/api/v1/devices/${device.id}/setup-payload`);

    expect(res.status).toBe(401);
    expect(res.text).not.toContain(DEVICE_SECRET);
  });

  it('returns 404 for a device owned by another operator and never leaks the secret', async () => {
    const device = await createDeviceDirect('http://192.168.1.50:5000');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}/setup-payload`)
      .set('Authorization', `Bearer ${jwtB}`);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(DEVICE_SECRET);
  });

  it('returns 404 for an unknown device id, same as a foreign one', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${crypto.randomUUID()}/setup-payload`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain(DEVICE_SECRET);
  });

  it('returns 400 when the device has no edgeUrl configured', async () => {
    const device = await createDeviceDirect(null);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}/setup-payload`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(400);
    expect(res.text).not.toContain(DEVICE_SECRET);
  });

  it('returns 503 without leaking any secret when EDGE_DEVICE_SHARED_SECRET is not set', async () => {
    const device = await createDeviceDirect('http://192.168.1.50:5000');
    const previous = process.env.EDGE_DEVICE_SHARED_SECRET;
    delete process.env.EDGE_DEVICE_SHARED_SECRET;

    try {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/setup-payload`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(503);
      expect(res.text).not.toContain(DEVICE_SECRET);
    } finally {
      process.env.EDGE_DEVICE_SHARED_SECRET = previous;
    }
  });

  it('returns 200 with exactly edgeApiUrl, deviceKey, deviceId and zoneId, and no-store caching', async () => {
    const device = await createDeviceDirect('http://192.168.1.50:5000');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}/setup-payload`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      edgeApiUrl: 'http://192.168.1.50:5000',
      deviceKey: DEVICE_SECRET,
      deviceId: device.id,
      zoneId: zoneA.id,
    });
    expect(res.body).not.toHaveProperty('apiKey');
    expect(res.text).not.toContain(device.apiKey);
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('strips the trailing slash from the stored edgeUrl', async () => {
    const device = await createDeviceDirect('http://192.168.1.50:5000/');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}/setup-payload`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body.edgeApiUrl).toBe('http://192.168.1.50:5000');
  });
});
