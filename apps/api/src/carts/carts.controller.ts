import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  AddCartItemDto,
  CheckoutPreviewDto,
  CreateCartDto,
  CreateCouponDto,
  CreatePricingRuleDto,
  UpdateCartItemDto,
} from './carts.dto.js';
import { CartsService } from './carts.service.js';

@Controller('carts')
export class CartsController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.carts.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateCartDto) {
    return this.carts.create(user.id, body);
  }

  @Get(':cartId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('cartId') cartId: string) {
    return this.carts.get(user.id, cartId);
  }

  @Delete(':cartId')
  clear(@CurrentUser() user: AuthenticatedUser, @Param('cartId') cartId: string) {
    return this.carts.clear(user.id, cartId);
  }

  @Post(':cartId/items')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
    @Body() body: AddCartItemDto,
  ) {
    return this.carts.addItem(user.id, cartId, body);
  }

  @Patch(':cartId/items/:itemId')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateCartItemDto,
  ) {
    return this.carts.updateItem(user.id, cartId, itemId, body);
  }

  @Delete(':cartId/items/:itemId')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('cartId') cartId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.carts.removeItem(user.id, cartId, itemId);
  }
}

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly carts: CartsService) {}

  @Post('preview')
  preview(@CurrentUser() user: AuthenticatedUser, @Body() body: CheckoutPreviewDto) {
    return this.carts.preview(user.id, body);
  }
}

@Controller('promotions')
export class CouponValidationController {
  constructor(private readonly carts: CartsService) {}

  @Post('validate')
  validate(@CurrentUser() user: AuthenticatedUser, @Body() body: CheckoutPreviewDto) {
    return this.carts.validateCoupon(user.id, body);
  }
}

@Controller('admin/pricing-rules')
export class PricingRulesController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  @RequirePermission('admin.pricing.manage')
  list() {
    return this.carts.listPricingRules();
  }

  @Post()
  @RequirePermission('admin.pricing.manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePricingRuleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.carts.createPricingRule(user.id, body, this.correlationId(request));
  }

  private correlationId(request: AuthenticatedRequest) {
    const header = request.headers['x-request-id'];
    return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
  }
}

@Controller('admin/coupons')
export class CouponsAdminController {
  constructor(private readonly carts: CartsService) {}

  @Get()
  @RequirePermission('admin.promotions.manage')
  list() {
    return this.carts.listCoupons();
  }

  @Post()
  @RequirePermission('admin.promotions.manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCouponDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.carts.createCoupon(user.id, body, this.correlationId(request));
  }

  @Post(':couponId/disable')
  @RequirePermission('admin.promotions.manage')
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Param('couponId') couponId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.carts.disableCoupon(user.id, couponId, this.correlationId(request));
  }

  private correlationId(request: AuthenticatedRequest) {
    const header = request.headers['x-request-id'];
    return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
  }
}
