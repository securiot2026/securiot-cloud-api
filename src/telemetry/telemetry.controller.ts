import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TelemetryService } from './telemetry.service';
import { CreateReadingDto } from './dto/create-reading.dto';
import { QueryReadingsDto } from './dto/query-readings.dto';
import { DeviceApiKeyGuard } from './guards/device-api-key.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Device } from '../devices/device.entity';
import { Reading } from './entities/reading.entity';

@ApiTags('telemetry')
@Controller({ path: 'telemetry', version: '1' })
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Post()
  @UseGuards(DeviceApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'X-Device-Key', description: 'Device API key issued at seed time' })
  @ApiOperation({ summary: 'Ingest a telemetry reading (idempotent on reading_id)' })
  @ApiResponse({ status: 201, description: 'Reading persisted (or already existed with this reading_id)' })
  @ApiResponse({ status: 400, description: 'Validation failed on request body' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-Device-Key header' })
  ingest(@Body() dto: CreateReadingDto, @Req() req: Request): Promise<Reading> {
    const device = (req as Request & { device: Device }).device;
    return this.telemetryService.ingest(dto, device);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List telemetry readings, optionally filtered by device/zone/date range' })
  @ApiResponse({ status: 200, description: 'List of readings matching the filters' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  findAll(@Query() query: QueryReadingsDto): Promise<Reading[]> {
    return this.telemetryService.findAll(query);
  }
}
