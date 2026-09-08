import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { Zone } from '../src/zones/zone.entity';
import { Device } from '../src/devices/device.entity';
import { Alert } from '../src/alerts/alert.entity';

describe('Telemetry (e2e)', () => {
  let app: INestApplication;
  let device: Device;
  let zoneA: Zone;
  let zoneB: Zone;
  let deviceB: Device;
  let jwt: string;
  let alertRepo: Repository<Alert>;

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

    const zoneRepo = moduleFixture.get<Repository<Zone>>(getRepositoryToken(Zone));
    const deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));
    const userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    alertRepo = moduleFixture.get<Repository<Alert>>(getRepositoryToken(Alert));

    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    const owner = await userRepo.save(
      userRepo.create({ email: 'e2e@securiot.local', passwordHash }),
    );

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone A', ownerId: owner.id }));
    zoneB = await zoneRepo.save(zoneRepo.create({ name: 'Zone B', ownerId: owner.id }));
    device = await deviceRepo.save(
      deviceRepo.create({ name: 'Device A', apiKey: 'valid-api-key', zoneId: zoneA.id }),
    );
    deviceB = await deviceRepo.save(
      deviceRepo.create({ name: 'Device B', apiKey: 'valid-api-key-b', zoneId: zoneB.id }),
    );

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'e2e@securiot.local', password: 'ChangeMe123!' });
    jwt = loginResponse.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists a new reading and responds 201', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send({
        reading_id: 'reading-1',
        sensor_type: 'door_contact',
        value: { state: 'open' },
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(201);
    expect(response.body.readingId).toBe('reading-1');
  });

  it('does not create a second row for a duplicate reading_id', async () => {
    const payload = {
      reading_id: 'reading-1',
      sensor_type: 'door_contact',
      value: { state: 'closed' },
      recorded_at: new Date().toISOString(),
    };

    await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send(payload);

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/telemetry')
      .set('Authorization', `Bearer ${jwt}`);

    const matching = listResponse.body.filter((r: { readingId: string }) => r.readingId === 'reading-1');
    expect(matching).toHaveLength(1);
  });

  it('rejects POST with a missing X-Device-Key header', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .send({
        reading_id: 'reading-2',
        sensor_type: 'door_contact',
        value: { state: 'open' },
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(401);
  });

  it('rejects POST with an invalid X-Device-Key header', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'not-a-real-key')
      .send({
        reading_id: 'reading-3',
        sensor_type: 'door_contact',
        value: { state: 'open' },
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(401);
  });

  it('filters GET results by device_id', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key-b')
      .send({
        reading_id: 'reading-device-b',
        sensor_type: 'door_contact',
        value: { state: 'open' },
        recorded_at: new Date().toISOString(),
      });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/telemetry?device_id=${device.id}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(response.status).toBe(200);
    expect(response.body.every((r: { deviceId: string }) => r.deviceId === device.id)).toBe(true);
  });

  it('filters GET results by zone_id', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/telemetry?zone_id=${zoneB.id}`)
      .set('Authorization', `Bearer ${jwt}`);

    expect(response.status).toBe(200);
    expect(response.body.every((r: { zoneId: string }) => r.zoneId === zoneB.id)).toBe(true);
    expect(response.body.some((r: { readingId: string }) => r.readingId === 'reading-device-b')).toBe(true);
  });

  it('rejects GET without a valid JWT', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/telemetry');
    expect(response.status).toBe(401);
  });

  it('creates a medium-severity alert when a door_contact reading reports open', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send({
        reading_id: 'reading-door-open',
        sensor_type: 'door_contact',
        value: { state: 'open' },
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(201);

    const alert = await alertRepo.findOne({ where: { readingId: response.body.id } });
    expect(alert).not.toBeNull();
    expect(alert?.severity).toBe('medium');
    expect(alert?.status).toBe('active');
    expect(alert?.zoneId).toBe(zoneA.id);
    expect(alert?.deviceId).toBe(device.id);
  });

  it('does not create an alert when a door_contact reading reports closed', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send({
        reading_id: 'reading-door-closed',
        sensor_type: 'door_contact',
        value: { state: 'closed' },
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(201);

    const alert = await alertRepo.findOne({ where: { readingId: response.body.id } });
    expect(alert).toBeNull();
  });

  it('does not create an alert for non door_contact sensor readings', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send({
        reading_id: 'reading-motion',
        sensor_type: 'motion',
        value: { detected: true },
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(201);

    const alert = await alertRepo.findOne({ where: { readingId: response.body.id } });
    expect(alert).toBeNull();
  });

  it('does not create a second alert when the same door_contact/open reading is resent', async () => {
    const payload = {
      reading_id: 'reading-door-open-dup',
      sensor_type: 'door_contact',
      value: { state: 'open' },
      recorded_at: new Date().toISOString(),
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send(payload);

    await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send(payload);

    const alerts = await alertRepo.find({ where: { readingId: first.body.id } });
    expect(alerts).toHaveLength(1);
  });
});
