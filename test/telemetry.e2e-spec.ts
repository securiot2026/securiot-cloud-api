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
  let deviceRepo: Repository<Device>;

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
    deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));
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

  it('creates an alert from a generic rule_alert reading (RULE-12: Edge rules engine, not a Cloud-side hardcoded check)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send({
        reading_id: 'reading-rule-alert',
        sensor_type: 'rule_alert',
        value: JSON.stringify({
          rule_name: 'Legacy door lock — person (migrated)',
          severity: 'medium',
          message: "Rule 'Legacy door lock — person (migrated)' triggered",
        }),
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(201);

    const alert = await alertRepo.findOne({ where: { readingId: response.body.id } });
    expect(alert).not.toBeNull();
    expect(alert?.severity).toBe('medium');
    expect(alert?.status).toBe('active');
    expect(alert?.ruleType).toBe('Legacy door lock — person (migrated)');
    expect(alert?.zoneId).toBe(zoneA.id);
    expect(alert?.deviceId).toBe(device.id);
  });

  it('does not create an alert for a plain door_contact reading (the hardcoded check was retired — only rule_alert readings create alerts now)', async () => {
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
    expect(alert).toBeNull();
  });

  it('does not create an alert for non rule_alert sensor readings', async () => {
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

  it('does not create an alert for a rule_alert reading with a malformed payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', 'valid-api-key')
      .send({
        reading_id: 'reading-rule-alert-bad',
        sensor_type: 'rule_alert',
        value: 'not valid json',
        recorded_at: new Date().toISOString(),
      });

    expect(response.status).toBe(201);

    const alert = await alertRepo.findOne({ where: { readingId: response.body.id } });
    expect(alert).toBeNull();
  });

  it('does not create a second alert when the same rule_alert reading is resent', async () => {
    const payload = {
      reading_id: 'reading-rule-alert-dup',
      sensor_type: 'rule_alert',
      value: JSON.stringify({ rule_name: 'Weapon alert', severity: 'critical', message: 'Weapon detected' }),
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
  describe('heartbeat (D-06: presence without a Reading)', () => {
    const postHeartbeat = (key: string | null, recordedAt: string, readingId: string) => {
      const req = request(app.getHttpServer()).post('/api/v1/telemetry');
      if (key) req.set('X-Device-Key', key);
      return req.send({
        reading_id: readingId,
        sensor_type: 'heartbeat',
        value: 'alive',
        recorded_at: recordedAt,
      });
    };

    it('sets lastSeenAt on the owning device and creates no Reading row', async () => {
      const seen = new Date(Date.now() - 5000);
      const response = await postHeartbeat('valid-api-key-b', seen.toISOString(), 'hb-1');

      expect(response.status).toBe(201);

      const refreshed = await deviceRepo.findOneOrFail({ where: { id: deviceB.id } });
      expect(refreshed.lastSeenAt).not.toBeNull();
      expect(refreshed.lastSeenAt?.getTime()).toBe(seen.getTime());

      const list = await request(app.getHttpServer())
        .get(`/api/v1/telemetry?device_id=${deviceB.id}`)
        .set('Authorization', `Bearer ${jwt}`);
      expect(list.body.some((r: { sensorType: string }) => r.sensorType === 'heartbeat')).toBe(false);
      expect(list.body.some((r: { readingId: string }) => r.readingId === 'hb-1')).toBe(false);
    });

    it('never moves lastSeenAt backwards', async () => {
      const newer = new Date(Date.now() - 2000);
      await postHeartbeat('valid-api-key-b', newer.toISOString(), 'hb-newer');
      const older = new Date(Date.now() - 600000);
      const response = await postHeartbeat('valid-api-key-b', older.toISOString(), 'hb-older');

      expect(response.status).toBe(201);
      const refreshed = await deviceRepo.findOneOrFail({ where: { id: deviceB.id } });
      expect(refreshed.lastSeenAt?.getTime()).toBe(newer.getTime());
    });

    it('clamps a future recorded_at to the server time', async () => {
      const before = Date.now();
      const future = new Date(Date.now() + 3600 * 1000);
      const response = await postHeartbeat('valid-api-key', future.toISOString(), 'hb-future');

      expect(response.status).toBe(201);
      const after = Date.now();
      const refreshed = await deviceRepo.findOneOrFail({ where: { id: device.id } });
      expect(refreshed.lastSeenAt).not.toBeNull();
      const t = refreshed.lastSeenAt!.getTime();
      expect(t).toBeGreaterThanOrEqual(before - 1000);
      expect(t).toBeLessThanOrEqual(after + 1000);
    });

    it('rejects a heartbeat without X-Device-Key with 401', async () => {
      const response = await postHeartbeat(null, new Date().toISOString(), 'hb-nokey');
      expect(response.status).toBe(401);
    });

    it('rejects a heartbeat with an invalid X-Device-Key with 401', async () => {
      const response = await postHeartbeat('bogus', new Date().toISOString(), 'hb-badkey');
      expect(response.status).toBe(401);
    });
  });
});
