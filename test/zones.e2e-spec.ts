import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User } from '../src/users/user.entity';

describe('Zones (e2e)', () => {
  let app: INestApplication;
  let jwtA: string;
  let jwtB: string;

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
    const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
    await userRepo.save(userRepo.create({ email: 'zones-a@securiot.local', passwordHash }));
    await userRepo.save(userRepo.create({ email: 'zones-b@securiot.local', passwordHash }));

    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'zones-a@securiot.local', password: 'ChangeMe123!' });
    jwtA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'zones-b@securiot.local', password: 'ChangeMe123!' });
    jwtB = loginB.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets the owner fetch their own zone by id', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Zone Detail', location: 'Backyard' });

    const zoneId = createRes.body.id;

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zoneId}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(zoneId);
    expect(getRes.body.name).toBe('Zone Detail');
  });

  it('returns 404 (not 403) when another user requests a zone they do not own', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Zone Owned By A' });

    const zoneId = createRes.body.id;

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zoneId}`)
      .set('Authorization', `Bearer ${jwtB}`);

    expect(getRes.status).toBe(404);
  });

  it('lets the owner update their zone but rejects updates from another user with 404', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Zone To Update', location: 'Original' });

    const zoneId = createRes.body.id;

    const updateResA = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${zoneId}`)
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Zone Updated', location: 'New Location' });

    expect(updateResA.status).toBe(200);
    expect(updateResA.body.name).toBe('Zone Updated');
    expect(updateResA.body.location).toBe('New Location');

    const updateResB = await request(app.getHttpServer())
      .patch(`/api/v1/zones/${zoneId}`)
      .set('Authorization', `Bearer ${jwtB}`)
      .send({ name: 'Hijacked' });

    expect(updateResB.status).toBe(404);
  });

  it('lets the owner delete their zone, after which it is no longer retrievable', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/zones')
      .set('Authorization', `Bearer ${jwtA}`)
      .send({ name: 'Zone To Delete' });

    const zoneId = createRes.body.id;

    const deleteRes = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${zoneId}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect([200, 204]).toContain(deleteRes.status);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zoneId}`)
      .set('Authorization', `Bearer ${jwtA}`);

    expect(getRes.status).toBe(404);
  });
});
