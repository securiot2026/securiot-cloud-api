import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AlertsService } from './alerts.service';
import { QueryAlertsDto } from './dto/query-alerts.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Alert } from './alert.entity';
import { JwtPayload } from '../auth/jwt.strategy';

@ApiTags('alerts')
@Controller({ path: 'alerts', version: '1' })
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List alerts for zones/devices owned by the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of alerts, optionally filtered by zone/device/status' })
  @ApiResponse({ status: 400, description: 'Invalid query filters' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  findAll(@Query() query: QueryAlertsDto, @Req() req: Request): Promise<Alert[]> {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.alertsService.findAllForOwner(user.sub, query);
  }
}
