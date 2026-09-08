import { ApiProperty } from '@nestjs/swagger';

export class DeviceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  zoneId: string;

  @ApiProperty()
  createdAt: Date;
}

export class DeviceCreatedResponseDto extends DeviceResponseDto {
  @ApiProperty({ description: 'API key for this device. Shown only once, on creation.' })
  apiKey: string;
}
