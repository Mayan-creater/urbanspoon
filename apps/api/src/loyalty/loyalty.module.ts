import { Module } from '@nestjs/common';
import { AdminLoyaltyController, CustomerLoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import {
  AdminMembershipPlansController,
  CustomerMembershipController,
} from './membership.controller.js';
import { MembershipService } from './membership.service.js';

@Module({
  controllers: [
    CustomerLoyaltyController,
    AdminLoyaltyController,
    CustomerMembershipController,
    AdminMembershipPlansController,
  ],
  providers: [LoyaltyService, MembershipService],
})
export class LoyaltyModule {}