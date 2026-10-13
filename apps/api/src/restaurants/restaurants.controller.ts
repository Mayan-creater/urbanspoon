import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser, Public, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import {
  CreateCategoryDto,
  CreateMenuItemDto,
  CreateRestaurantOfferDto,
  CreateRestaurantDto,
  DiscoveryQueryDto,
  SetItemAvailabilityDto,
  UpdateCategoryDto,
  UpdateMenuItemDto,
  UpdateRestaurantHoursDto,
  UpdateRestaurantRatingDto,
  UpdateRestaurantDto,
} from './restaurants.dto.js';
import { RestaurantsService } from './restaurants.service.js';

function correlationId(request: AuthenticatedRequest) {
  const header = request.headers['x-request-id'];
  return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
}

@Controller('restaurants')
export class RestaurantBrowseController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  @Public()
  list(@Query() filters: DiscoveryQueryDto) {
    return this.restaurants.listPublic(filters);
  }

  @Get(':restaurantId')
  @Public()
  get(@Param('restaurantId') id: string) {
    return this.restaurants.getPublic(id);
  }

  @Get(':restaurantId/menu')
  @Public()
  menu(@Param('restaurantId') id: string) {
    return this.restaurants.getPublicMenu(id);
  }
}

@Controller()
export class DiscoveryController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get('search')
  @Public()
  search(@Query() filters: DiscoveryQueryDto) {
    return this.restaurants.listPublic(filters);
  }

  @Get('categories')
  @Public()
  async categories() {
    return (await this.restaurants.listDiscoveryFacets()).categories;
  }

  @Get('discovery/facets')
  @Public()
  facets() {
    return this.restaurants.listDiscoveryFacets();
  }
}

@Controller('favorites/restaurants')
export class RestaurantFavoritesController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.restaurants.listFavorites(user.id);
  }

  @Post(':restaurantId')
  add(@CurrentUser() user: AuthenticatedUser, @Param('restaurantId') restaurantId: string) {
    return this.restaurants.addFavorite(user.id, restaurantId);
  }

  @Delete(':restaurantId')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('restaurantId') restaurantId: string) {
    return this.restaurants.removeFavorite(user.id, restaurantId);
  }
}

@Controller('partner/restaurants')
export class RestaurantPartnerController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.restaurants.listPartner(user);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateRestaurantDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.create(user, body, correlationId(request));
  }

  @Get(':restaurantId')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  get(@Param('restaurantId') id: string) {
    return this.restaurants.getPartner(id);
  }

  @Patch(':restaurantId')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') id: string,
    @Body() body: UpdateRestaurantDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.updatePartner(user, id, body, correlationId(request));
  }

  @Put(':restaurantId/hours')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  updateHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') id: string,
    @Body() body: UpdateRestaurantHoursDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.updateHours(user, id, body, correlationId(request));
  }

  @Get(':restaurantId/offers')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  offers(@Param('restaurantId') id: string) {
    return this.restaurants.listPartnerOffers(id);
  }

  @Post(':restaurantId/offers')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  createOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') id: string,
    @Body() body: CreateRestaurantOfferDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.createPartnerOffer(user, id, body, correlationId(request));
  }

  @Post(':restaurantId/offers/:offerId/disable')
  @RequirePermission('restaurant.manage', 'RESTAURANT', 'restaurantId')
  disableOffer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('offerId') offerId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.disablePartnerOffer(
      user,
      restaurantId,
      offerId,
      correlationId(request),
    );
  }

  @Get(':restaurantId/menu')
  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  menu(@Param('restaurantId') id: string) {
    return this.restaurants.listPartnerMenu(id);
  }

  @Post(':restaurantId/menu/categories')
  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') id: string,
    @Body() body: CreateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.createCategory(user, id, body, correlationId(request));
  }

  @Patch(':restaurantId/menu/categories/:categoryId')
  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('categoryId') categoryId: string,
    @Body() body: UpdateCategoryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.updateCategory(
      user,
      restaurantId,
      categoryId,
      body,
      correlationId(request),
    );
  }

  @Post(':restaurantId/menu/items')
  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  createMenuItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') id: string,
    @Body() body: CreateMenuItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.createMenuItem(user, id, body, correlationId(request));
  }

  @Patch(':restaurantId/menu/items/:itemId')
  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  updateMenuItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateMenuItemDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.updateMenuItem(
      user,
      restaurantId,
      itemId,
      body,
      correlationId(request),
    );
  }

  @Post(':restaurantId/menu/items/:itemId/archive')
  @RequirePermission('restaurant.menu.manage', 'RESTAURANT', 'restaurantId')
  archiveMenuItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.archiveMenuItem(user, restaurantId, itemId, correlationId(request));
  }

  @Put(':restaurantId/menu/items/:itemId/availability')
  @RequirePermission('restaurant.menu.availability', 'RESTAURANT', 'restaurantId')
  setItemAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Param('itemId') itemId: string,
    @Body() body: SetItemAvailabilityDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.setItemAvailability(
      user,
      restaurantId,
      itemId,
      body.isAvailable,
      correlationId(request),
    );
  }
}

@Controller('admin/restaurants')
export class RestaurantAdminController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Post(':restaurantId/approve')
  @RequirePermission('admin.restaurants.manage')
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.approve(actor, restaurantId, correlationId(request));
  }

  @Put(':restaurantId/rating')
  @RequirePermission('admin.restaurants.manage')
  updateRating(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('restaurantId') restaurantId: string,
    @Body() body: UpdateRestaurantRatingDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.restaurants.updateRatingSnapshot(actor, restaurantId, body, correlationId(request));
  }
}
