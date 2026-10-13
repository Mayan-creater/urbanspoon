import { Module } from '@nestjs/common';
import { CartsModule } from '../carts/carts.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { GroupOrdersController } from './group-orders.controller.js';
import { GroupOrdersService } from './group-orders.service.js';

@Module({
  imports: [CartsModule, OrdersModule],
  controllers: [GroupOrdersController],
  providers: [GroupOrdersService],
})
export class GroupOrdersModule {}