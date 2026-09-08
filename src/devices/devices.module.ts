import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { Device } from './device.entity';
import { Zone } from '../zones/zone.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Device, Zone]), PassportModule.register({ defaultStrategy: 'jwt' }), AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
