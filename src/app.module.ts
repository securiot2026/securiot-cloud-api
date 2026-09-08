import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './config/typeorm.config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { ZonesModule } from './zones/zones.module';
import { DevicesModule } from './devices/devices.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ useFactory: () => buildDataSourceOptions() }),
    UsersModule,
    AuthModule,
    TelemetryModule,
    ZonesModule,
    DevicesModule,
  ],
})
export class AppModule {}
