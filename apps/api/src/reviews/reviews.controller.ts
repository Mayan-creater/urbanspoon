import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateReviewDto, ModerateReviewDto, ReportReviewDto } from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller('reviews')
export class CustomerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateReviewDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.reviews.create(user.id, body, idempotencyKey);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.reviews.listMine(user.id);
  }

  @Post(':reviewId/reports')
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reviewId') reviewId: string,
    @Body() body: ReportReviewDto,
  ) {
    return this.reviews.report(user.id, reviewId, body);
  }
}

@Controller('restaurants/:restaurantId/reviews')
export class RestaurantReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get()
  list(@Param('restaurantId') restaurantId: string) {
    return this.reviews.listPublishedForRestaurant(restaurantId);
  }
}

@Controller('admin/reviews')
@RequirePermission('admin.reviews.moderate')
export class ReviewModerationController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.reviews.listForModeration(status);
  }

  @Patch(':reviewId/moderation')
  moderate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reviewId') reviewId: string,
    @Body() body: ModerateReviewDto,
  ) {
    return this.reviews.moderate(user.id, reviewId, body);
  }
}
