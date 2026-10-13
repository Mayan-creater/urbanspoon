import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateCateringQuoteDto,
  CreateCateringRequestDto,
} from './catering.dto.js';

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function assertEventDate(eventAt: Date, now = new Date()) {
  if (!Number.isFinite(eventAt.getTime()) || eventAt <= now) {
    throw new BadRequestException('Event date must be in the future.');
  }
  if (eventAt.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000) {
    throw new BadRequestException('Event requests can be submitted up to one year ahead.');
  }
}

@Injectable()
export class CateringService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(customerUserId: string, input: CreateCateringRequestDto) {
    const eventAt = new Date(input.eventAt);
    assertEventDate(eventAt);
    const cuisineTypes = normalized(input.cuisineTypes);
    const dietaryTags = normalized(input.dietaryTags ?? []);
    if (!cuisineTypes.length) throw new BadRequestException('Choose at least one cuisine.');
    return this.prisma.$transaction(async (transaction) => {
      const request = await transaction.cateringRequest.create({
        data: {
          customerUserId,
          guestCount: input.guestCount,
          budgetMinor: input.budgetMinor,
          currency: input.currency ?? 'INR',
          cuisineTypes,
          dietaryTags,
          occasion: input.occasion.trim(),
          eventAt,
          city: input.city.trim(),
          state: input.state.trim(),
          postalCode: input.postalCode.trim(),
          venueAddress: input.venueAddress.trim(),
          details: input.details?.trim() || undefined,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: customerUserId,
          permission: 'catering.request.create',
          action: 'CATERING_REQUEST_SUBMITTED',
          entityType: 'catering_request',
          entityId: request.id,
          after: { guestCount: request.guestCount, city: request.city, eventAt: request.eventAt },
        },
      });
      return request;
    });
  }

  listCustomerRequests(customerUserId: string) {
    return this.prisma.cateringRequest.findMany({
      where: { customerUserId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        quotes: {
          orderBy: [{ restaurantId: 'asc' }, { revision: 'desc' }],
          include: { restaurant: { select: { id: true, name: true, city: true } } },
        },
      },
    });
  }

  async withdrawRequest(customerUserId: string, requestId: string) {
    const request = await this.prisma.cateringRequest.findFirst({
      where: { id: requestId, customerUserId },
      select: { id: true, status: true },
    });
    if (!request) throw new NotFoundException('Catering request not found.');
    if (request.status !== 'OPEN') throw new ConflictException('Only open requests can be withdrawn.');
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.cateringRequest.update({
        where: { id: request.id },
        data: { status: 'WITHDRAWN' },
      });
      await transaction.cateringQuote.updateMany({
        where: { requestId: request.id, status: 'SUBMITTED' },
        data: { status: 'WITHDRAWN' },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: customerUserId,
          permission: 'catering.request.withdraw',
          action: 'CATERING_REQUEST_WITHDRAWN',
          entityType: 'catering_request',
          entityId: request.id,
          before: { status: request.status },
          after: { status: updated.status },
        },
      });
      return updated;
    });
  }

  async setEnabled(actorUserId: string, restaurantId: string, enabled: boolean) {
    return this.prisma.$transaction(async (transaction) => {
      const restaurant = await transaction.restaurant.findUnique({
        where: { id: restaurantId },
        select: { id: true, status: true, supportsCatering: true },
      });
      if (!restaurant) throw new NotFoundException('Restaurant not found.');
      if (enabled && restaurant.status !== 'ACTIVE') {
        throw new ConflictException('Only active restaurants can receive catering requests.');
      }
      const updated = await transaction.restaurant.update({
        where: { id: restaurantId },
        data: { supportsCatering: enabled },
        select: { id: true, supportsCatering: true },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'restaurant.manage',
          action: enabled ? 'CATERING_ENABLED' : 'CATERING_DISABLED',
          entityType: 'restaurant',
          entityId: restaurantId,
          before: { supportsCatering: restaurant.supportsCatering },
          after: { supportsCatering: updated.supportsCatering },
        },
      });
      return updated;
    });
  }

  async listProviderRequests(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, status: true, supportsCatering: true, city: true, cuisineTypes: true },
    });
    if (!restaurant) throw new NotFoundException('Restaurant not found.');
    if (restaurant.status !== 'ACTIVE' || !restaurant.supportsCatering) {
      throw new ForbiddenException('Enable catering on an active restaurant to view requests.');
    }
    return this.prisma.cateringRequest.findMany({
      where: {
        status: 'OPEN',
        eventAt: { gt: new Date() },
        city: { equals: restaurant.city, mode: 'insensitive' },
        ...(restaurant.cuisineTypes.length ? { cuisineTypes: { hasSome: restaurant.cuisineTypes } } : {}),
      },
      select: {
        id: true,
        guestCount: true,
        budgetMinor: true,
        currency: true,
        cuisineTypes: true,
        dietaryTags: true,
        occasion: true,
        eventAt: true,
        city: true,
        state: true,
        postalCode: true,
        venueAddress: true,
        details: true,
        quotes: {
          where: { restaurantId },
          orderBy: { revision: 'desc' },
          take: 1,
          select: { id: true, revision: true, amountMinor: true, taxMinor: true, currency: true, status: true, validUntil: true },
        },
      },
      orderBy: { eventAt: 'asc' },
      take: 100,
    });
  }

  async createQuote(
    actorUserId: string,
    restaurantId: string,
    requestId: string,
    input: CreateCateringQuoteDto,
  ) {
    const validUntil = new Date(input.validUntil);
    const now = new Date();
    if (!Number.isFinite(validUntil.getTime()) || validUntil <= now) {
      throw new BadRequestException('Quote expiry must be in the future.');
    }
    const inclusions = normalized(input.inclusions);
    if (!inclusions.length) throw new BadRequestException('List at least one quote inclusion.');
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "CateringRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE`,
      );
      const [request, restaurant] = await Promise.all([
        transaction.cateringRequest.findUnique({ where: { id: requestId } }),
        transaction.restaurant.findUnique({
          where: { id: restaurantId },
          select: { id: true, name: true, status: true, supportsCatering: true, city: true, cuisineTypes: true },
        }),
      ]);
      if (!request) throw new NotFoundException('Catering request not found.');
      if (!restaurant) throw new NotFoundException('Restaurant not found.');
      if (request.status !== 'OPEN' || request.eventAt <= now) {
        throw new ConflictException('This event request is no longer accepting quotes.');
      }
      if (restaurant.status !== 'ACTIVE' || !restaurant.supportsCatering) {
        throw new ForbiddenException('An active catering-enabled restaurant is required.');
      }
      if (restaurant.city.trim().toLocaleLowerCase() !== request.city.trim().toLocaleLowerCase()) {
        throw new ForbiddenException('This event is outside the restaurant catering city.');
      }
      if (!restaurant.cuisineTypes.some((cuisine) => request.cuisineTypes.includes(cuisine))) {
        throw new ForbiddenException('The restaurant does not match the requested cuisine.');
      }
      if (input.currency !== request.currency) {
        throw new BadRequestException('Quote currency must match the event request currency.');
      }
      if (validUntil >= request.eventAt) {
        throw new BadRequestException('Quote expiry must be before the event date.');
      }
      const previous = await transaction.cateringQuote.findFirst({
        where: { requestId, restaurantId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      await transaction.cateringQuote.updateMany({
        where: { requestId, restaurantId, status: 'SUBMITTED' },
        data: { status: 'SUPERSEDED' },
      });
      const quote = await transaction.cateringQuote.create({
        data: {
          requestId,
          restaurantId,
          createdByUserId: actorUserId,
          revision: (previous?.revision ?? 0) + 1,
          amountMinor: input.amountMinor,
          taxMinor: input.taxMinor ?? 0,
          currency: input.currency,
          inclusions,
          message: input.message?.trim() || undefined,
          validUntil,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'restaurant.manage',
          action: 'CATERING_QUOTE_SUBMITTED',
          entityType: 'catering_quote',
          entityId: quote.id,
          after: { requestId, restaurantId, revision: quote.revision, amountMinor: quote.amountMinor, currency: quote.currency },
        },
      });
      return quote;
    });
  }
}