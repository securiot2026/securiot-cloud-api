import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { DeviceCreatedResponseDto, DeviceResponseDto, DeviceStatusResponseDto } from './dto/device-response.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';

@ApiTags('devices')
@Controller({ path: 'devices', version: '1' })
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a device under one of the authenticated user own zones',
    description: 'The response apiKey is shown in full only here. It is never returned again by any other endpoint.',
  })
  @ApiResponse({ status: 201, description: 'Device created, apiKey shown once' })
  @ApiResponse({ status: 400, description: 'Validation failed on request body' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Zone not found or not owned by the authenticated user' })
  create(@Body() dto: CreateDeviceDto, @Req() req: Request): Promise<DeviceCreatedResponseDto> {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.devicesService.create(dto, user.sub);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List devices owned by the authenticated user (via zone ownership), apiKey never included' })
  @ApiResponse({ status: 200, description: 'List of devices owned by the authenticated user' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  findAll(@Req() req: Request, @Query('zone_id') zoneId?: string): Promise<DeviceResponseDto[]> {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.devicesService.findAllForOwner(user.sub, zoneId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get device detail with online/offline status and last reading' })
  @ApiResponse({ status: 200, description: 'Device status' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  async findOne(@Param('id') id: string, @Req() req: Request): Promise<DeviceStatusResponseDto> {
    const user = (req as Request & { user: JwtPayload }).user;
    const device = await this.devicesService.findOneForOwner(id, user.sub);
    return this.devicesService.getStatus(device);
  }
}
