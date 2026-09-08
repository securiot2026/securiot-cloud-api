import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateZoneDto {
  @ApiProperty({ example: 'Front Entrance' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Ground floor, main door', required: false })
  @IsString()
  @IsOptional()
  location?: string;
}
