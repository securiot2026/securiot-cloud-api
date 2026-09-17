import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';
import { Zone } from '../src/zones/zone.entity';
import { Device } from '../src/devices/device.entity';

describe('Devices — latest frame proxy (e2e)', () => {
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
    process.env.EDGE_ADMIN_API_KEY = 'e2e-admin-key';

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
      userRepo.create({ email: 'devices-frame-a@securiot.local', passwordHash }),
    );
    const userB = await userRepo.save(
      userRepo.create({ email: 'devices-frame-b@securiot.local', passwordHash }),
    );

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-frame-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-frame-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone Frame A', ownerId: userA.id }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeviceDirect(edgeUrl: string | null = null): Promise<Device> {
    return deviceRepo.save(
      deviceRepo.create({
        name: 'Frame Device',
        zoneId: zoneA.id,
        apiKey: crypto.randomBytes(24).toString('hex'),
        edgeUrl,
      }),
    );
  }

  function startFakeEdge(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  ): Promise<{ server: http.Server; url: string; requests: http.IncomingMessage[] }> {
    const requests: http.IncomingMessage[] = [];
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        requests.push(req);
        handler(req, res);
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ server, url: `http://127.0.0.1:${port}`, requests });
      });
    });
  }

  it('returns 404 for a device not owned by the authenticated operator and never contacts Edge', async () => {
    let requestCount = 0;
    const { server, url } = await startFakeEdge((_req, res) => {
      requestCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ device_id: 'x', frame: 'AA==', captured_at: '2026-01-01T00:00:00Z' }));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/frame`)
        .set('Authorization', `Bearer ${jwtB}`);

      expect(res.status).toBe(404);
      expect(requestCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it('returns 400 with no edgeUrl configured, without contacting any server', async () => {
    const device = await createDeviceDirect(null);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}/frame`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(400);
  });

  it('proxies GET /frames/latest/:id with X-Admin-Key and mirrors the frame + capture timestamp', async () => {
    let receivedAdminKey: string | undefined;
    let receivedPath: string | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      receivedAdminKey = req.headers['x-admin-key'] as string;
      receivedPath = req.url;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          device_id: 'dev-x',
          frame: 'ZmFrZS1qcGVnLWJ5dGVz',
          captured_at: '2026-09-20T12:00:00.000000Z',
        }),
      );
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/frame`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(200);
      expect(res.body.frame).toBe('ZmFrZS1qcGVnLWJ5dGVz');
      expect(res.body.captured_at).toBe('2026-09-20T12:00:00.000000Z');
      expect(receivedAdminKey).toBe('e2e-admin-key');
      expect(receivedPath).toBe(`/frames/latest/${device.id}`);
    } finally {
      server.close();
    }
  });

  it('mirrors a 404 from Edge when the device has not captured a frame yet', async () => {
    const { server, url } = await startFakeEdge((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no frame captured yet for this device' }));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/frame`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });

  it('remaps a raw Edge 401 to Cloud 502', async () => {
    const { server, url } = await startFakeEdge((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/frame`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(502);
    } finally {
      server.close();
    }
  });
});
