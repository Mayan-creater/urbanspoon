import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AiFoodRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(600)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(500_000)
  budgetMinor?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  people?: number;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  dietaryTags?: string[];
}

export class AiReviewAnalysisDto {
  @IsUUID()
  restaurantId!: string;
}

export class AiSmartCartDto {
  @IsUUID()
  cartId!: string;
}

export class AiRestaurantInsightsDto {
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(90)
  days?: number;
}

export class AiMenuDraftDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1200)
  itemInformation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  claimedDietaryTags?: string[];
}