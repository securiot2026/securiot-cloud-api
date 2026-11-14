import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PLAN_IDS, PlanId } from '../plans';

export class CardDto {
  @ApiProperty({ example: '4242 4242 4242 4242', description: 'Simulator test card number. Never stored.' })
  @IsString()
  @Matches(/^[\d\s-]{12,29}$/, { message: 'card.number must contain digits, spaces or dashes only' })
  number: string;

  @ApiProperty({ example: 'Test User', description: 'Never stored.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  holder: string;

  @ApiProperty({ example: 12, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  expMonth: number;

  @ApiProperty({ example: 2030, description: '4 digits, not in the past' })
  @IsInt()
  @Min(1000)
  @Max(9999)
  expYear: number;

  @ApiProperty({ example: '123', description: '3 or 4 digits. Never stored.' })
  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'card.cvc must be 3 or 4 digits' })
  cvc: string;
}

export class CheckoutDto {
  @ApiProperty({ enum: PLAN_IDS, example: 'standard' })
  @IsIn(PLAN_IDS)
  planId: PlanId;

  @ApiProperty({ example: 2, minimum: 1, maximum: 8 })
  @IsInt()
  @Min(1)
  @Max(8)
  cameras: number;

  @ApiProperty({ type: CardDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CardDto)
  card: CardDto;
}
