import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  IsInt,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class DeliveryPartnerOnboardingDto {
  @IsIn(['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR'])
  vehicleType!: string;

  @IsOptional()
  @IsIn(['IN', 'US', 'EU', 'CN', 'RU'])
  marketRegion?: 'IN' | 'US' | 'EU' | 'CN' | 'RU';
}

export class DeliveryAvailabilityDto {
  @IsBoolean()
  isOnline!: boolean;
}

export class DeliveryPartnerReviewDto {
  @IsBoolean()
  verified!: boolean;

  @IsOptional()
  @IsString()
  @Length(3, 240)
  reason?: string;

  @IsOptional()
  @IsIn(['MANUAL', 'EXTERNAL'])
  verificationProvider?: 'MANUAL' | 'EXTERNAL';

  @IsOptional()
  @IsString()
  @Length(4, 120)
  @Matches(/^(?=.*[A-Za-z])[A-Za-z0-9._:-]+$/)
  verificationReference?: string;
}

export class PartnerPayoutRequestDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class PartnerPayoutRejectDto {
  @IsString()
  @Length(3, 240)
  reason!: string;
}

export class PartnerPayoutPaidDto {
  @IsString()
  @Length(4, 160)
  providerReference!: string;
}

export class DeliveryOfferResponseDto {
  @IsString()
  @Length(3, 240)
  reason!: string;
}

export class DeliveryCompletionDto {
  @Matches(/^\d{6}$/)
  deliveryCode!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50000)
  cashTipMinor?: number;
}

export class DeliveryFailureDto {
  @IsString()
  @Length(3, 240)
  reason!: string;
}

export class DeliveryLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracyM?: number;

  @IsOptional()
  @IsUUID()
  deliveryId?: string;
}

export class DeliveryPartnerDocumentDto {
  @IsIn(['IDENTITY', 'VEHICLE'])
  evidenceType!: 'IDENTITY' | 'VEHICLE';
}

export class DeliveryProofUploadDto {
  @IsUUID()
  deliveryId!: string;

  @IsIn(['PICKUP_PROOF', 'DELIVERY_PROOF'])
  evidenceType!: 'PICKUP_PROOF' | 'DELIVERY_PROOF';
}
