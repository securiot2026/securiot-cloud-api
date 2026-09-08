import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateDeviceDto {
  @ApiProperty({ example: 'Front Door Sensor' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'b3f1c2a4-1234-4a5b-8c9d-0e1f2a3b4c5d' })
  @IsUUID()
  zoneId: string;
}
