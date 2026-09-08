import { registerAs } from '@nestjs/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity';
import { Zone } from '../zones/zone.entity';
import { Device } from '../devices/device.entity';
import { Reading } from '../telemetry/entities/reading.entity';
import { Alert } from '../alerts/alert.entity';

const entities = [User, Zone, Device, Reading, Alert];

export function buildDataSourceOptions(): DataSourceOptions {
  const driver = process.env.DB_DRIVER || 'postgres';

  if (driver === 'sqlite') {
    return {
      type: 'better-sqlite3',
      database: process.env.DB_SQLITE_PATH || './data/securiot.sqlite',
      entities,
      synchronize: true,
    };
  }

  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'securiot',
    entities,
    synchronize: true,
  };
}

export default registerAs('typeorm', () => buildDataSourceOptions());

export const AppDataSource = new DataSource(buildDataSourceOptions());
