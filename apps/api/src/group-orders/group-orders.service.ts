import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CartsService } from '../carts/carts.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { OrderIntentsService } from '../orders/order-intents.service.js';
import type { AddCartItemDto, UpdateCartItemDto } from '../carts/carts.dto.js';
import type { CreateGroupOrderDto } from './group-orders.dto.js';

const groupCartInclude = {
  restaurant: { select: { id: true, name: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      menuItem: { select: { id: true, name: true, priceMinor: true, currency: true } },
      addedBy: { select: { id: true, name: true } },
      selections: { orderBy: { id: 'asc' as const } },
    },
  },
} satisfies Prisma.CartInclude;

@Injectable()
export class GroupOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly carts: CartsService,
    private readonly intents: OrderIntentsService,
  ) {}

  async create(hostUserId: string, input: CreateGroupOrderDto) {
    const deadlineAt = input.deadlineAt ? new Date(input.deadlineAt) : null;
    if (deadlineAt && deadlineAt <= new Date()) {
      throw new BadRequestException('Group order deadline must be in the future');
    }
    const groupOrder = await this.prisma.$transaction(async (transaction) => {
      const cart = await transaction.cart.findFirst({
        where: { id: input.cartId, userId: hostUserId },
        select: { id: true },
      });
      if (!cart) throw new NotFoundException('Host cart not found');
      const existing = await transaction.groupOrder.findUnique({ where: { cartId: cart.id } });
      if (existing) throw new ConflictException('This cart already belongs to a group order');
      const created = await transaction.groupOrder.create({
        data: {
          cartId: cart.id,
          hostUserId,
          deadlineAt,
          members: { create: { userId: hostUserId } },
        },
        select: { id: true },
      });
      return created;
    });
    return this.get(hostUserId, groupOrder.id);
  }

  async createInvite(hostUserId: string, groupOrderId: string) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const now = new Date();
    const invite = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId}::uuid FOR UPDATE`,
      );
      const groupOrder = await transaction.groupOrder.findUnique({
        where: { id: groupOrderId },
      });
      if (!groupOrder || groupOrder.hostUserId !== hostUserId) {
        throw new NotFoundException('Group order not found');
      }
      if (groupOrder.status !== 'OPEN') throw new ConflictException('Group order is no longer open');
      if (groupOrder.deadlineAt && groupOrder.deadlineAt <= now) {
        throw new ConflictException('Group order deadline has passed');
      }
      const expiresAt = groupOrder.deadlineAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const row = await transaction.groupOrderInvite.create({
        data: { groupOrderId, createdByUserId: hostUserId, tokenHash, expiresAt },
        select: { id: true, expiresAt: true },
      });
      return row;
    });
    return { ...invite, token };
  }

  async join(userId: string, token: string) {
    const tokenHash = this.hashToken(token);
    const groupOrderId = await this.prisma.$transaction(async (transaction) => {
      const invite = await transaction.groupOrderInvite.findUnique({
        where: { tokenHash },
        select: { id: true, groupOrderId: true, expiresAt: true, consumedAt: true },
      });
      if (!invite) throw new NotFoundException('Group invite not found');
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupOrder" WHERE "id" = ${invite.groupOrderId}::uuid FOR UPDATE`,
      );
      const groupOrder = await transaction.groupOrder.findUnique({
        where: { id: invite.groupOrderId },
        select: { id: true, status: true, deadlineAt: true },
      });
      const now = new Date();
      if (
        invite.consumedAt ||
        invite.expiresAt <= now ||
        !groupOrder ||
        groupOrder.status !== 'OPEN' ||
        (groupOrder.deadlineAt !== null && groupOrder.deadlineAt <= now)
      ) {
        throw new ConflictException('Group invite is expired, used, or no longer open');
      }
      const consumed = await transaction.groupOrderInvite.updateMany({
        where: { id: invite.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, consumedByUserId: userId },
      });
      if (consumed.count !== 1) throw new ConflictException('Group invite was already used');
      await transaction.groupOrderMember.create({
        data: { groupOrderId: groupOrder.id, userId },
      });
      return groupOrder.id;
    });
    return this.get(userId, groupOrderId);
  }

  async get(userId: string, groupOrderId: string) {
    const groupOrder = await this.prisma.groupOrder.findFirst({
      where: {
        id: groupOrderId,
        OR: [{ hostUserId: userId }, { members: { some: { userId } } }],
      },
      include: {
        host: { select: { id: true, name: true } },
        members: { orderBy: { joinedAt: 'asc' }, include: { user: { select: { id: true, name: true } } } },
        cart: { include: groupCartInclude },
      },
    });
    if (!groupOrder) throw new NotFoundException('Group order not found');
    if (groupOrder.status === 'OPEN' && groupOrder.deadlineAt && groupOrder.deadlineAt <= new Date()) {
      await this.prisma.groupOrder.updateMany({
        where: { id: groupOrderId, status: 'OPEN', deadlineAt: { lte: new Date() } },
        data: { status: 'EXPIRED' },
      });
      return { ...groupOrder, status: 'EXPIRED' as const, currentUserId: userId, isHost: false };
    }
    return {
      ...groupOrder,
      currentUserId: userId,
      isHost: groupOrder.hostUserId === userId,
    };
  }

  async addItem(userId: string, groupOrderId: string, input: AddCartItemDto) {
    const group = await this.findMemberGroup(userId, groupOrderId);
    const added = await this.carts.addGroupItem(userId, group.cartId, groupOrderId, input);
    return { groupOrderId, ...added };
  }

  async removeItem(userId: string, groupOrderId: string, itemId: string) {
    const group = await this.findMemberGroup(userId, groupOrderId);
    return this.carts.removeGroupItem(userId, group.cartId, groupOrderId, itemId);
  }

  async updateItem(
    userId: string,
    groupOrderId: string,
    itemId: string,
    input: UpdateCartItemDto,
  ) {
    const group = await this.findMemberGroup(userId, groupOrderId);
    return this.carts.updateGroupItem(userId, group.cartId, groupOrderId, itemId, input);
  }

  async lock(hostUserId: string, groupOrderId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "GroupOrder" WHERE "id" = ${groupOrderId}::uuid FOR UPDATE`,
      );
      const groupOrder = await transaction.groupOrder.findUnique({
        where: { id: groupOrderId },
        include: { cart: { select: { _count: { select: { items: true } } } } },
      });
      if (!groupOrder || groupOrder.hostUserId !== hostUserId) {
        throw new NotFoundException('Group order not found');
      }
      if (groupOrder.status !== 'OPEN') throw new ConflictException('Group order is not open');
      const now = new Date();
      if (groupOrder.deadlineAt && groupOrder.deadlineAt <= now) {
        throw new ConflictException('Group order deadline has passed');
      }
      if (!groupOrder.cart._count.items) throw new BadRequestException('Group cart is empty');
      await transaction.groupOrder.update({
        where: { id: groupOrderId },
        data: { status: 'LOCKED', lockedAt: now },
      });
      return { id: groupOrderId, status: 'LOCKED', cartId: groupOrder.cartId };
    });
  }

  async checkout(hostUserId: string, groupOrderId: string, correlationId?: string) {
    const groupOrder = await this.prisma.groupOrder.findUnique({ where: { id: groupOrderId } });
    if (!groupOrder || groupOrder.hostUserId !== hostUserId) {
      throw new NotFoundException('Group order not found');
    }
    if (groupOrder.status === 'CHECKED_OUT' && groupOrder.orderIntentId) {
      return this.intents.get(hostUserId, groupOrder.orderIntentId);
    }
    if (groupOrder.status !== 'LOCKED') {
      throw new ConflictException('Only a locked group order can be checked out');
    }
    const intent = await this.intents.create(
      hostUserId,
      { cartId: groupOrder.cartId },
      `group-order-${groupOrderId}-checkout`,
      correlationId,
    );
    const now = new Date();
    const completed = await this.prisma.groupOrder.updateMany({
      where: { id: groupOrderId, hostUserId, status: 'LOCKED', orderIntentId: null },
      data: { status: 'CHECKED_OUT', orderIntentId: intent.id, checkedOutAt: now },
    });
    if (!completed.count) {
      const current = await this.prisma.groupOrder.findUnique({ where: { id: groupOrderId } });
      if (current?.orderIntentId !== intent.id) {
        throw new ConflictException('Group checkout changed; reload and retry');
      }
    }
    return intent;
  }

  private async findMemberGroup(userId: string, groupOrderId: string) {
    const groupOrder = await this.prisma.groupOrder.findFirst({
      where: {
        id: groupOrderId,
        OR: [{ hostUserId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true, cartId: true },
    });
    if (!groupOrder) throw new NotFoundException('Group order not found');
    return groupOrder;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}