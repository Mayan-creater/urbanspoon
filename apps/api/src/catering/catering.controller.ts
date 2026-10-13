import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  CreateCateringQuoteDto,
  CreateCateringRequestDto,
  SetCateringEnabledDto,
} from './catering.dto.js';
import { CateringService } from './catering.service.js';

@Controller('catering/requests')
export class CateringCustomerController {
  constructor(private readonly catering: CateringService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateCateringRequestDto) {
    return this.catering.createRequest(user.id, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.catering.listCustomerRequests(user.id);
  }

  @Post(':requestId/withdraw')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('requestId') requestId: string) {
    return this.catering.withdrawRequest(user.id, requestId);
  }
}

@Controller('partner/restaurants')
export class CateringPartnerController {
  constructor(private readonly catering: CateringService) {}

  @Patch(':restaurantId/catering')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  setEnabled(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Body() input: SetCateringEnabledDto,
  ) {
    return this.catering.setEnabled(user.id, restaurantId, input.enabled);
  }

  @Get(':restaurantId/catering/requests')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  requests(@Param('restaurantId') restaurantId: string) {
    return this.catering.listProviderRequests(restaurantId);
  }

  @Post(':restaurantId/catering/requests/:requestId/quotes')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('requestId') requestId: string,
    @Body() input: CreateCateringQuoteDto,
  ) {
    return this.catering.createQuote(user.id, restaurantId, requestId, input);
  }
}