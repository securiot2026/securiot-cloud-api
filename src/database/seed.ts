import 'reflect-metadata';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '../config/typeorm.config';
import { User } from '../users/user.entity';
import { Zone } from '../zones/zone.entity';
import { Device } from '../devices/device.entity';

config();

async function seed() {
  if ((process.env.DB_DRIVER || 'postgres') === 'sqlite') {
    const dbPath = process.env.DB_SQLITE_PATH || './data/securiot.sqlite';
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  await AppDataSource.initialize();

  const userEmail = process.env.SEED_USER_EMAIL || 'test@securiot.local';
  const userPassword = process.env.SEED_USER_PASSWORD || 'ChangeMe123!';

  const userRepo = AppDataSource.getRepository(User);
  let user = await userRepo.findOne({ where: { email: userEmail } });
  if (!user) {
    const passwordHash = await bcrypt.hash(userPassword, 10);
    user = await userRepo.save(userRepo.create({ email: userEmail, passwordHash }));
    console.log(`Seeded user: ${userEmail}`);
  } else {
    console.log(`User already exists: ${userEmail}`);
  }

  const zoneRepo = AppDataSource.getRepository(Zone);
  let zone = await zoneRepo.findOne({ where: { name: 'Front Entrance' } });
  if (!zone) {
    zone = await zoneRepo.save(zoneRepo.create({ name: 'Front Entrance', ownerId: user.id }));
    console.log(`Seeded zone: ${zone.name} (${zone.id})`);
  } else {
    console.log(`Zone already exists: ${zone.name} (${zone.id})`);
  }

  const deviceRepo = AppDataSource.getRepository(Device);
  let device = await deviceRepo.findOne({ where: { name: 'Front Door Sensor' } });
  if (!device) {
    const apiKey = crypto.randomBytes(24).toString('hex');
    device = await deviceRepo.save(
      deviceRepo.create({ name: 'Front Door Sensor', apiKey, zoneId: zone.id }),
    );
    console.log(`Seeded device: ${device.name} (${device.id})`);
    console.log(`Device API key (set SEED_DEVICE_API_KEY to this value): ${apiKey}`);
  } else {
    console.log(`Device already exists: ${device.name} (${device.id})`);
    console.log('Device API key unchanged (not printed again for an existing device)');
  }

  await AppDataSource.destroy();
}

seed()
  .then(() => {
    console.log('Seed complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
