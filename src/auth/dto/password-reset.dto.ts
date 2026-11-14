import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/** Minimum length (characters) of a new password. */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt only uses the first 72 BYTES of its input, so longer (or multibyte) passwords are rejected. */
export const PASSWORD_MAX_BYTES = 72;

@ValidatorConstraint({ name: 'maxBytes', async: false })
export class MaxBytesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [max] = args.constraints as [number];
    return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max;
  }

  defaultMessage(args: ValidationArguments): string {
    const [max] = args.constraints as [number];
    return `${args.property} must be at most ${max} bytes`;
  }
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'test@securiot.local' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the reset link (43 characters, base64url)' })
  @IsString()
  @MaxLength(200)
  token: string;

  @ApiProperty({
    example: 'a-new-long-password',
    minLength: PASSWORD_MIN_LENGTH,
    description: `At least ${PASSWORD_MIN_LENGTH} characters and at most ${PASSWORD_MAX_BYTES} bytes (UTF-8)`,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @Validate(MaxBytesConstraint, [PASSWORD_MAX_BYTES])
  newPassword: string;
}
