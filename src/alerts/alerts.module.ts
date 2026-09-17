import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { Alert } from './alert.entity';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { DeviceOfflineCheckService } from './device-offline-check.service';
import { AuthModule } from '../auth/auth.module';
import { Device } from '../devices/device.entity';
import { Reading } from '../telemetry/entities/reading.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, Device, Reading]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuthModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService, DeviceOfflineCheckService],
  exports: [AlertsService],
})
export class AlertsModule {}
