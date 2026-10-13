import { Module } from '@nestjs/common';
import {
  CustomerReviewsController,
  RestaurantReviewsController,
  ReviewModerationController,
} from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  controllers: [CustomerReviewsController, RestaurantReviewsController, ReviewModerationController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
