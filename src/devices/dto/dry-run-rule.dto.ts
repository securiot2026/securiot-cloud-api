import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class DryRunRuleDto {
  @ApiPropertyOptional({
    description:
      "When true, the Edge also queues the rule's light, buzzer or door lock effect for the device. Defaults to false: a dry-run then only records a marked Reading/alert and never touches the device.",
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  execute?: boolean;
}
