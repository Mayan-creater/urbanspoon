import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const ROLES = [
  'customer',
  'restaurant_owner',
  'restaurant_staff',
  'delivery_partner',
  'support_agent',
  'admin',
  'super_admin',
];
const SCOPE_TYPES = ['PLATFORM', 'RESTAURANT', 'ORGANIZATION', 'PROVIDER'];

export class GrantRoleDto {
  @IsString()
  @IsIn(ROLES)
  role!: string;

  @IsOptional()
  @IsString()
  @IsIn(SCOPE_TYPES)
  scopeType?: 'PLATFORM' | 'RESTAURANT' | 'ORGANIZATION' | 'PROVIDER';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  scopeId?: string;
}
