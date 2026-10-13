import { Module } from '@nestjs/common';
import { CustomerSupportController, SupportAgentController } from './support.controller.js';
import { SupportService } from './support.service.js';

@Module({
  controllers: [CustomerSupportController, SupportAgentController],
  providers: [SupportService],
})
export class SupportModule {}
