import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { Subscription } from './subscription.entity';
import { Payment } from './payment.entity';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentGatewaySimulator } from './payment-gateway-simulator.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, Payment]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    AuthModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, PaymentGatewaySimulator],
})
export class BillingModule {}
