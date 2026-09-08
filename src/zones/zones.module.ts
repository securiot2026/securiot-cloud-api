import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { Zone } from './zone.entity';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Zone]), PassportModule.register({ defaultStrategy: 'jwt' }), AuthModule],
  controllers: [ZonesController],
  providers: [ZonesService],
})
export class ZonesModule {}
