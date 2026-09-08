import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from './alert.entity';
import { AlertsService } from './alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Alert])],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
