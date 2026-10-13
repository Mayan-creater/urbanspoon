import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  AiFoodRequestDto,
  AiMenuDraftDto,
  AiRestaurantInsightsDto,
  AiReviewAnalysisDto,
  AiSmartCartDto,
} from './ai.dto.js';
import { AiService } from './ai.service.js';

@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('food-assistant')
  foodAssistant(@Body() input: AiFoodRequestDto) {
    return this.ai.foodAssistant(input);
  }

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('recommendations')
  recommendations(@Body() input: AiFoodRequestDto) {
    return this.ai.recommendations(input);
  }

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('meal-plans')
  mealPlan(@Body() input: AiFoodRequestDto) {
    return this.ai.mealPlan(input);
  }
  
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('voice-order')
  voiceOrder(@Body() input: AiFoodRequestDto) {
    return this.ai.voiceOrder(input);
  }

  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('smart-cart')
  smartCart(@CurrentUser() user: AuthenticatedUser, @Body() input: AiSmartCartDto) {
    return this.ai.smartCart(user.id, input.cartId);
  }

  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('partner/restaurants/:restaurantId/insights')
  restaurantInsights(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Body() input: AiRestaurantInsightsDto,
  ) {
    return this.ai.restaurantInsights(user.id, restaurantId, input.days ?? 30);
  }

  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('review-analysis')
  reviewAnalysis(@Body() input: AiReviewAnalysisDto) {
    return this.ai.reviewAnalysis(input.restaurantId);
  }

  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('partner/restaurants/:restaurantId/menu-draft')
  menuDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Body() input: AiMenuDraftDto,
  ) {
    return this.ai.menuDraft(user.id, restaurantId, input);
  }
}