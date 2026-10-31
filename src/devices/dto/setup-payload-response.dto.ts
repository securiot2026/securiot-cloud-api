import { ApiProperty } from '@nestjs/swagger';

export class DeviceSetupPayloadResponseDto {
  @ApiProperty({
    description: "Base URL of this device's Edge API without a trailing slash (the firmware appends /frames)",
    example: 'http://192.168.1.50:5000',
  })
  edgeApiUrl: string;

  @ApiProperty({
    description:
      'Shared device secret the device sends as X-Device-Key. Sensitive: only meant to be rendered in the one-time device setup QR, never stored or logged.',
  })
  deviceKey: string;

  @ApiProperty({ description: 'Device UUID' })
  deviceId: string;

  @ApiProperty({ description: 'UUID of the zone the device belongs to' })
  zoneId: string;
}
