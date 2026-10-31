import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { Zone } from '../src/zones/zone.entity';
import { Device } from '../src/devices/device.entity';
import { Alert } from '../src/alerts/alert.entity';
import { MailService } from '../src/mail/mail.service';

const WEB_APP_URL = 'http://web.example.test:4200';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeoutMs) {
    await sleep(20);
  }
}

describe('Alert admin notifications (e2e)', () => {
  let app: INestApplication;
  let userRepo: Repository<User>;
  let zoneRepo: Repository<Zone>;
  let deviceRepo: Repository<Device>;
  let alertRepo: Repository<Alert>;
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
    zoneRepo = moduleFixture.get<Repository<Zone>>(getRepositoryToken(Zone));
    deviceRepo = moduleFixture.get<Repository<Device>>(getRepositoryToken(Device));
    alertRepo = moduleFixture.get<Repository<Alert>>(getRepositoryToken(Alert));

    const mailService = moduleFixture.get(MailService, { strict: false });
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
    sendSpy.mockReset();
    sendSpy.mockResolvedValue(true);
    fetchSpy.mockClear();
    process.env.ADMIN_EMAIL = 'admin@example.test';
  });

  // The throttle map lives for the whole app instance, so every scenario gets a fresh device.
  async function createDevice(): Promise<{ device: Device; zone: Zone }> {
    counter += 1;
    const user = await userRepo.save(
      userRepo.create({ email: `alert-notify-${counter}@securiot.local`, passwordHash: 'x' }),
    );
    const zone = await zoneRepo.save(zoneRepo.create({ name: `Zone ${counter}`, ownerId: user.id }));
    const device = await deviceRepo.save(
      deviceRepo.create({
        name: `Device ${counter}`,
        apiKey: crypto.randomBytes(24).toString('hex'),
        zoneId: zone.id,
      }),
    );
    return { device, zone };
  }

  function ingest(device: Device, readingId: string, ruleName: string, severity = 'high') {
    return request(app.getHttpServer())
      .post('/api/v1/telemetry')
      .set('X-Device-Key', device.apiKey)
      .send({
        reading_id: readingId,
        sensor_type: 'rule_alert',
        value: JSON.stringify({ rule_name: ruleName, severity, message: `Rule '${ruleName}' triggered` }),
        recorded_at: new Date().toISOString(),
      });
  }

  it('sends exactly one throttled email per device and rule type, and none for replays', async () => {
    const { device, zone } = await createDevice();

    const first = await ingest(device, `notify-${counter}-r1`, 'door_forced');
    expect(first.status).toBe(201);
    await waitFor(() => sendSpy.mock.calls.length >= 1);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const message = sendSpy.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(message.to).toBe('admin@example.test');
    expect(message.subject).toContain('door_forced');
    expect(message.text).toContain(device.id);
    expect(message.text).toContain(zone.id);
    expect(message.text).toContain(`${WEB_APP_URL}/alerts`);
    expect(message.text).not.toContain(device.apiKey);

    // Same device and rule, new reading id: stored but throttled.
    const second = await ingest(device, `notify-${counter}-r2`, 'door_forced');
    expect(second.status).toBe(201);
    await sleep(150);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Replay of the first reading id: no second Alert and no email.
    const replay = await ingest(device, `notify-${counter}-r1`, 'door_forced');
    expect(replay.status).toBe(201);
    await sleep(150);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const alertsForDevice = await alertRepo.find({ where: { deviceId: device.id } });
    expect(alertsForDevice).toHaveLength(2);

    // A different rule name on the same device is a different throttle key.
    const other = await ingest(device, `notify-${counter}-r3`, 'motion_after_hours');
    expect(other.status).toBe(201);
    await waitFor(() => sendSpy.mock.calls.length >= 2);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    const otherMessage = sendSpy.mock.calls[1][0] as { subject: string };
    expect(otherMessage.subject).toContain('motion_after_hours');
  });

  it('creates the Alert but sends nothing when ADMIN_EMAIL is blank', async () => {
    const { device } = await createDevice();
    process.env.ADMIN_EMAIL = '';

    const res = await ingest(device, `notify-${counter}-blank`, 'door_forced');
    expect(res.status).toBe(201);
    await sleep(150);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(await alertRepo.count({ where: { deviceId: device.id } })).toBe(1);
  });

  it('still answers 201 and stores the Alert when send rejects', async () => {
    const { device } = await createDevice();
    sendSpy.mockRejectedValue(new Error('provider down'));

    const res = await ingest(device, `notify-${counter}-reject`, 'door_forced');
    expect(res.status).toBe(201);
    await waitFor(() => sendSpy.mock.calls.length >= 1);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await alertRepo.count({ where: { deviceId: device.id } })).toBe(1);
  });

  it('still answers 201 and stores the Alert when send throws synchronously', async () => {
    const { device } = await createDevice();
    sendSpy.mockImplementation(() => {
      throw new Error('sync boom');
    });

    const res = await ingest(device, `notify-${counter}-throw`, 'door_forced');
    expect(res.status).toBe(201);
    await waitFor(() => sendSpy.mock.calls.length >= 1);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await alertRepo.count({ where: { deviceId: device.id } })).toBe(1);
  });
});
