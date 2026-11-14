import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetFaceRecognitionDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;
}
