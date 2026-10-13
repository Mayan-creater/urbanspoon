import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAddressDto {
  @IsString()
  @Length(1, 40)
  label!: string;

  @IsString()
  @Length(1, 160)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  line2?: string;

  @IsString()
  @Length(1, 80)
  city!: string;

  @IsString()
  @Length(1, 80)
  state!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9 -]{3,12}$/)
  postalCode!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

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
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  line1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  line2?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  city?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9 -]{3,12}$/)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

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
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
