import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [OrdersModule],
  controllers: [AdminController, SettlementsController],
  providers: [AdminService, SettlementsService],
})
export class AdminModule {}
