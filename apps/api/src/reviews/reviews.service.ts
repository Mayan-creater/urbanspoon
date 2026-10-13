import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateReviewDto, ModerateReviewDto, ReportReviewDto } from './reviews.dto.js';

const reviewView = {
  id: true,
  orderId: true,
  restaurantId: true,
  rating: true,
  title: true,
  body: true,
  status: true,
  moderationReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrderReviewSelect;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateReviewDto, idempotencyKey?: string) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
    }
    const replay = await this.prisma.orderReview.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      select: reviewView,
    });
    if (replay) return replay;

    const order = await this.prisma.order.findFirst({
      where: { id: input.orderId, userId },
      select: { id: true, restaurantId: true, status: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'DELIVERED') {
      throw new ConflictException('A review can be submitted only after delivery is complete');
    }
    const existing = await this.prisma.orderReview.findUnique({
      where: { orderId: order.id },
      select: reviewView,
    });
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const review = await transaction.orderReview.create({
          data: {
            orderId: order.id,
            userId,
            restaurantId: order.restaurantId,
            idempotencyKey,
            rating: input.rating,
            title: input.title.trim(),
            body: input.body.trim(),
          },
          select: reviewView,
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            permission: 'reviews.self.create',
            action: 'ORDER_REVIEW_SUBMITTED',
            entityType: 'order_review',
            entityId: review.id,
            after: { orderId: order.id, restaurantId: order.restaurantId, rating: input.rating },
          },
        });
        return review;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.orderReview.findUnique({
          where: { orderId: order.id },
          select: reviewView,
        });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  listMine(userId: string) {
    return this.prisma.orderReview.findMany({
      where: { userId },
      select: { ...reviewView, restaurant: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  listPublishedForRestaurant(restaurantId: string) {
    return this.prisma.orderReview.findMany({
      where: { restaurantId, status: 'PUBLISHED' },
      select: {
        id: true,
        rating: true,
        title: true,
        body: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async report(userId: string, reviewId: string, input: ReportReviewDto) {
    const review = await this.prisma.orderReview.findUnique({
      where: { id: reviewId },
      select: { id: true, userId: true, status: true },
    });
    if (!review || review.status !== 'PUBLISHED') {
      throw new NotFoundException('Published review not found');
    }
    if (review.userId === userId)
      throw new BadRequestException('You cannot report your own review');
    const existing = await this.prisma.reviewReport.findUnique({
      where: { reviewId_reporterUserId: { reviewId, reporterUserId: userId } },
    });
    if (existing) return existing;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const report = await transaction.reviewReport.create({
          data: { reviewId, reporterUserId: userId, reason: input.reason.trim() },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            permission: 'reviews.self.report',
            action: 'ORDER_REVIEW_REPORTED',
            entityType: 'review_report',
            entityId: report.id,
            after: { reviewId },
          },
        });
        return report;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.reviewReport.findUnique({
          where: { reviewId_reporterUserId: { reviewId, reporterUserId: userId } },
        });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  async listForModeration(status?: string) {
    const allowedStatuses = ['PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED', 'REPORTED'];
    if (status && !allowedStatuses.includes(status)) {
      throw new BadRequestException('Review moderation status is invalid');
    }
    return this.prisma.orderReview.findMany({
      where:
        status === 'REPORTED'
          ? { reports: { some: { status: 'OPEN' } } }
          : status
            ? { status: status as 'PENDING' | 'PUBLISHED' | 'HIDDEN' | 'REJECTED' }
            : undefined,
      include: {
        user: { select: { id: true, name: true, email: true } },
        restaurant: { select: { id: true, name: true } },
        reports: { where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async moderate(actorUserId: string, reviewId: string, input: ModerateReviewDto) {
    if (input.action !== 'PUBLISH' && !input.reason?.trim()) {
      throw new BadRequestException('A reason is required to hide or reject a review');
    }
    return this.prisma.$transaction(async (transaction) => {
      const review = await transaction.orderReview.findUnique({ where: { id: reviewId } });
      if (!review) throw new NotFoundException('Review not found');
      const nextStatus =
        input.action === 'PUBLISH' ? 'PUBLISHED' : input.action === 'HIDE' ? 'HIDDEN' : 'REJECTED';
      const allowed =
        input.action === 'PUBLISH'
          ? ['PENDING', 'HIDDEN'].includes(review.status)
          : input.action === 'HIDE'
            ? ['PENDING', 'PUBLISHED'].includes(review.status)
            : review.status === 'PENDING';
      if (!allowed) {
        throw new ConflictException(
          `Review in ${review.status} cannot transition to ${nextStatus}`,
        );
      }
      const updated = await transaction.orderReview.updateMany({
        where: { id: review.id, status: review.status },
        data: {
          status: nextStatus,
          moderationReason: input.reason?.trim() ?? null,
          moderatedByUserId: actorUserId,
          moderatedAt: new Date(),
        },
      });
      if (!updated.count) throw new ConflictException('Review moderation state changed; retry');
      await transaction.reviewReport.updateMany({
        where: { reviewId, status: 'OPEN' },
        data: { status: input.action === 'PUBLISH' ? 'DISMISSED' : 'ACTIONED' },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.reviews.moderate',
          action: `ORDER_REVIEW_${input.action}`,
          entityType: 'order_review',
          entityId: reviewId,
          before: { status: review.status },
          after: { status: nextStatus, reason: input.reason?.trim() ?? null },
        },
      });
      return transaction.orderReview.findUniqueOrThrow({
        where: { id: reviewId },
        select: reviewView,
      });
    });
  }
}
