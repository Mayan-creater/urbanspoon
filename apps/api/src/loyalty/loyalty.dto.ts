import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLoyaltyRuleDto {
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  earnRateBps!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  redeemMinorPerPoint?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3_650)
  pointsExpireAfterDays?: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}

export class CreateMembershipPlanDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  key!: string;

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(300)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  priceMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsIn(['MONTHLY', 'YEARLY'])
  interval!: 'MONTHLY' | 'YEARLY';

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  benefits!: string[];

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}