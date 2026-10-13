import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { AddCartItemDto, UpdateCartItemDto } from '../carts/carts.dto.js';
import { CreateGroupOrderDto, JoinGroupOrderDto } from './group-orders.dto.js';
import { GroupOrdersService } from './group-orders.service.js';

function correlationId(request: AuthenticatedRequest) {
  const header = request.headers['x-request-id'];
  return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
}

@Controller('group-orders')
export class GroupOrdersController {
  constructor(private readonly groups: GroupOrdersService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateGroupOrderDto) {
    return this.groups.create(user.id, body);
  }

  @Post('join')
  join(@CurrentUser() user: AuthenticatedUser, @Body() body: JoinGroupOrderDto) {
    return this.groups.join(user.id, body.token);
  }

  @Get(':groupOrderId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('groupOrderId') id: string) {
    return this.groups.get(user.id, id);
  }

  @Post(':groupOrderId/invites')
  invite(@CurrentUser() user: AuthenticatedUser, @Param('groupOrderId') id: string) {
    return this.groups.createInvite(user.id, id);
  }

  @Post(':groupOrderId/items')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupOrderId') id: string,
    @Body() body: AddCartItemDto,
  ) {
    return this.groups.addItem(user.id, id, body);
  }

  @Patch(':groupOrderId/items/:itemId')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupOrderId') id: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateCartItemDto,
  ) {
    return this.groups.updateItem(user.id, id, itemId, body);
  }

  @Delete(':groupOrderId/items/:itemId')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupOrderId') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.groups.removeItem(user.id, id, itemId);
  }

  @Post(':groupOrderId/lock')
  lock(@CurrentUser() user: AuthenticatedUser, @Param('groupOrderId') id: string) {
    return this.groups.lock(user.id, id);
  }

  @Post(':groupOrderId/checkout')
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupOrderId') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.groups.checkout(user.id, id, correlationId(request));
  }
}