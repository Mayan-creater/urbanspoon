import { Module } from '@nestjs/common';
import { CateringCustomerController, CateringPartnerController } from './catering.controller.js';
import { CateringService } from './catering.service.js';

@Module({
  controllers: [CateringCustomerController, CateringPartnerController],
  providers: [CateringService],
})
export class CateringModule {}