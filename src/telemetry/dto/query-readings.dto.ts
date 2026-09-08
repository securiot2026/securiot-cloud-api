import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class QueryReadingsDto {
  @ApiPropertyOptional({ description: 'Filter by device id' })
  @IsOptional()
  @IsString()
  device_id?: string;

  @ApiPropertyOptional({ description: 'Filter by zone id' })
  @IsOptional()
  @IsString()
  zone_id?: string;

  @ApiPropertyOptional({ description: 'ISO8601 lower bound on recordedAt' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO8601 upper bound on recordedAt' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
