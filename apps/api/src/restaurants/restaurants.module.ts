import { Module } from '@nestjs/common';
import {
  DiscoveryController,
  RestaurantAdminController,
  RestaurantBrowseController,
  RestaurantFavoritesController,
  RestaurantPartnerController,
} from './restaurants.controller.js';
import { RestaurantsService } from './restaurants.service.js';

@Module({
  controllers: [
    DiscoveryController,
    RestaurantBrowseController,
    RestaurantFavoritesController,
    RestaurantPartnerController,
    RestaurantAdminController,
  ],
  providers: [RestaurantsService],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
