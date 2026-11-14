import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

const CONDITION_TYPES = ['object_class', 'weapon', 'fire', 'occupancy', 'sensor_threshold'] as const;
const OPERATORS = ['>', '<', '=='] as const;

export class CreateRuleDto {
  @ApiProperty({ example: 'Weapon at front door' })
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty({ enum: CONDITION_TYPES })
  @IsIn(CONDITION_TYPES)
  condition_type: (typeof CONDITION_TYPES)[number];

  @ApiPropertyOptional({ enum: OPERATORS, description: "Required for condition_type 'sensor_threshold'" })
  @IsOptional()
  @IsIn(OPERATORS)
  operator?: (typeof OPERATORS)[number];

  @ApiPropertyOptional({ description: "Required for condition_type 'sensor_threshold'" })
  @IsOptional()
  @IsString()
  sensor_type?: string;

  @ApiPropertyOptional({
    description:
      "Target class name for 'object_class', daily limit for 'occupancy', threshold value for 'sensor_threshold'",
  })
  @IsOptional()
  @IsString()
  match_value?: string;

  @ApiProperty({
    description: "Non-empty list of {type, ...} action objects, e.g. [{\"type\": \"door_lock\"}]",
    example: [{ type: 'alert', severity: 'high' }],
  })
  @IsArray()
  actions: Record<string, unknown>[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Lower number wins conflicts on the same actuator', default: 100 })
  @IsOptional()
  @IsInt()
  priority?: number;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  cooldown_seconds?: number;
}
