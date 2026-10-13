import { Module } from '@nestjs/common';
import { CartsModule } from '../carts/carts.module.js';
import { DeliveryModule } from '../delivery/delivery.module.js';
import { OrderIntentsController } from './order-intents.controller.js';
import { OrderIntentsService } from './order-intents.service.js';
import {
  CustomerOrdersController,
  PaymentAttemptsController,
  PaymentInitiationController,
  RestaurantOrdersController,
  SandboxPaymentController,
  SandboxWebhookController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { SandboxPaymentProvider } from './sandbox-payment.provider.js';

@Module({
  imports: [CartsModule, DeliveryModule],
  controllers: [
    OrderIntentsController,
    CustomerOrdersController,
    PaymentAttemptsController,
    PaymentInitiationController,
    RestaurantOrdersController,
    SandboxPaymentController,
    SandboxWebhookController,
  ],
  providers: [OrderIntentsService, OrdersService, SandboxPaymentProvider],
  exports: [OrdersService, OrderIntentsService],
})
export class OrdersModule {}
