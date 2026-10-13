import { IsDateString, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateGroupOrderDto {
  @IsUUID()
  cartId!: string;

  @IsOptional()
  @IsDateString()
  deadlineAt?: string;
}

export class JoinGroupOrderDto {
  @IsString()
  @Length(32, 128)
  token!: string;
}