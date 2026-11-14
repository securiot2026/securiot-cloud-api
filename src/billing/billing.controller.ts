import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';

@ApiTags('billing')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  @ApiOperation({ summary: 'List the fixed plans (public). Prices are in PEN before IGV' })
  @ApiResponse({ status: 200, description: '{ currency, igvRate, plans[] }' })
  getPlans() {
    return this.billingService.getPlans();
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'SIMULATED checkout. No real card is processed and nothing is charged' })
  @ApiResponse({ status: 201, description: 'Approved: { payment, subscription }' })
  @ApiResponse({ status: 400, description: 'Validation failed on request body' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 402, description: 'Declined by the simulator: { payment } with a reason, no subscription' })
  @ApiResponse({ status: 409, description: 'Active subscription already exists' })
  checkout(@Body() dto: CheckoutDto, @Req() req: Request) {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.billingService.checkout(dto, user.sub);
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active subscription (or null) and payments, newest first' })
  @ApiResponse({ status: 200, description: '{ subscription, payments[] }' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  getSubscription(@Req() req: Request) {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.billingService.getForOwner(user.sub);
  }

  @Post('subscription/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the active subscription' })
  @ApiResponse({ status: 200, description: 'Canceled subscription' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'No active subscription' })
  cancel(@Req() req: Request) {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.billingService.cancel(user.sub);
  }
}
