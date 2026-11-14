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

describe('Devices — rules proxy (e2e)', () => {
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
      userRepo.create({ email: 'devices-rules-a@securiot.local', passwordHash }),
    );
    const userB = await userRepo.save(
      userRepo.create({ email: 'devices-rules-b@securiot.local', passwordHash }),
    );

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-rules-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-rules-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone RULE A', ownerId: userA.id }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeviceDirect(edgeUrl: string | null = null): Promise<Device> {
    return deviceRepo.save(
      deviceRepo.create({
        name: 'RULE Device',
        zoneId: zoneA.id,
        apiKey: crypto.randomBytes(24).toString('hex'),
        edgeUrl,
      }),
    );
  }

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => resolve(raw));
    });
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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/rules`)
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
      .get(`/api/v1/devices/${device.id}/rules`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(res.status).toBe(400);
  });

  it('lists rules by proxying GET /rules?device_id= with X-Admin-Key', async () => {
    let receivedPath: string | undefined;
    let receivedAdminKey: string | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      receivedPath = req.url;
      receivedAdminKey = req.headers['x-admin-key'] as string;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: 1, name: 'Weapon rule' }]));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}/rules`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 1, name: 'Weapon rule' }]);
      expect(receivedPath).toBe(`/rules?device_id=${device.id}`);
      expect(receivedAdminKey).toBe('e2e-admin-key');
    } finally {
      server.close();
    }
  });

  it('creates a rule, injecting device_id into the forwarded body', async () => {
    let receivedBody = '';
    const { server, url } = await startFakeEdge((req, res) => {
      req.on('data', (chunk) => {
        receivedBody += chunk;
      });
      req.on('end', () => {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 7, ...JSON.parse(receivedBody) }));
      });
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/rules`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({
          name: 'Weapon at door',
          condition_type: 'weapon',
          actions: [{ type: 'alert', severity: 'high' }],
        });

      expect(res.status).toBe(201);
      expect(JSON.parse(receivedBody).device_id).toBe(device.id);
      expect(res.body.id).toBe(7);
    } finally {
      server.close();
    }
  });

  it('updates a rule via PATCH /rules/:ruleId', async () => {
    let receivedPath: string | undefined;
    let receivedMethod: string | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      receivedPath = req.url;
      receivedMethod = req.method;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 7, enabled: false }));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${device.id}/rules/7`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(receivedMethod).toBe('PATCH');
      expect(receivedPath).toBe('/rules/7');
    } finally {
      server.close();
    }
  });

  it('deletes a rule via DELETE /rules/:ruleId', async () => {
    const { server, url } = await startFakeEdge((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .delete(`/api/v1/devices/${device.id}/rules/7`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(204);
    } finally {
      server.close();
    }
  });

  it('dry-runs a rule via POST /rules/:ruleId/dry-run and forwards the Device identity', async () => {
    let receivedPath: string | undefined;
    let receivedMethod: string | undefined;
    let receivedBody: Record<string, unknown> | undefined;
    let receivedContentType: string | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      receivedPath = req.url;
      receivedMethod = req.method;
      receivedContentType = req.headers['content-type'];
      readBody(req).then((raw) => {
        receivedBody = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rule: { id: 7 }, result: { door_action: 'lock', rule_command: null } }));
      });
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.result.door_action).toBe('lock');
      expect(receivedMethod).toBe('POST');
      expect(receivedPath).toBe('/rules/7/dry-run');
      expect(receivedContentType).toContain('application/json');
      expect(receivedBody).toEqual({ device_id: device.id, zone_id: zoneA.id, execute: false });
    } finally {
      server.close();
    }
  });

  it('forwards execute true when the client explicitly asks for it', async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      readBody(req).then((raw) => {
        receivedBody = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rule: { id: 7 }, result: {}, executed: true, queued: ['buzzer'] }));
      });
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ execute: true });

      expect(res.status).toBe(200);
      expect(res.body.queued).toEqual(['buzzer']);
      expect(receivedBody).toEqual({ device_id: device.id, zone_id: zoneA.id, execute: true });
    } finally {
      server.close();
    }
  });

  it('ignores client-supplied device_id and zone_id on dry-run', async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const { server, url } = await startFakeEdge((req, res) => {
      readBody(req).then((raw) => {
        receivedBody = JSON.parse(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rule: { id: 7 }, result: {} }));
      });
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ device_id: 'attacker-device', zone_id: 'attacker-zone', execute: false });

      expect(res.status).toBe(200);
      expect(receivedBody).toEqual({ device_id: device.id, zone_id: zoneA.id, execute: false });
    } finally {
      server.close();
    }
  });

  it('rejects a non-boolean execute with 400 and never contacts Edge', async () => {
    let edgeCalled = false;
    const { server, url } = await startFakeEdge((_req, res) => {
      edgeCalled = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });

    try {
      const device = await createDeviceDirect(url);

      for (const execute of ['true', 1, 'yes']) {
        const res = await request(app.getHttpServer())
          .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
          .set('Authorization', `Bearer ${jwtA}`)
          .send({ execute });
        expect(res.status).toBe(400);
      }
      expect(edgeCalled).toBe(false);
    } finally {
      server.close();
    }
  });

  it('dry-run returns 404 for a device owned by another operator and 400 without edgeUrl', async () => {
    const device = await createDeviceDirect(null);

    const other = await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
      .set('Authorization', `Bearer ${jwtB}`)
      .send({});
    expect(other.status).toBe(404);

    const noEdge = await request(app.getHttpServer())
      .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
      .set('Authorization', `Bearer ${jwtA}`)
      .send({});
    expect(noEdge.status).toBe(400);
  });

  it('remaps a raw Edge 401 to Cloud 502 on dry-run', async () => {
    const { server, url } = await startFakeEdge((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });

    try {
      const device = await createDeviceDirect(url);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/rules/7/dry-run`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(res.status).toBe(502);
    } finally {
      server.close();
    }
  });
});
