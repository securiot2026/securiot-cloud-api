import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ZonesService } from './zones.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Zone } from './zone.entity';
import { JwtPayload } from '../auth/jwt.strategy';

@ApiTags('zones')
@Controller({ path: 'zones', version: '1' })
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a zone owned by the authenticated user' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  @ApiResponse({ status: 400, description: 'Validation failed on request body' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  create(@Body() dto: CreateZoneDto, @Req() req: Request): Promise<Zone> {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.zonesService.create(dto, user.sub);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List zones owned by the authenticated user' })
  @ApiResponse({ status: 200, description: 'List of zones owned by the authenticated user' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  findAll(@Req() req: Request): Promise<Zone[]> {
    const user = (req as Request & { user: JwtPayload }).user;
    return this.zonesService.findAllForOwner(user.sub);
  }
}
