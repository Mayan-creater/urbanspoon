import { Module } from '@nestjs/common';
import {
  DeliveryDispatchController,
  DeliveryOnboardingController,
  DeliveryPartnerAdminController,
  DeliveryPartnerController,
  DeliveryTrackingController,
  PartnerPayoutAdminController,
} from './delivery.controller.js';
import { DeliveryService } from './delivery.service.js';
import { DeliveryEventsService } from './delivery-events.service.js';
import { DeliveryEvidenceService } from './delivery-evidence.service.js';
import { DeliveryEvidenceStorage } from './delivery-evidence-storage.js';
import { DeliveryRoutingService } from './delivery-routing.service.js';
import { SandboxPartnerPayoutProvider } from './sandbox-partner-payout.provider.js';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';

@Module({
  imports: [LoyaltyModule],
  controllers: [
    DeliveryOnboardingController,
    DeliveryPartnerController,
    DeliveryPartnerAdminController,
    DeliveryDispatchController,
    DeliveryTrackingController,
    PartnerPayoutAdminController,
  ],
  providers: [
    DeliveryService,
    DeliveryEventsService,
    DeliveryEvidenceService,
    { provide: DeliveryEvidenceStorage, useFactory: () => new DeliveryEvidenceStorage() },
    { provide: DeliveryRoutingService, useFactory: () => new DeliveryRoutingService() },
    SandboxPartnerPayoutProvider,
  ],
  exports: [DeliveryService, DeliveryEventsService],
})
export class DeliveryModule {}
