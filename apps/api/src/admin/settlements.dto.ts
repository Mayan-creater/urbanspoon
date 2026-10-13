import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GenerateSettlementDto {
  @IsUUID()
  restaurantId!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class CreateCommissionRuleDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  ruleKey!: string;

  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  rateBps!: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}

export class SettlementAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(-100000000)
  @Max(100000000)
  amountMinor!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class MarkSettlementPaidDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{3,160}$/)
  externalTransferReference!: string;
}
