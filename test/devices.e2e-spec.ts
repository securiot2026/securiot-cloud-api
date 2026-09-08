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
import { Reading } from '../src/telemetry/entities/reading.entity';

describe('Devices (e2e)', () => {
  let app: INestApplication;
  let jwtA: string;
  let jwtB: string;
  let userA: User;
  let zoneA: Zone;
  let deviceRepo: Repository<Device>;
  let zoneRepo: Repository<Zone>;
  let readingRepo: Repository<Reading>;

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
    zoneRepo = moduleFixture.get<Repository<Zone>>(getRepositoryToken(Zone));
    deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));
    readingRepo = moduleFixture.get<Repository<Reading>>(getRepositoryToken(Reading));

    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    userA = await userRepo.save(userRepo.create({ email: 'devices-a@securiot.local', passwordHash }));
    const userB = await userRepo.save(userRepo.create({ email: 'devices-b@securiot.local', passwordHash }));

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone A', ownerId: userA.id }));
    await zoneRepo.save(zoneRepo.create({ name: 'Zone B', ownerId: userB.id }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeviceDirect(zoneId: string, name = 'Direct Device'): Promise<Device> {
    return deviceRepo.save(
      deviceRepo.create({ name, zoneId, apiKey: crypto.randomBytes(24).toString('hex') }),
    );
  }

  it('creates a device under an owned zone and returns the apiKey only on creation', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Front Door Sensor', zoneId: zoneA.id });

    expect(createRes.status).toBe(201);
    expect(createRes.body.apiKey).toBeDefined();
    expect(typeof createRes.body.apiKey).toBe('string');

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${jwtA}`);

    expect(listRes.status).toBe(200);
    const listed = listRes.body.find((d: { id: string }) => d.id === createRes.body.id);
    expect(listed).toBeDefined();
    expect(listed.apiKey).toBeUndefined();
  });

  it('returns 404 when registering a device against a zone owned by another user', async () => {
    const otherZone = await zoneRepo.findOne({ where: { name: 'Zone B' } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Should Fail', zoneId: otherZone!.id });

    expect(res.status).toBe(404);
  });

  it('returns 404 when registering a device against a non-existent zone', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Should Fail', zoneId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  it('reports offline with no lastReading for a device with no readings', async () => {
    const device = await createDeviceDirect(zoneA.id, 'No Readings Device');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(false);
    expect(res.body.lastReading).toBeNull();
  });

  it('reports online with lastReading when the last reading is within the online window', async () => {
    const device = await createDeviceDirect(zoneA.id, 'Recent Reading Device');
    const recordedAt = new Date(Date.now() - 60 * 1000);
    await readingRepo.save(
      readingRepo.create({
        readingId: crypto.randomUUID(),
        deviceId: device.id,
        zoneId: zoneA.id,
        sensorType: 'temperature',
        value: { celsius: 21.5 },
        recordedAt,
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(true);
    expect(res.body.lastReading).not.toBeNull();
    expect(res.body.lastReading.sensorType).toBe('temperature');
  });

  it('reports offline but still shows lastReading when the last reading is outside the online window', async () => {
    const device = await createDeviceDirect(zoneA.id, 'Stale Reading Device');
    const recordedAt = new Date(Date.now() - 10 * 60 * 1000);
    await readingRepo.save(
      readingRepo.create({
        readingId: crypto.randomUUID(),
        deviceId: device.id,
        zoneId: zoneA.id,
        sensorType: 'temperature',
        value: { celsius: 19.0 },
        recordedAt,
      }),
    );

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(200);
    expect(res.body.isOnline).toBe(false);
    expect(res.body.lastReading).not.toBeNull();
  });

  it('returns 404 for a device detail whose zone belongs to another user', async () => {
    const otherZone = await zoneRepo.findOne({ where: { name: 'Zone B' } });
    const device = await createDeviceDirect(otherZone!.id, 'Other Owner Device');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(404);
  });
});
