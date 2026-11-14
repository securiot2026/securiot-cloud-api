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

describe('Devices — faces + edgeUrl (e2e)', () => {
  let app: INestApplication;
  let jwtA: string;
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
      userRepo.create({ email: 'devices-faces-a@securiot.local', passwordHash }),
    );

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'devices-faces-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    zoneA = await zoneRepo.save(zoneRepo.create({ name: 'Zone Faces A', ownerId: userA.id }));
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeviceDirect(edgeUrl: string | null = null): Promise<Device> {
    return deviceRepo.save(
      deviceRepo.create({
        name: 'Faces Device',
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

  describe('PATCH /api/v1/devices/:id — edgeUrl', () => {
    it('saves a valid edgeUrl and GET :id returns it back', async () => {
      const device = await createDeviceDirect();

      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${device.id}`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ edgeUrl: 'http://192.168.1.50:5000' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.edgeUrl).toBe('http://192.168.1.50:5000');

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/devices/${device.id}`)
        .set('Authorization', `Bearer ${jwtA}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.edgeUrl).toBe('http://192.168.1.50:5000');
    });

    it('rejects an edgeUrl with a loopback hostname', async () => {
      const device = await createDeviceDirect();

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/devices/${device.id}`)
        .set('Authorization', `Bearer ${jwtA}`)
        .send({ edgeUrl: 'http://127.0.0.1:5000' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/devices/:id/faces', () => {
    it('returns 400 when the device has no edgeUrl configured', async () => {
      const device = await createDeviceDirect(null);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/faces`)
        .set('Authorization', `Bearer ${jwtA}`)
        .field('name', 'Ada Lovelace')
        .attach('images', Buffer.from('fake-jpeg-bytes'), 'face.jpg');

      expect(res.status).toBe(400);
    });

    it('proxies to the device edge-api, forwards X-Admin-Key, and mirrors a 201 response', async () => {
      let receivedAdminKey: string | undefined;
      let receivedBody = '';
      const { server, url } = await startFakeEdge((req, res) => {
        receivedAdminKey = req.headers['x-admin-key'] as string;
        req.on('data', (chunk) => {
          receivedBody += chunk;
        });
        req.on('end', () => {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ identity_path: '/data/faces/ada/identity.npz', accepted_images: 1 }));
        });
      });

      try {
        const device = await createDeviceDirect(url);

        const res = await request(app.getHttpServer())
          .post(`/api/v1/devices/${device.id}/faces`)
          .set('Authorization', `Bearer ${jwtA}`)
          .field('name', 'Ada Lovelace')
          .attach('images', Buffer.from('fake-jpeg-bytes'), 'face.jpg');

        expect(res.status).toBe(201);
        expect(res.body.accepted_images).toBe(1);
        expect(receivedAdminKey).toBe('e2e-admin-key');
        expect(receivedBody).toContain('fake-jpeg-bytes');
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
          .post(`/api/v1/devices/${device.id}/faces`)
          .set('Authorization', `Bearer ${jwtA}`)
          .field('name', 'Ada Lovelace')
          .attach('images', Buffer.from('fake-jpeg-bytes'), 'face.jpg');

        expect(res.status).toBe(502);
      } finally {
        server.close();
      }
    });

    it('returns 502 when the device edgeUrl is unreachable', async () => {
      const device = await createDeviceDirect('http://127.0.0.1:1');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/devices/${device.id}/faces`)
        .set('Authorization', `Bearer ${jwtA}`)
        .field('name', 'Ada Lovelace')
        .attach('images', Buffer.from('fake-jpeg-bytes'), 'face.jpg');

      expect(res.status).toBe(502);
    });
  });
});
