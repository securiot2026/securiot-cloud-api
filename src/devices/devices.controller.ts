import {
  Body,
  Controller,
  Delete,
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
import { SetFaceRecognitionDto } from './dto/set-face-recognition.dto';
import { CreateCommandDto } from './dto/create-command.dto';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
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

  @Get(':id/face-recognition')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a device's current face-recognition on/off state, proxied from its Edge API" })
  @ApiResponse({ status: 200, description: 'Current face-recognition state' })
  @ApiResponse({ status: 400, description: 'edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async getFaceRecognitionStatus(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.getFaceRecognitionStatus(id, user.sub, res);
  }

  @Patch(':id/face-recognition')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Turn a device's face recognition on or off, proxied to its Edge API" })
  @ApiResponse({ status: 200, description: 'Face-recognition state updated' })
  @ApiResponse({ status: 400, description: 'Validation failed, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async setFaceRecognitionStatus(
    @Param('id') id: string,
    @Body() dto: SetFaceRecognitionDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.setFaceRecognitionStatus(id, user.sub, dto.enabled, res);
  }

  @Post(':id/commands')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Queue a manual command (pan/tilt, light, or buzzer) for the device, proxied to its Edge API',
    description:
      "Delivered on the device's next /frames poll (~2s), expires if not delivered in time, and temporarily suppresses the matching automatic action on the same actuator.",
  })
  @ApiResponse({ status: 201, description: 'Command queued' })
  @ApiResponse({ status: 400, description: 'Validation failed, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async createCommand(
    @Param('id') id: string,
    @Body() dto: CreateCommandDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.createCommand(id, user.sub, dto, res);
  }

  @Get(':id/frame')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get the device's last captured camera frame, proxied live from its Edge API",
    description:
      'Never cached or stored on Cloud — every call proxies live to the Edge API. FEED-03: neither Edge nor Cloud retain any frame history, only the single latest one.',
  })
  @ApiResponse({ status: 200, description: 'Latest frame (base64 JPEG) with its real capture timestamp' })
  @ApiResponse({ status: 400, description: 'edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found/not owned, or the device has not captured a frame yet' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async getLatestFrame(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.getLatestFrame(id, user.sub, res);
  }

  @Get(':id/commands/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the delivery status (pending/delivered/none) of the most recent manual command for an actuator',
    description: "CTRL-05: lets the Mobile/Web App show pending -> entregado feedback after queuing a command.",
  })
  @ApiResponse({ status: 200, description: 'Command status' })
  @ApiResponse({ status: 400, description: 'Missing/invalid actuator query param, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async getCommandStatus(
    @Param('id') id: string,
    @Query('actuator') actuator: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.getCommandStatus(id, user.sub, actuator, res);
  }

  @Get(':id/occupancy')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get the device's zone occupancy counter for today, proxied live from its Edge API",
    description: 'EXTR-02: current (casi real-time) occupancy count, reset daily at UTC midnight on the Edge side.',
  })
  @ApiResponse({ status: 200, description: 'Occupancy count' })
  @ApiResponse({ status: 400, description: 'edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async getOccupancy(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.getOccupancy(id, user.sub, res);
  }

  @Get(':id/rules')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List a device's rules, proxied from its Edge API" })
  @ApiResponse({ status: 200, description: 'List of rules' })
  @ApiResponse({ status: 400, description: 'edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async listRules(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.listRules(id, user.sub, res);
  }

  @Post(':id/rules')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a rule for a device, proxied to its Edge API' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  @ApiResponse({ status: 400, description: 'Validation failed, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device not found or not owned by the authenticated user' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async createRule(
    @Param('id') id: string,
    @Body() dto: CreateRuleDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.createRule(id, user.sub, dto as unknown as Record<string, unknown>, res);
  }

  @Patch(':id/rules/:ruleId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a rule (including enable/disable), proxied to its Edge API' })
  @ApiResponse({ status: 200, description: 'Rule updated' })
  @ApiResponse({ status: 400, description: 'Validation failed, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device or rule not found' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async updateRule(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateRuleDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.updateRule(id, ruleId, user.sub, dto as unknown as Record<string, unknown>, res);
  }

  @Post(':id/rules/:ruleId/dry-run')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Manually fire a rule's configured action to test it (RULE-11), proxied to its Edge API" })
  @ApiResponse({ status: 200, description: 'Rule action executed' })
  @ApiResponse({ status: 400, description: 'Rule disabled, or edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device or rule not found' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async dryRunRule(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.dryRunRule(id, ruleId, user.sub, res);
  }

  @Delete(':id/rules/:ruleId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a rule, proxied to its Edge API' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 400, description: 'edgeUrl not configured for this device' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Device or rule not found' })
  @ApiResponse({ status: 502, description: 'Could not reach the device Edge API, or it rejected the admin credential' })
  async deleteRule(
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = (req as Request & { user: JwtPayload }).user;
    await this.devicesService.deleteRule(id, ruleId, user.sub, res);
  }
}
