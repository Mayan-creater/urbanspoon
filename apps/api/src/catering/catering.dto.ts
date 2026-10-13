import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateCateringRequestDto {
  @IsInt()
  @Min(5)
  @Max(5000)
  guestCount!: number;

  @IsInt()
  @Min(500)
  @Max(100_000_000)
  budgetMinor!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  cuisineTypes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  dietaryTags?: string[];

  @IsString()
  @MinLength(3)
  @MaxLength(100)
  occasion!: string;

  @IsDateString()
  eventAt!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  state!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(12)
  postalCode!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(180)
  venueAddress!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class SetCateringEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CreateCateringQuoteDto {
  @IsInt()
  @Min(100)
  @Max(100_000_000)
  amountMinor!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20_000_000)
  taxMinor?: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(120, { each: true })
  inclusions!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsDateString()
  validUntil!: string;
}