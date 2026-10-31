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

describe('Devices — manual commands (e2e)', () => {
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
      userRepo.create({ email: 'devices-cmd-a@securiot.local', passwordHash }),
    );
    const userB = await userRepo.save(
      userRepo.create({ email: 'devices-cmd-b@securiot.local', passwordHash }),
    );

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-cmd-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-cmd-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone CMD A', ownerId: userA.id }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeviceDirect(edgeUrl: string | null = null): Promise<Device> {
    return deviceRepo.save(
      deviceRepo.create({
        name: 'CMD Device',
        zoneId: zoneA.id,
        apiKey: crypto.randomBytes(24).toString('hex'),
        edgeUrl,
      }),
    );
  }

  function startFakeEdge(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  ): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ server, url: `http://127.0.0.1:${port}` });
      });
    });
  }

  it('returns 404 for a device not owned by the authenticated operator and never contacts Edge', async () => {
    let requestCount = 0;
    const { server, url } = await startFakeEdge((_req, res) => {
      requestCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtB}`)
        .send({ actuator: 'light', action: { on: true } });

      expect(res.status).toBe(404);
      expect(requestCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it('returns 400 with no edgeUrl configured, without contacting any server', async () => {
    const device = await createDeviceDirect(null);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/commands`)
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ actuator: 'light', action: { on: true } });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown actuator before ever contacting Edge', async () => {
    let requestCount = 0;
    const { server, url } = await startFakeEdge((_req, res) => {
      requestCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ actuator: 'sprinkler', action: {} });

      expect(res.status).toBe(400);
      expect(requestCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it('forwards a pan_tilt command as JSON with X-Admin-Key, device_id, and mirrors the response', async () => {
    let receivedAdminKey: string | undefined;
    let receivedContentType: string | undefined;
    let receivedBody = '';
    const { server, url } = await startFakeEdge((req, res) => {
      receivedAdminKey = req.headers['x-admin-key'] as string;
      receivedContentType = req.headers['content-type'] as string;
      req.on('data', (chunk) => {
        receivedBody += chunk;
      });
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ device_id: 'dev-x', actuator: 'pan_tilt' }));
      });
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ actuator: 'pan_tilt', action: { pan_delta: -5, tilt_delta: 2 } });

      expect(res.status).toBe(201);
      expect(res.body.actuator).toBe('pan_tilt');
      expect(receivedAdminKey).toBe('e2e-admin-key');
      expect(receivedContentType).toContain('application/json');
      expect(JSON.parse(receivedBody)).toEqual({
        device_id: device.id,
        actuator: 'pan_tilt',
        action: { pan_delta: -5, tilt_delta: 2 },
      });
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
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ actuator: 'buzzer', action: { on: true } });

      expect(res.status).toBe(502);
    } finally {
      server.close();
    }
  });

  describe.each(['open', 'close'])('door command with state %s', (state) => {
    it('forwards it as JSON with X-Admin-Key and the device_id from the path, mirroring the Edge 201', async () => {
      let requestCount = 0;
      let receivedAdminKey: string | undefined;
      let receivedContentType: string | undefined;
      let receivedBody = '';
      const { server, url } = await startFakeEdge((req, res) => {
        requestCount += 1;
        receivedAdminKey = req.headers['x-admin-key'] as string;
        receivedContentType = req.headers['content-type'] as string;
        req.on('data', (chunk) => {
          receivedBody += chunk;
        });
        req.on('end', () => {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ actuator: 'door', action: { state } }));
        });
      });

      try {
        const device = await createDeviceDirect(url);

        const res = await request(app.getHttpServer())
          .post(`/api/v1/devices/${device.id}/commands`)
          .set('Authorization', `Bearer ${jwtA}`)
          // A spoofed device_id in the body is dropped by the whitelist pipe.
          .send({ device_id: 'other-device', actuator: 'door', action: { state } });

        expect(res.status).toBe(201);
        expect(res.body.actuator).toBe('door');
        expect(requestCount).toBe(1);
        expect(receivedAdminKey).toBe('e2e-admin-key');
        expect(receivedContentType).toContain('application/json');
        expect(JSON.parse(receivedBody)).toEqual({
          device_id: device.id,
          actuator: 'door',
          action: { state },
        });
      } finally {
        server.close();
      }
    });
  });

  it.each([
    ['empty action', {}],
    ['unknown state', { state: 'ajar' }],
    ['wrongly cased state', { state: 'OPEN' }],
    ['numeric state', { state: 1 }],
    ['null state', { state: null }],
  ])('rejects a door command with %s and never contacts Edge', async (_label, action) => {
    let requestCount = 0;
    const { server, url } = await startFakeEdge((_req, res) => {
      requestCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ actuator: 'door', action });

      expect(res.status).toBe(400);
      expect(requestCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it('returns 404 for a door command on a device the caller does not own and never contacts Edge', async () => {
    let requestCount = 0;
    const { server, url } = await startFakeEdge((_req, res) => {
      requestCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtB}`)
        .send({ actuator: 'door', action: { state: 'open' } });

      expect(res.status).toBe(404);
      expect(requestCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it('returns 401 for a door command without a JWT', async () => {
    const device = await createDeviceDirect(null);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/commands`)
      .send({ actuator: 'door', action: { state: 'open' } });

    expect(res.status).toBe(401);
  });

  it('still rejects the legacy door_lock actuator before contacting Edge', async () => {
    let requestCount = 0;
    const { server, url } = await startFakeEdge((_req, res) => {
      requestCount += 1;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/commands`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ actuator: 'door_lock', action: {} });

      expect(res.status).toBe(400);
      expect(requestCount).toBe(0);
    } finally {
      server.close();
    }
  });

  it('forwards the door status query to Edge /commands/<id>/status?actuator=door', async () => {
    let receivedUrl: string | undefined;
    let receivedAdminKey: string | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      receivedUrl = req.url;
      receivedAdminKey = req.headers['x-admin-key'] as string;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actuator: 'door', status: 'pending' }));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/commands/status?actuator=door`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pending');
      expect(receivedUrl).toBe(`/commands/${device.id}/status?actuator=door`);
      expect(receivedAdminKey).toBe('e2e-admin-key');
    } finally {
      server.close();
    }
  });

  it('rejects an unknown status actuator with 400 and a message that lists door', async () => {
    const device = await createDeviceDirect('http://127.0.0.1:1');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/devices/${device.id}/commands/status?actuator=siren`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('door');
  });
});
