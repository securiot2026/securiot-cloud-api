import { ApiProperty } from '@nestjs/swagger';
import { Reading } from '../../telemetry/entities/reading.entity';

export class DeviceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  zoneId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'Base URL of this device\'s Edge API, or null if not configured', nullable: true })
  edgeUrl: string | null;
}

export class DeviceCreatedResponseDto extends DeviceResponseDto {
  @ApiProperty({ description: 'API key for this device. Shown only once, on creation.' })
  apiKey: string;
}

export class DeviceStatusResponseDto extends DeviceResponseDto {
  @ApiProperty({ description: 'True if the last reading was recorded within the online window' })
  isOnline: boolean;

  @ApiProperty({ description: 'Most recent reading for this device, or null if none exists', nullable: true })
  lastReading: Reading | null;
}
