import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCartDto {
  @IsUUID()
  restaurantId!: string;
}

export class AddCartItemDto {
  @IsUUID()
  menuItemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  optionIds?: string[];
}

export class UpdateCartItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  optionIds?: string[];
}

export class CheckoutPreviewDto {
  @IsUUID()
  cartId!: string;

  @IsOptional()
  @IsUUID()
  addressId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  loyaltyPoints?: number;

  @IsOptional()
  @IsIn([500, 1000, 1500])
  tipBasisPoints?: 500 | 1000 | 1500;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000000)
  customTipMinor?: number;
}

export class CreatePricingRuleDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  ruleKey!: string;

  @IsIn(['DELIVERY_FEE', 'PACKAGING_FEE', 'SERVICE_FEE', 'TAX'])
  type!: 'DELIVERY_FEE' | 'PACKAGING_FEE' | 'SERVICE_FEE' | 'TAX';

  @IsIn(['FIXED', 'PERCENTAGE'])
  valueType!: 'FIXED' | 'PERCENTAGE';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000000)
  value!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  scopeState?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(['ITEM_SUBTOTAL', 'DELIVERY_FEE', 'PACKAGING_FEE', 'SERVICE_FEE'], { each: true })
  appliesTo?: string[];

  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;

  @IsString()
  @Min(3)
  @MaxLength(160)
  source!: string;
}

export class CreateCouponDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{2,63}$/)
  campaignKey!: string;

  @IsString()
  @MaxLength(100)
  campaignName!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,40}$/)
  code!: string;

  @IsIn(['FIXED', 'PERCENTAGE'])
  discountType!: 'FIXED' | 'PERCENTAGE';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000000)
  discountValue!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000000)
  minSubtotalMinor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000000)
  maxDiscountMinor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000000)
  usageLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  perUserLimit?: number;

  @IsOptional()
  @IsBoolean()
  firstOrderOnly?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
