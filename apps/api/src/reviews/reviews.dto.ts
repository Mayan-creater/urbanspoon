import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateReviewDto {
  @IsUUID()
  orderId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @Length(3, 120)
  title!: string;

  @IsString()
  @Length(10, 2000)
  body!: string;
}

export class ReportReviewDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ModerateReviewDto {
  @IsIn(['PUBLISH', 'HIDE', 'REJECT'])
  action!: 'PUBLISH' | 'HIDE' | 'REJECT';

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
