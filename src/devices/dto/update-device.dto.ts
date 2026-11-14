import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUrl } from 'class-validator';

export class UpdateDeviceDto {
  @ApiPropertyOptional({ example: 'http://192.168.1.50:5000', description: "Base URL of this device's Edge API" })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true })
  edgeUrl?: string;
}
