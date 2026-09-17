import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject } from 'class-validator';

const ACTUATORS = ['pan_tilt', 'light', 'buzzer'] as const;

export class CreateCommandDto {
  @ApiProperty({ enum: ACTUATORS, example: 'light' })
  @IsIn(ACTUATORS)
  actuator: 'pan_tilt' | 'light' | 'buzzer';

  @ApiProperty({
    description:
      "Actuator-specific payload: {pan_delta, tilt_delta} for 'pan_tilt', {on: boolean} for 'light'/'buzzer'. Validated further by the Edge API.",
    example: { on: true },
  })
  @IsObject()
  action: Record<string, unknown>;
}
