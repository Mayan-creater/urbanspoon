import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { CreateMembershipPlanDto } from './loyalty.dto.js';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  listAvailablePlans() {
    const now = new Date();
    return this.prisma.membershipPlan.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
      },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        priceMinor: true,
        currency: true,
        interval: true,
        benefits: true,
        version: true,
      },
      orderBy: [{ currency: 'asc' }, { priceMinor: 'asc' }, { version: 'desc' }],
    });
  }

  async currentMembership(userId: string) {
    const now = new Date();
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        plan: { isActive: true },
      },
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        plan: {
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            priceMinor: true,
            currency: true,
            interval: true,
            benefits: true,
            version: true,
          },
        },
      },
      orderBy: { endsAt: 'desc' },
    });
    return { membership, activationAvailable: false };
  }

  listAdminPlans() {
    return this.prisma.membershipPlan.findMany({
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
  }

  async createPlan(actorUserId: string, input: CreateMembershipPlanDto) {
    const effectiveFrom = new Date(input.effectiveFrom);
    const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null;
    if (effectiveUntil && effectiveUntil <= effectiveFrom) {
      throw new BadRequestException('Membership plan end must be after its start');
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'membership:' + input.key}))`,
      );
      const latest = await transaction.membershipPlan.findFirst({
        where: { key: input.key },
        orderBy: { version: 'desc' },
        select: { version: true, effectiveFrom: true },
      });
      if (latest && effectiveFrom <= latest.effectiveFrom) {
        throw new BadRequestException('A plan version must start after the previous version');
      }
      await transaction.membershipPlan.updateMany({
        where: { key: input.key, isActive: true, effectiveUntil: null },
        data: { effectiveUntil: effectiveFrom },
      });
      const plan = await transaction.membershipPlan.create({
        data: {
          ...input,
          version: (latest?.version ?? 0) + 1,
          effectiveFrom,
          effectiveUntil,
          benefits: input.benefits.map((benefit) => benefit.trim()).filter(Boolean),
          createdByUserId: actorUserId,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.loyalty.manage',
          action: 'MEMBERSHIP_PLAN_VERSION_CREATED',
          entityType: 'membership_plan',
          entityId: plan.id,
          after: {
            key: plan.key,
            name: plan.name,
            version: plan.version,
            priceMinor: plan.priceMinor,
            currency: plan.currency,
            interval: plan.interval,
            benefits: plan.benefits,
            effectiveFrom: plan.effectiveFrom.toISOString(),
            effectiveUntil: plan.effectiveUntil?.toISOString() ?? null,
            activationAvailable: false,
          },
        },
      });
      return plan;
    });
  }

  async disablePlan(actorUserId: string, planId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const plan = await transaction.membershipPlan.findUnique({ where: { id: planId } });
      if (!plan) throw new NotFoundException('Membership plan not found');
      if (!plan.isActive) return plan;
      const disabled = await transaction.membershipPlan.update({
        where: { id: planId },
        data: { isActive: false },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.loyalty.manage',
          action: 'MEMBERSHIP_PLAN_DISABLED',
          entityType: 'membership_plan',
          entityId: planId,
          before: { isActive: plan.isActive },
          after: { isActive: disabled.isActive, key: plan.key, version: plan.version },
        },
      });
      return disabled;
    });
  }
}