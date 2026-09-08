import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { Reading } from './entities/reading.entity';
import { Device } from '../devices/device.entity';
import { Zone } from '../zones/zone.entity';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { DeviceApiKeyGuard } from './guards/device-api-key.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reading, Device, Zone]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuthModule,
  ],
  controllers: [TelemetryController],
  providers: [TelemetryService, DeviceApiKeyGuard],
})
export class TelemetryModule {}
