import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryAlertsDto {
  @ApiPropertyOptional({ description: 'Filter by zone id' })
  @IsOptional()
  @IsUUID()
  zone_id?: string;

  @ApiPropertyOptional({ description: 'Filter by device id' })
  @IsOptional()
  @IsUUID()
  device_id?: string;

  @ApiPropertyOptional({ description: 'Filter by status', enum: ['active', 'resolved'] })
  @IsOptional()
  @IsIn(['active', 'resolved'])
  status?: string;
}
