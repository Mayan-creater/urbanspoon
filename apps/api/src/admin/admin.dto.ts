import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RequestRefundDto {
  @IsUUID()
  paymentAttemptId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000000)
  amountMinor!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000000)
  restaurantAdjustmentMinor?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class RejectRefundDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'DISABLED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
