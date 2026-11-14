import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './subscription.entity';
import { Payment } from './payment.entity';
import { CheckoutDto } from './dto/checkout.dto';
import { CURRENCY, IGV_RATE, PLANS, findPlan } from './plans';
import { computeCharge } from './pricing';
import { PaymentGatewaySimulator, detectCardBrand, normalizeCardNumber } from './payment-gateway-simulator.service';

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly gateway: PaymentGatewaySimulator,
  ) {}

  getPlans() {
    return { currency: CURRENCY, igvRate: IGV_RATE, plans: PLANS };
  }

  async checkout(dto: CheckoutDto, ownerId: string) {
    const plan = findPlan(dto.planId);
    if (!plan) throw new BadRequestException('Unknown plan');
    if (dto.card.expYear < new Date().getFullYear()) {
      throw new BadRequestException('card.expYear must not be in the past');
    }

    const existing = await this.subscriptions.findOne({ where: { ownerId, status: 'active' } });
    if (existing) throw new ConflictException('Active subscription already exists');

    const charge = computeCharge(plan, dto.cameras);
    const digits = normalizeCardNumber(dto.card.number);
    const cardBrand = detectCardBrand(digits);
    const last4 = digits.slice(-4);
    // dto.card is not used after this call, so the number, holder and cvc never reach storage or logs.
    const result = await this.gateway.charge(dto.card.number);

    const base = {
      ownerId,
      planId: plan.id,
      cameras: dto.cameras,
      subtotal: charge.subtotal,
      igv: charge.igv,
      total: charge.total,
      currency: CURRENCY,
      cardBrand,
      last4,
    };

    if (!result.approved) {
      const declined = await this.payments.save(
        this.payments.create({ ...base, status: 'declined', reason: result.reason ?? 'card_declined', subscriptionId: null, createdAt: new Date() }),
      );
      throw new HttpException({ payment: this.presentPayment(declined) }, 402);
    }

    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    const subscription = await this.subscriptions.save(
      this.subscriptions.create({
        ownerId,
        planId: plan.id,
        cameras: dto.cameras,
        status: 'active',
        monthlyPerCamera: plan.monthlyPerCamera,
        currentPeriodEnd: periodEnd,
        createdAt: new Date(),
      }),
    );
    const payment = await this.payments.save(
      this.payments.create({ ...base, status: 'approved', reason: null, subscriptionId: subscription.id, createdAt: new Date() }),
    );
    return { payment: this.presentPayment(payment), subscription: this.presentSubscription(subscription) };
  }

  async getForOwner(ownerId: string) {
    const subscription = await this.subscriptions.findOne({
      where: { ownerId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    const payments = await this.payments.find({ where: { ownerId }, order: { createdAt: 'DESC' } });
    return {
      subscription: subscription ? this.presentSubscription(subscription) : null,
      payments: payments.map((p) => this.presentPayment(p)),
    };
  }

  async cancel(ownerId: string) {
    const subscription = await this.subscriptions.findOne({ where: { ownerId, status: 'active' } });
    if (!subscription) throw new NotFoundException('No active subscription');
    subscription.status = 'canceled';
    await this.subscriptions.save(subscription);
    return this.presentSubscription(subscription);
  }

  private presentPayment(p: Payment) {
    return {
      id: p.id,
      status: p.status,
      ...(p.status === 'declined' ? { reason: p.reason } : {}),
      subtotal: p.subtotal,
      igv: p.igv,
      total: p.total,
      currency: p.currency,
      cardBrand: p.cardBrand,
      last4: p.last4,
      createdAt: p.createdAt,
    };
  }

  private presentSubscription(s: Subscription) {
    return {
      id: s.id,
      planId: s.planId,
      cameras: s.cameras,
      status: s.status,
      monthlyPerCamera: s.monthlyPerCamera,
      currentPeriodEnd: s.currentPeriodEnd,
      createdAt: s.createdAt,
    };
  }
}
