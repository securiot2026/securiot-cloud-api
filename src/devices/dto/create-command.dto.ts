import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const ACTUATORS = ['pan_tilt', 'light', 'buzzer', 'door'] as const;

const DOOR_STATES = ['open', 'close'];

/**
 * For actuator 'door' the action must carry state 'open' or 'close' (exact,
 * lowercase). Every other actuator passes: the Edge API keeps validating those.
 */
@ValidatorConstraint({ name: 'doorActionState', async: false })
export class DoorActionStateConstraint implements ValidatorConstraintInterface {
  validate(action: unknown, args: ValidationArguments): boolean {
    const { actuator } = args.object as { actuator?: unknown };
    if (actuator !== 'door') {
      return true;
    }
    if (typeof action !== 'object' || action === null || Array.isArray(action)) {
      return false;
    }
    const state = (action as Record<string, unknown>).state;
    return typeof state === 'string' && DOOR_STATES.includes(state);
  }

  defaultMessage(): string {
    return "action.state must be 'open' or 'close' for actuator 'door'";
  }
}

export class CreateCommandDto {
  @ApiProperty({ enum: ACTUATORS, example: 'light' })
  @IsIn(ACTUATORS)
  actuator: 'pan_tilt' | 'light' | 'buzzer' | 'door';

  @ApiProperty({
    description:
      "Actuator-specific payload: {pan_delta, tilt_delta} for 'pan_tilt', {on: boolean} for 'light'/'buzzer', {state: 'open' | 'close'} for 'door'. Validated further by the Edge API.",
    example: { on: true },
  })
  @IsObject()
  @Validate(DoorActionStateConstraint)
  action: Record<string, unknown>;
}
