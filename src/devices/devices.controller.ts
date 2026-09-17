import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
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

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a device's configuration (currently: its Edge API URL)" })
  @ApiResponse({ status: 200, description: 'Device updated' })
  @ApiResponse({ status: 400, description: 'Validation failed, or edgeUrl points to a loopback/link-local host' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
    @Req() req: Request,
  ): Promise<DeviceResponseDto> {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.devicesService.update(id, dto, user.sub);
  }

  @Post(':id/faces')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FilesInterceptor('images'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: "Enroll a new face identity on a device, proxied through to its Edge API" })
  @ApiResponse({ status: 201, description: 'Identity enrolled on the device' })
  @ApiResponse({ status: 400, description: 'Validation failed, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async enrollFace(
    @Param('id') id: string,
    @Body('name') name: string,
    @UploadedFiles() images: Array<{ buffer: Buffer; mimetype: string; originalname: string }>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.enrollFace(id, user.sub, name, images ?? [], res);
  }
}
