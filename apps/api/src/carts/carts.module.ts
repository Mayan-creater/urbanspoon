import { Module } from '@nestjs/common';
import {
  CartsController,
  CheckoutController,
  CouponValidationController,
  CouponsAdminController,
  PricingRulesController,
} from './carts.controller.js';
import { CartsService } from './carts.service.js';

@Module({
  controllers: [
    CartsController,
    CheckoutController,
    CouponValidationController,
    PricingRulesController,
    CouponsAdminController,
  ],
  providers: [CartsService],
  exports: [CartsService],
})
export class CartsModule {}
