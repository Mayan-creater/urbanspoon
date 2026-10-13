import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderIntentDto {
  @IsUUID()
  cartId!: string;

  @IsOptional()
  @IsUUID()
  addressId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,40}$/)
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

export class SandboxPaymentCompletionDto {
  @IsIn(['SUCCEEDED', 'FAILED'])
  outcome!: 'SUCCEEDED' | 'FAILED';
}

export class SandboxPaymentWebhookDto {
  @IsUUID()
  providerEventId!: string;

  @IsIn(['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED'])
  type!: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED';

  @IsUUID()
  paymentAttemptId!: string;

  @IsUUID()
  orderIntentId!: string;

  @IsString()
  @Length(1, 128)
  providerReference!: string;

  @IsInt()
  @Min(1)
  amountMinor!: number;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  failureCode?: string;
}

export class OrderReasonDto {
  @IsString()
  @Length(3, 240)
  reason!: string;
}
