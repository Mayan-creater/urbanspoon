import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateSupportCaseDto {
  @IsIn(['ORDER', 'PAYMENT', 'ACCOUNT', 'DELIVERY', 'OTHER'])
  category!: 'ORDER' | 'PAYMENT' | 'ACCOUNT' | 'DELIVERY' | 'OTHER';

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH';

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsString()
  @Length(4, 120)
  subject!: string;

  @IsString()
  @Length(10, 4000)
  message!: string;
}

export class CustomerSupportMessageDto {
  @IsString()
  @Length(2, 4000)
  body!: string;
}

export class AgentSupportMessageDto extends CustomerSupportMessageDto {
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}

export class ResolveSupportCaseDto {
  @IsString()
  @Length(5, 1000)
  resolutionSummary!: string;

  @IsString()
  @Length(5, 500)
  customerOutcome!: string;
}

export class AssignSupportCaseDto {
  @IsUUID()
  supportAgentUserId!: string;
}
