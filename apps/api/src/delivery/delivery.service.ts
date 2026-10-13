import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DeliveryStatus } from '@prisma/client';
import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { recordDeliveredOrderEarning } from '../loyalty/loyalty-ledger.js';
import type {
  DeliveryAvailabilityDto,
  DeliveryCompletionDto,
  DeliveryFailureDto,
  DeliveryLocationDto,
  DeliveryOfferResponseDto,
  DeliveryPartnerOnboardingDto,
  PartnerPayoutRequestDto,
} from './delivery.dto.js';
import { DeliveryRoutingService } from './delivery-routing.service.js';
import { SandboxPartnerPayoutProvider } from './sandbox-partner-payout.provider.js';
import { deliveryPayoutProvider } from './delivery-payout-market.js';

const terminalDeliveryStatuses: DeliveryStatus[] = ['DELIVERED', 'FAILED', 'CANCELLED'];
const activeDeliveryStatuses: DeliveryStatus[] = [
  'ASSIGNED',
  'ARRIVED_AT_RESTAURANT',
  'PICKED_UP',
  'ARRIVED',
];

function distanceKm(latitude: number, longitude: number, targetLat: number, targetLon: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = radians(targetLat - latitude);
  const lonDelta = radians(targetLon - longitude);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(targetLat)) * Math.sin(lonDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  private expiryTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DeliveryRoutingService)
    private readonly routing = new DeliveryRoutingService(),
    @Inject(SandboxPartnerPayoutProvider)
    private readonly sandboxPayouts = new SandboxPartnerPayoutProvider(),
  ) {}

  onModuleInit() {
    this.expiryTimer = setInterval(() => {
      void this.expireOffers().catch((error: unknown) => {
        this.logger.error('Delivery offer expiry sweep failed', error);
      });
    }, 10_000);
    this.expiryTimer.unref();
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  async onboard(userId: string, input: DeliveryPartnerOnboardingDto) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.deliveryPartner.findUnique({ where: { userId } });
        if (existing) return existing;
        const partner = await transaction.deliveryPartner.create({
          data: {
            userId,
            vehicleType: input.vehicleType,
            marketRegion: input.marketRegion ?? 'IN',
          },
        });
        await transaction.userRole.create({
          data: {
            userId,
            role: 'delivery_partner',
            scopeType: 'PROVIDER',
            scopeId: partner.id,
            grantedByUserId: userId,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            permission: 'delivery.self.manage',
            action: 'DELIVERY_PARTNER_ONBOARDED',
            entityType: 'delivery_partner',
            entityId: partner.id,
            after: {
              vehicleType: partner.vehicleType,
              marketRegion: partner.marketRegion,
              verificationStatus: partner.verificationStatus,
            },
          },
        });
        return partner;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.deliveryPartner.findUnique({ where: { userId } });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async getProfile(userId: string) {
    const profile = await this.prisma.deliveryPartner.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Delivery partner profile not found');
    return profile;
  }

  async setAvailability(userId: string, input: DeliveryAvailabilityDto) {
    const profile = await this.profileForUser(userId);
    if (input.isOnline && profile.verificationStatus !== 'VERIFIED') {
      throw new ConflictException('Only verified delivery partners can go online');
    }
    if (profile.verificationStatus === 'REJECTED') {
      throw new ConflictException('This delivery partner profile is not eligible for dispatch');
    }
    const availability = input.isOnline ? 'ONLINE' : 'OFFLINE';
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "DeliveryPartner" WHERE "id" = ${profile.id}::uuid FOR UPDATE`;
      const current = await transaction.deliveryPartner.findUniqueOrThrow({
        where: { id: profile.id },
      });
      if (!input.isOnline) {
        const active = await transaction.delivery.findFirst({
          where: { deliveryPartnerId: profile.id, status: { in: activeDeliveryStatuses } },
          select: { id: true },
        });
        if (active) {
          throw new ConflictException(
            'Complete or release the active delivery before going offline',
          );
        }
      }
      if (current.availability !== availability) {
        await transaction.deliveryPartner.update({
          where: { id: profile.id },
          data: { availability },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            permission: 'delivery.self.manage',
            action: input.isOnline
              ? 'DELIVERY_PARTNER_WENT_ONLINE'
              : 'DELIVERY_PARTNER_WENT_OFFLINE',
            entityType: 'delivery_partner',
            entityId: profile.id,
            before: { availability: current.availability },
            after: { availability },
          },
        });
      }
      if (!input.isOnline) {
        const outstanding = await transaction.deliveryAssignment.findMany({
          where: {
            deliveryPartnerId: profile.id,
            status: 'OFFERED',
            expiresAt: { gt: new Date() },
          },
          select: { id: true, deliveryId: true },
        });
        if (outstanding.length) {
          const now = new Date();
          await transaction.deliveryAssignment.updateMany({
            where: { id: { in: outstanding.map(({ id }) => id) }, status: 'OFFERED' },
            data: { status: 'WITHDRAWN', respondedAt: now },
          });
          for (const assignment of outstanding) {
            await this.offerNext(transaction, assignment.deliveryId);
          }
        }
      }
      return transaction.deliveryPartner.findUniqueOrThrow({ where: { id: profile.id } });
    });
  }

  async verifyPartner(
    actorUserId: string,
    partnerId: string,
    verified: boolean,
    reason?: string,
    verificationProvider: 'MANUAL' | 'EXTERNAL' = 'MANUAL',
    verificationReference?: string,
  ) {
    if (!verified && !reason?.trim()) {
      throw new BadRequestException('A reason is required to reject a delivery partner');
    }
    if (verified && verificationProvider === 'EXTERNAL' && !verificationReference?.trim()) {
      throw new BadRequestException('An external verification reference is required');
    }
    const profile = await this.prisma.deliveryPartner.findUnique({ where: { id: partnerId } });
    if (!profile) throw new NotFoundException('Delivery partner profile not found');
    if (profile.verificationStatus !== 'PENDING') {
      throw new ConflictException('Only pending delivery partner profiles can be reviewed');
    }
    if (verified && verificationProvider === 'MANUAL') {
      const evidence = await this.prisma.deliveryEvidence.findMany({
        where: { deliveryPartnerId: partnerId, deliveryId: null },
        select: { evidenceType: true },
      });
      const evidenceTypes = new Set(evidence.map(({ evidenceType }) => evidenceType));
      if (!evidenceTypes.has('IDENTITY') || !evidenceTypes.has('VEHICLE')) {
        throw new ConflictException('Manual approval requires identity and vehicle documents');
      }
    }
    const verificationStatus = verified ? 'VERIFIED' : 'REJECTED';
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.deliveryPartner.updateMany({
        where: { id: partnerId, verificationStatus: 'PENDING' },
        data: {
          verificationStatus,
          availability: 'OFFLINE',
          verifiedAt: verified ? new Date() : null,
          verifiedByUserId: actorUserId,
          verificationProvider,
          verificationReference: verificationReference?.trim() ?? null,
          verificationReason: reason?.trim() ?? null,
        },
      });
      if (!changed.count) throw new ConflictException('Partner review was already completed');
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.dispatch.manage',
          action: verified ? 'DELIVERY_PARTNER_VERIFIED' : 'DELIVERY_PARTNER_REJECTED',
          entityType: 'delivery_partner',
          entityId: partnerId,
          before: { verificationStatus: 'PENDING' },
          after: {
            verificationStatus,
            verificationProvider,
            verificationReference: verificationReference?.trim() ?? null,
            reason: reason?.trim() ?? null,
          },
        },
      });
      return transaction.deliveryPartner.findUniqueOrThrow({ where: { id: partnerId } });
    });
    return updated;
  }

  async listPartnersForReview(status?: string) {
    if (status && !['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Delivery partner verification status is invalid');
    }
    return this.prisma.deliveryPartner.findMany({
      where: status
        ? { verificationStatus: status as 'PENDING' | 'VERIFIED' | 'REJECTED' }
        : undefined,
      include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async dispatch(deliveryId: string, actorUserId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const result = await this.offerNext(transaction, deliveryId, true);
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.dispatch.manage',
          action: 'DELIVERY_DISPATCH_REQUESTED',
          entityType: 'delivery',
          entityId: deliveryId,
          after: { assignmentId: result?.id ?? null },
        },
      });
      return result;
    });
  }

  async listOffers(userId: string) {
    const profile = await this.profileForUser(userId);
    await this.expireOffers();
    const offers = await this.prisma.deliveryAssignment.findMany({
      where: { deliveryPartnerId: profile.id, status: 'OFFERED', expiresAt: { gt: new Date() } },
      include: {
        delivery: {
          include: {
            order: {
              include: {
                restaurant: {
                  select: {
                    id: true,
                    name: true,
                    addressLine1: true,
                    city: true,
                    latitude: true,
                    longitude: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { offeredAt: 'asc' },
    });
    const partnerLocation = await this.prisma.partnerLocation.findFirst({
      where: {
        deliveryPartnerId: profile.id,
        recordedAt: { gte: new Date(Date.now() - 5 * 60_000) },
      },
      orderBy: { recordedAt: 'desc' },
      select: { latitude: true, longitude: true },
    });
    return Promise.all(offers.map((offer) => this.offerView(offer, partnerLocation)));
  }

  async acceptOffer(userId: string, assignmentId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const profile = await this.profileForUser(userId, transaction);
      if (profile.verificationStatus !== 'VERIFIED' || profile.availability !== 'ONLINE') {
        throw new ConflictException('Partner must be verified and online to accept an offer');
      }
      const assignment = await transaction.deliveryAssignment.findFirst({
        where: { id: assignmentId, deliveryPartnerId: profile.id, status: 'OFFERED' },
        include: { delivery: true },
      });
      if (!assignment) throw new NotFoundException('Delivery offer not found');
      const now = new Date();
      if (assignment.expiresAt <= now) {
        await transaction.deliveryAssignment.updateMany({
          where: { id: assignment.id, status: 'OFFERED' },
          data: { status: 'EXPIRED', respondedAt: now },
        });
        await this.offerNext(transaction, assignment.deliveryId);
        return { status: 'EXPIRED' as const };
      }
      const partnerClaimed = await transaction.deliveryPartner.updateMany({
        where: { id: profile.id, verificationStatus: 'VERIFIED', availability: 'ONLINE' },
        data: { availability: 'BUSY' },
      });
      if (!partnerClaimed.count) throw new ConflictException('Partner is no longer available');
      const deliveryChanged = await transaction.delivery.updateMany({
        where: { id: assignment.deliveryId, status: 'PENDING_ASSIGNMENT', deliveryPartnerId: null },
        data: { status: 'ASSIGNED', deliveryPartnerId: profile.id, assignedAt: now },
      });
      if (!deliveryChanged.count)
        throw new ConflictException('Another partner already accepted this delivery');
      const assignmentChanged = await transaction.deliveryAssignment.updateMany({
        where: { id: assignment.id, status: 'OFFERED', expiresAt: { gt: now } },
        data: { status: 'ACCEPTED', respondedAt: now },
      });
      if (!assignmentChanged.count)
        throw new ConflictException('Offer expired or was already answered');
      await transaction.deliveryAssignment.updateMany({
        where: { deliveryId: assignment.deliveryId, id: { not: assignment.id }, status: 'OFFERED' },
        data: { status: 'WITHDRAWN', respondedAt: now },
      });
      await this.recordDeliveryStatus(
        transaction,
        assignment.deliveryId,
        'PENDING_ASSIGNMENT',
        'ASSIGNED',
        userId,
        'PARTNER_ACCEPTED_OFFER',
      );
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: 'DELIVERY_OFFER_ACCEPTED',
          entityType: 'delivery_assignment',
          entityId: assignment.id,
          after: { deliveryId: assignment.deliveryId },
        },
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: assignment.deliveryId },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              currency: true,
              totalMinor: true,
              orderSnapshot: true,
              restaurant: {
                select: {
                  id: true,
                  name: true,
                  addressLine1: true,
                  city: true,
                  phone: true,
                  latitude: true,
                  longitude: true,
                },
              },
            },
          },
          statusHistory: true,
        },
      });
    });
  }

  async rejectOffer(userId: string, assignmentId: string, input: DeliveryOfferResponseDto) {
    return this.prisma.$transaction(async (transaction) => {
      const profile = await this.profileForUser(userId, transaction);
      const assignment = await transaction.deliveryAssignment.findFirst({
        where: { id: assignmentId, deliveryPartnerId: profile.id, status: 'OFFERED' },
      });
      if (!assignment) throw new NotFoundException('Delivery offer not found');
      const changed = await transaction.deliveryAssignment.updateMany({
        where: { id: assignment.id, status: 'OFFERED', expiresAt: { gt: new Date() } },
        data: { status: 'REJECTED', respondedAt: new Date(), rejectionReason: input.reason },
      });
      if (!changed.count) throw new ConflictException('Offer expired or was already answered');
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: 'DELIVERY_OFFER_REJECTED',
          entityType: 'delivery_assignment',
          entityId: assignment.id,
          after: { deliveryId: assignment.deliveryId, reason: input.reason },
        },
      });
      const next = await this.offerNext(transaction, assignment.deliveryId);
      return { rejected: true, nextOfferId: next?.id ?? null };
    });
  }

  async getActiveDelivery(userId: string) {
    const profile = await this.profileForUser(userId);
    return this.prisma.delivery.findFirst({
      where: { deliveryPartnerId: profile.id, status: { in: activeDeliveryStatuses } },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            currency: true,
            totalMinor: true,
            orderSnapshot: true,
            restaurant: {
              select: {
                id: true,
                name: true,
                addressLine1: true,
                city: true,
                phone: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        locations: { orderBy: { recordedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async arriveAtRestaurant(userId: string) {
    return this.transitionActiveDelivery(
      userId,
      ['ASSIGNED'],
      'ARRIVED_AT_RESTAURANT',
      'PARTNER_ARRIVED_AT_RESTAURANT',
    );
  }

  async confirmPickup(userId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const { profile, delivery } = await this.activeDelivery(transaction, userId);
      if (!['ASSIGNED', 'ARRIVED_AT_RESTAURANT'].includes(delivery.status)) {
        throw new ConflictException(`A delivery in ${delivery.status} cannot be picked up`);
      }
      if (!['PREPARING', 'READY_FOR_PICKUP'].includes(delivery.order.status)) {
        throw new ConflictException('The restaurant has not marked this order ready for pickup');
      }
      const now = new Date();
      const changed = await transaction.delivery.updateMany({
        where: {
          id: delivery.id,
          deliveryPartnerId: profile.id,
          status: { in: ['ASSIGNED', 'ARRIVED_AT_RESTAURANT'] },
        },
        data: { status: 'PICKED_UP', pickedUpAt: now },
      });
      if (!changed.count) throw new ConflictException('Delivery state changed; refresh and retry');
      await this.recordDeliveryStatus(
        transaction,
        delivery.id,
        delivery.status,
        'PICKED_UP',
        userId,
        delivery.order.status === 'PREPARING'
          ? 'PICKUP_IMPLICITLY_MARKED_READY'
          : 'PICKUP_CONFIRMED',
      );
      const orderChanged = await transaction.order.updateMany({
        where: { id: delivery.orderId, status: delivery.order.status },
        data: { status: 'PICKED_UP' },
      });
      if (orderChanged.count) {
        await transaction.orderStatusHistory.create({
          data: {
            orderId: delivery.orderId,
            actorUserId: userId,
            fromStatus: delivery.order.status,
            toStatus: 'PICKED_UP',
            reason: 'DELIVERY_PARTNER_PICKED_UP',
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: 'DELIVERY_PICKED_UP',
          entityType: 'delivery',
          entityId: delivery.id,
          after: { orderId: delivery.orderId },
        },
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  async arriveAtCustomer(userId: string) {
    return this.transitionActiveDelivery(
      userId,
      ['PICKED_UP'],
      'ARRIVED',
      'PARTNER_ARRIVED_AT_CUSTOMER',
    );
  }

  async completeDelivery(userId: string, input: DeliveryCompletionDto) {
    return this.prisma.$transaction(async (transaction) => {
      const { profile, delivery } = await this.activeDelivery(transaction, userId);
      if (!['PICKED_UP', 'ARRIVED'].includes(delivery.status)) {
        throw new ConflictException(`A delivery in ${delivery.status} cannot be completed`);
      }
      const supplied = Buffer.from(this.otpHash(delivery.id, input.deliveryCode), 'hex');
      const expected = Buffer.from(delivery.deliveryOtpHash, 'hex');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new BadRequestException('Delivery confirmation code is invalid');
      }
      const now = new Date();
      const changed = await transaction.delivery.updateMany({
        where: {
          id: delivery.id,
          deliveryPartnerId: profile.id,
          status: { in: ['PICKED_UP', 'ARRIVED'] },
        },
        data: { status: 'DELIVERED', deliveredAt: now },
      });
      if (!changed.count) throw new ConflictException('Delivery state changed; refresh and retry');
      await this.recordDeliveryStatus(
        transaction,
        delivery.id,
        delivery.status,
        'DELIVERED',
        userId,
        'DELIVERY_OTP_VERIFIED',
      );
      await this.transitionOrderFromDelivery(
        transaction,
        delivery.orderId,
        'PICKED_UP',
        'DELIVERED',
        userId,
      );
      const loyaltyOrder = await transaction.order.findUniqueOrThrow({
        where: { id: delivery.orderId },
        select: { id: true, userId: true, currency: true, subtotalMinor: true, discountMinor: true },
      });
      await recordDeliveredOrderEarning(transaction, loyaltyOrder, now);
      await transaction.deliveryPartner.update({
        where: { id: profile.id },
        data: { availability: 'ONLINE' },
      });
      for (const earning of this.calculateEarnings(delivery, input.cashTipMinor ?? 0)) {
        await transaction.partnerEarning.upsert({
          where: {
            deliveryId_earningType: { deliveryId: delivery.id, earningType: earning.type },
          },
          create: {
            deliveryId: delivery.id,
            deliveryPartnerId: profile.id,
            earningType: earning.type,
            amountMinor: earning.amountMinor,
            calculation: earning.calculation,
            currency: delivery.order.currency,
            status: earning.status,
          },
          update: {},
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: 'DELIVERY_COMPLETED',
          entityType: 'delivery',
          entityId: delivery.id,
          after: { orderId: delivery.orderId },
        },
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } }, earnings: true },
      });
    });
  }

  async failDelivery(userId: string, input: DeliveryFailureDto) {
    return this.prisma.$transaction(async (transaction) => {
      const { profile, delivery } = await this.activeDelivery(transaction, userId);
      if (!['PICKED_UP', 'ARRIVED'].includes(delivery.status)) {
        throw new ConflictException(`A delivery in ${delivery.status} cannot be failed`);
      }
      const changed = await transaction.delivery.updateMany({
        where: {
          id: delivery.id,
          deliveryPartnerId: profile.id,
          status: { in: ['PICKED_UP', 'ARRIVED'] },
        },
        data: { status: 'FAILED', failureReason: input.reason },
      });
      if (!changed.count) throw new ConflictException('Delivery state changed; refresh and retry');
      await this.recordDeliveryStatus(
        transaction,
        delivery.id,
        delivery.status,
        'FAILED',
        userId,
        input.reason,
      );
      await this.transitionOrderFromDelivery(
        transaction,
        delivery.orderId,
        'PICKED_UP',
        'DELIVERY_FAILED',
        userId,
      );
      await transaction.deliveryPartner.update({
        where: { id: profile.id },
        data: { availability: 'ONLINE' },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: 'DELIVERY_FAILED',
          entityType: 'delivery',
          entityId: delivery.id,
          after: { orderId: delivery.orderId, reason: input.reason },
        },
      });
      return transaction.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    });
  }

  async releaseDelivery(userId: string, input: DeliveryFailureDto) {
    return this.prisma.$transaction(async (transaction) => {
      const { profile, delivery } = await this.activeDelivery(transaction, userId);
      if (!['ASSIGNED', 'ARRIVED_AT_RESTAURANT'].includes(delivery.status)) {
        throw new ConflictException('A delivery can only be released before pickup');
      }
      const now = new Date();
      const changed = await transaction.delivery.updateMany({
        where: { id: delivery.id, deliveryPartnerId: profile.id, status: delivery.status },
        data: {
          status: 'PENDING_ASSIGNMENT',
          deliveryPartnerId: null,
          assignedAt: null,
          arrivedAtRestaurantAt: null,
        },
      });
      if (!changed.count) throw new ConflictException('Delivery state changed; refresh and retry');
      await transaction.deliveryAssignment.updateMany({
        where: { deliveryId: delivery.id, deliveryPartnerId: profile.id, status: 'ACCEPTED' },
        data: { status: 'RELEASED', respondedAt: now, rejectionReason: input.reason },
      });
      await transaction.deliveryPartner.update({
        where: { id: profile.id },
        data: { availability: 'ONLINE' },
      });
      await this.recordDeliveryStatus(
        transaction,
        delivery.id,
        delivery.status,
        'PENDING_ASSIGNMENT',
        userId,
        input.reason,
      );
      const next = await this.offerNext(transaction, delivery.id);
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: 'DELIVERY_ASSIGNMENT_RELEASED',
          entityType: 'delivery',
          entityId: delivery.id,
          after: { reason: input.reason, nextAssignmentId: next?.id ?? null },
        },
      });
      return { released: true, nextOfferId: next?.id ?? null };
    });
  }

  async updateLocation(userId: string, input: DeliveryLocationDto) {
    const profile = await this.profileForUser(userId);
    if (!['ONLINE', 'BUSY'].includes(profile.availability)) {
      throw new ConflictException('Partner must be online to send a location update');
    }
    if (input.deliveryId) {
      const active = await this.prisma.delivery.findFirst({
        where: {
          id: input.deliveryId,
          deliveryPartnerId: profile.id,
          status: { in: activeDeliveryStatuses },
        },
        select: { id: true },
      });
      if (!active) throw new NotFoundException('Active delivery not found');
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "DeliveryPartner" WHERE "id" = ${profile.id}::uuid FOR UPDATE`;
      const lastLocation = await transaction.partnerLocation.findFirst({
        where: { deliveryPartnerId: profile.id },
        orderBy: { recordedAt: 'desc' },
        select: { recordedAt: true },
      });
      if (lastLocation && Date.now() - lastLocation.recordedAt.getTime() < 5_000) {
        throw new ConflictException('Location updates are limited to one every five seconds');
      }
      const location = await transaction.partnerLocation.create({
        data: {
          deliveryPartnerId: profile.id,
          deliveryId: input.deliveryId,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracyM: input.accuracyM,
        },
      });
      await transaction.deliveryPartner.update({
        where: { id: profile.id },
        data: { updatedAt: new Date() },
      });
      await transaction.partnerLocation.deleteMany({
        where: {
          deliveryPartnerId: profile.id,
          recordedAt: { lt: new Date(Date.now() - 30 * 86400_000) },
        },
      });
      return location;
    });
  }

  async getEarnings(userId: string, from?: string, to?: string) {
    const profile = await this.profileForUser(userId);
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000);
    const end = to ? new Date(to) : new Date();
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      throw new BadRequestException('Earnings date range is invalid');
    }
    const earnings = await this.prisma.partnerEarning.findMany({
      where: { deliveryPartnerId: profile.id, createdAt: { gte: start, lte: end } },
      include: { delivery: { select: { orderId: true, deliveredAt: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const payouts = await this.prisma.partnerPayout.findMany({
      where: { deliveryPartnerId: profile.id },
      select: {
        id: true,
        amountMinor: true,
        currency: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        requestedAt: true,
        rejectionReason: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    });
    const totals = new Map<string, number>();
    const availableTotals = new Map<string, number>();
    for (const earning of earnings) {
      if (earning.status === 'REVERSED') continue;
      totals.set(earning.currency, (totals.get(earning.currency) ?? 0) + earning.amountMinor);
      if (earning.status === 'PENDING') {
        availableTotals.set(
          earning.currency,
          (availableTotals.get(earning.currency) ?? 0) + earning.amountMinor,
        );
      }
    }
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      totals: Object.fromEntries(totals),
      availableTotals: Object.fromEntries(availableTotals),
      earnings,
      payouts,
    };
  }

  async requestPayout(userId: string, input: PartnerPayoutRequestDto, idempotencyKey?: string) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException('A 16-128 character Idempotency-Key header is required');
    }
    const profile = await this.profileForUser(userId);
    const payoutProvider = deliveryPayoutProvider(profile.marketRegion, input.currency);
    if (!payoutProvider) {
      throw new ConflictException(
        `Payouts in ${input.currency} are not enabled for the ${profile.marketRegion} market`,
      );
    }
    const periodStart = new Date(input.from);
    const periodEnd = new Date(input.to);
    if (periodStart >= periodEnd || periodEnd > new Date()) {
      throw new BadRequestException('Payout period must be a valid completed date range');
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.partnerPayout.findUnique({
          where: { idempotencyKey },
          include: { earnings: true },
        });
        if (existing) {
          if (existing.deliveryPartnerId !== profile.id) {
            throw new ConflictException('Idempotency-Key has already been used');
          }
          return existing;
        }
        const eligible = await transaction.partnerEarning.findMany({
          where: {
            deliveryPartnerId: profile.id,
            currency: input.currency,
            status: 'PENDING',
            delivery: {
              status: 'DELIVERED',
              deliveredAt: { gte: periodStart, lte: periodEnd },
            },
          },
          select: { id: true, amountMinor: true },
          orderBy: { createdAt: 'asc' },
        });
        const amountMinor = eligible.reduce((total, earning) => total + earning.amountMinor, 0);
        if (!eligible.length || amountMinor <= 0) {
          throw new ConflictException('There are no payable completed earnings in this period');
        }
        const payout = await transaction.partnerPayout.create({
          data: {
            deliveryPartnerId: profile.id,
            requestedByUserId: userId,
            periodStart,
            periodEnd,
            amountMinor,
            currency: input.currency,
            provider: payoutProvider,
            idempotencyKey,
          },
        });
        const reserved = await transaction.partnerEarning.updateMany({
          where: { id: { in: eligible.map(({ id }) => id) }, status: 'PENDING', payoutId: null },
          data: { status: 'PAYOUT_REQUESTED', payoutId: payout.id },
        });
        if (reserved.count !== eligible.length) {
          throw new ConflictException('Earnings changed while requesting this payout');
        }
        await transaction.auditLog.create({
          data: {
            actorUserId: userId,
            permission: 'delivery.self.manage',
            action: 'PARTNER_PAYOUT_REQUESTED',
            entityType: 'partner_payout',
            entityId: payout.id,
            after: {
              amountMinor,
              currency: input.currency,
              earningCount: eligible.length,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            },
          },
        });
        return transaction.partnerPayout.findUniqueOrThrow({
          where: { id: payout.id },
          include: { earnings: true },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.partnerPayout.findUnique({
          where: { idempotencyKey },
          include: { earnings: true },
        });
        if (duplicate?.deliveryPartnerId === profile.id) return duplicate;
      }
      throw error;
    }
  }

  async listPartnerPayouts(userId: string) {
    const profile = await this.profileForUser(userId);
    return this.prisma.partnerPayout.findMany({
      where: { deliveryPartnerId: profile.id },
      include: { earnings: true, approvedBy: { select: { name: true } } },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async listPayoutsForAdmin(status?: string) {
    if (status && !['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'].includes(status)) {
      throw new BadRequestException('Payout status is invalid');
    }
    return this.prisma.partnerPayout.findMany({
      where: status
        ? { status: status as 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' }
        : undefined,
      include: {
        deliveryPartner: { include: { user: { select: { id: true, name: true, email: true } } } },
        earnings: true,
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async decidePayout(
    actorUserId: string,
    payoutId: string,
    action: 'approve' | 'reject' | 'mark-paid',
    reason?: string,
    providerReference?: string,
  ) {
    if (action === 'reject' && !reason?.trim()) {
      throw new BadRequestException('A reason is required to reject a payout');
    }
    if (action === 'mark-paid' && !providerReference?.trim()) {
      throw new BadRequestException('A transfer reference is required to mark a payout paid');
    }
    return this.prisma.$transaction(async (transaction) => {
      const payout = await transaction.partnerPayout.findUnique({
        where: { id: payoutId },
        include: { earnings: true },
      });
      if (!payout) throw new NotFoundException('Partner payout not found');
      const expected = action === 'mark-paid' ? 'APPROVED' : 'REQUESTED';
      if (payout.status !== expected) {
        throw new ConflictException(`Payout in ${payout.status} cannot ${action}`);
      }
      const status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'PAID';
      const now = new Date();
      const changed = await transaction.partnerPayout.updateMany({
        where: { id: payout.id, status: expected },
        data: {
          status,
          ...(action === 'approve' ? { approvedByUserId: actorUserId, approvedAt: now } : {}),
          ...(action === 'reject' ? { rejectionReason: reason!.trim() } : {}),
          ...(action === 'mark-paid'
            ? { providerReference: providerReference!.trim(), paidAt: now }
            : {}),
        },
      });
      if (!changed.count) throw new ConflictException('Payout state changed; refresh and retry');
      if (action === 'approve') {
        await transaction.partnerEarning.updateMany({
          where: { payoutId: payout.id, status: 'PAYOUT_REQUESTED' },
          data: { status: 'APPROVED' },
        });
      } else if (action === 'reject') {
        await transaction.partnerEarning.updateMany({
          where: { payoutId: payout.id, status: 'PAYOUT_REQUESTED' },
          data: { status: 'PENDING', payoutId: null },
        });
      } else {
        await transaction.partnerEarning.updateMany({
          where: { payoutId: payout.id, status: 'APPROVED' },
          data: { status: 'PAID' },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorUserId,
          permission: 'admin.settlements.approve',
          action: `PARTNER_PAYOUT_${status}`,
          entityType: 'partner_payout',
          entityId: payout.id,
          before: { status: payout.status },
          after: {
            status,
            reason: reason?.trim() ?? null,
            providerReference: action === 'mark-paid' ? providerReference!.trim() : null,
          },
        },
      });
      return transaction.partnerPayout.findUniqueOrThrow({
        where: { id: payout.id },
        include: { earnings: true },
      });
    });
  }

  async executeSandboxPayout(actorUserId: string, payoutId: string) {
    const payout = await this.prisma.partnerPayout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Partner payout not found');
    const transfer = this.sandboxPayouts.createTransfer(payout.id);
    if (payout.status === 'PAID' && payout.providerReference === transfer.providerReference) {
      return payout;
    }
    if (payout.status !== 'APPROVED') {
      throw new ConflictException('Only approved payouts can be sent to the sandbox provider');
    }
    const updated = await this.decidePayout(
      actorUserId,
      payout.id,
      'mark-paid',
      undefined,
      transfer.providerReference,
    );
    return { ...updated, transferMode: 'SANDBOX_NO_FUNDS_MOVED' as const };
  }

  async getCustomerTracking(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        delivery: {
          include: {
            statusHistory: { orderBy: { createdAt: 'asc' } },
            locations: { orderBy: { recordedAt: 'desc' }, take: 1 },
            deliveryPartner: { include: { user: { select: { name: true } } } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!order.delivery) return { orderId, orderStatus: order.status, delivery: null };
    const latest = order.delivery.locations[0];
    const currentLocation =
      latest && Date.now() - latest.recordedAt.getTime() <= 5 * 60_000
        ? { latitude: latest.latitude, longitude: latest.longitude, recordedAt: latest.recordedAt }
        : null;
    return {
      orderId,
      orderStatus: order.status,
      delivery: {
        id: order.delivery.id,
        status: order.delivery.status,
        history: order.delivery.statusHistory,
        deliveryPartnerName: order.delivery.deliveryPartner?.user.name ?? null,
        deliveryCode:
          order.delivery.status === 'DELIVERED' || order.delivery.status === 'FAILED'
            ? null
            : this.deliveryCode(order.delivery.id),
        currentLocation,
      },
    };
  }

  async createForAcceptedOrder(
    transaction: Prisma.TransactionClient,
    orderId: string,
    actorUserId: string,
    estimatedPreparationMinutes = 20,
  ) {
    if (
      !Number.isInteger(estimatedPreparationMinutes) ||
      estimatedPreparationMinutes < 5 ||
      estimatedPreparationMinutes > 120
    ) {
      throw new BadRequestException('Preparation estimate must be between 5 and 120 minutes');
    }
    const id = randomUUID();
    const now = new Date();
    const estimatedReadyAt = new Date(now.getTime() + estimatedPreparationMinutes * 60_000);
    const leadMinutes = Number(process.env.DELIVERY_DISPATCH_LEAD_MINUTES ?? 10);
    if (!Number.isInteger(leadMinutes) || leadMinutes < 0 || leadMinutes > 30) {
      throw new ConflictException('Delivery dispatch lead time configuration is invalid');
    }
    const dispatchAt = new Date(
      Math.max(now.getTime(), estimatedReadyAt.getTime() - leadMinutes * 60_000),
    );
    const delivery = await transaction.delivery.create({
      data: {
        id,
        orderId,
        deliveryOtpHash: this.otpHash(id, this.deliveryCode(id)),
        estimatedPreparationMinutes,
        estimatedReadyAt,
        dispatchAt,
      },
    });
    await this.recordDeliveryStatus(
      transaction,
      delivery.id,
      null,
      'PENDING_ASSIGNMENT',
      actorUserId,
      'ORDER_ACCEPTED_BY_RESTAURANT',
    );
    const offer = await this.offerNext(transaction, delivery.id);
    return { ...delivery, initialOfferId: offer?.id ?? null };
  }

  async cancelForOrder(
    transaction: Prisma.TransactionClient,
    orderId: string,
    actorUserId: string | null,
    reason: string,
  ) {
    const delivery = await transaction.delivery.findUnique({ where: { orderId } });
    if (!delivery || terminalDeliveryStatuses.includes(delivery.status)) return null;
    const changed = await transaction.delivery.updateMany({
      where: { id: delivery.id, status: { notIn: terminalDeliveryStatuses } },
      data: { status: 'CANCELLED' },
    });
    if (!changed.count) return null;
    await transaction.deliveryAssignment.updateMany({
      where: { deliveryId: delivery.id, status: { in: ['OFFERED', 'ACCEPTED'] } },
      data: { status: 'WITHDRAWN', respondedAt: new Date() },
    });
    if (delivery.deliveryPartnerId) {
      await transaction.deliveryPartner.updateMany({
        where: { id: delivery.deliveryPartnerId, availability: 'BUSY' },
        data: { availability: 'ONLINE' },
      });
    }
    await this.recordDeliveryStatus(
      transaction,
      delivery.id,
      delivery.status,
      'CANCELLED',
      actorUserId,
      reason,
    );
    return delivery;
  }

  private async offerNext(
    transaction: Prisma.TransactionClient,
    deliveryId: string,
    force = false,
  ) {
    await transaction.$queryRaw`SELECT "id" FROM "Delivery" WHERE "id" = ${deliveryId}::uuid FOR UPDATE`;
    const delivery = await transaction.delivery.findUnique({
      where: { id: deliveryId },
      include: { order: { include: { restaurant: true } } },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (!force && delivery.dispatchAt && delivery.dispatchAt > new Date()) return null;
    if (delivery.status !== 'PENDING_ASSIGNMENT' || delivery.deliveryPartnerId) {
      return null;
    }
    const existingOffer = await transaction.deliveryAssignment.findFirst({
      where: { deliveryId, status: 'OFFERED', expiresAt: { gt: new Date() } },
    });
    if (existingOffer) return existingOffer;
    await transaction.deliveryAssignment.updateMany({
      where: { deliveryId, status: 'OFFERED', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
    const previous = await transaction.deliveryAssignment.findMany({
      where: { deliveryId },
      select: { deliveryPartnerId: true },
    });
    const excluded = previous.map(({ deliveryPartnerId }) => deliveryPartnerId);
    const candidates = await transaction.deliveryPartner.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        availability: 'ONLINE',
        updatedAt: { gte: new Date(Date.now() - 90_000) },
        ...(excluded.length ? { id: { notIn: excluded } } : {}),
      },
      include: {
        locations: {
          where: { recordedAt: { gte: new Date(Date.now() - 5 * 60_000) } },
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'asc' },
    });
    if (!candidates.length) return null;
    const existingPartnerOffers = await transaction.deliveryAssignment.findMany({
      where: {
        deliveryPartnerId: { in: candidates.map(({ id }) => id) },
        status: 'OFFERED',
        expiresAt: { gt: new Date() },
      },
      select: { deliveryPartnerId: true },
    });
    const partnersWithOffers = new Set(
      existingPartnerOffers.map(({ deliveryPartnerId }) => deliveryPartnerId),
    );
    const restaurant = delivery.order.restaurant;
    const maxDistanceKm = Number(process.env.DELIVERY_DISPATCH_RADIUS_KM ?? 50);
    const offerTtlSeconds = Number(process.env.DELIVERY_OFFER_TTL_SECONDS ?? 90);
    if (
      !Number.isFinite(maxDistanceKm) ||
      maxDistanceKm <= 0 ||
      !Number.isInteger(offerTtlSeconds) ||
      offerTtlSeconds < 10 ||
      offerTtlSeconds > 900
    ) {
      throw new ConflictException('Delivery dispatch configuration is invalid');
    }
    const ranked = candidates
      .filter(({ id }) => !partnersWithOffers.has(id))
      .map((candidate) => {
        const location = candidate.locations[0];
        const distance =
          location && restaurant.latitude !== null && restaurant.longitude !== null
            ? distanceKm(
                location.latitude,
                location.longitude,
                restaurant.latitude,
                restaurant.longitude,
              )
            : restaurant.latitude === null || restaurant.longitude === null
              ? 0
              : Number.POSITIVE_INFINITY;
        return { candidate, distance };
      })
      .filter(({ distance }) => distance <= maxDistanceKm)
      .sort((left, right) => left.distance - right.distance);
    let selected: (typeof ranked)[number]['candidate'] | undefined;
    for (const { candidate } of ranked) {
      await transaction.$queryRaw`SELECT "id" FROM "DeliveryPartner" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
      const current = await transaction.deliveryPartner.findUnique({
        where: { id: candidate.id },
        select: { verificationStatus: true, availability: true, updatedAt: true },
      });
      if (
        !current ||
        current.verificationStatus !== 'VERIFIED' ||
        current.availability !== 'ONLINE' ||
        Date.now() - current.updatedAt.getTime() > 90_000
      ) {
        continue;
      }
      const outstanding = await transaction.deliveryAssignment.findFirst({
        where: {
          deliveryPartnerId: candidate.id,
          status: 'OFFERED',
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (!outstanding) {
        selected = candidate;
        break;
      }
    }
    if (!selected) return null;
    const expiresAt = new Date(Date.now() + offerTtlSeconds * 1000);
    const offer = await transaction.deliveryAssignment.create({
      data: { deliveryId, deliveryPartnerId: selected.id, expiresAt },
    });
    await transaction.auditLog.create({
      data: {
        permission: 'system.dispatch.assign',
        action: 'DELIVERY_OFFER_CREATED',
        entityType: 'delivery_assignment',
        entityId: offer.id,
        after: { deliveryId, deliveryPartnerId: selected.id, expiresAt: expiresAt.toISOString() },
      },
    });
    return offer;
  }

  private async expireOffers() {
    await this.prisma.deliveryPartner.updateMany({
      where: { availability: 'ONLINE', updatedAt: { lt: new Date(Date.now() - 90_000) } },
      data: { availability: 'OFFLINE' },
    });
    const expired = await this.prisma.deliveryAssignment.findMany({
      where: { status: 'OFFERED', expiresAt: { lte: new Date() } },
      select: { id: true, deliveryId: true },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
    for (const assignment of expired) {
      await this.prisma.$transaction(async (transaction) => {
        const now = new Date();
        const changed = await transaction.deliveryAssignment.updateMany({
          where: { id: assignment.id, status: 'OFFERED', expiresAt: { lte: now } },
          data: { status: 'EXPIRED', respondedAt: now },
        });
        if (!changed.count) return;
        await transaction.auditLog.create({
          data: {
            permission: 'system.dispatch.assign',
            action: 'DELIVERY_OFFER_EXPIRED',
            entityType: 'delivery_assignment',
            entityId: assignment.id,
            after: { deliveryId: assignment.deliveryId },
          },
        });
        await this.offerNext(transaction, assignment.deliveryId);
      });
    }
    const pendingDeliveries = await this.prisma.delivery.findMany({
      where: {
        status: 'PENDING_ASSIGNMENT',
        deliveryPartnerId: null,
        OR: [{ dispatchAt: null }, { dispatchAt: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const delivery of pendingDeliveries) {
      await this.prisma.$transaction((transaction) => this.offerNext(transaction, delivery.id));
    }
  }

  private async profileForUser(userId: string, transaction?: Prisma.TransactionClient) {
    const client = transaction ?? this.prisma;
    const profile = await client.deliveryPartner.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Delivery partner profile not found');
    return profile;
  }

  private async activeDelivery(transaction: Prisma.TransactionClient, userId: string) {
    const profile = await this.profileForUser(userId, transaction);
    const delivery = await transaction.delivery.findFirst({
      where: { deliveryPartnerId: profile.id, status: { in: activeDeliveryStatuses } },
      include: { order: { include: { restaurant: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!delivery) throw new NotFoundException('Active delivery not found');
    return { profile, delivery };
  }

  private async transitionActiveDelivery(
    userId: string,
    fromStatuses: DeliveryStatus[],
    toStatus: DeliveryStatus,
    reason: string,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const { profile, delivery } = await this.activeDelivery(transaction, userId);
      if (!fromStatuses.includes(delivery.status)) {
        throw new ConflictException(
          `A delivery in ${delivery.status} cannot transition to ${toStatus}`,
        );
      }
      const timestampField =
        toStatus === 'ARRIVED_AT_RESTAURANT'
          ? { arrivedAtRestaurantAt: new Date() }
          : toStatus === 'ARRIVED'
            ? { arrivedAt: new Date() }
            : {};
      const changed = await transaction.delivery.updateMany({
        where: { id: delivery.id, deliveryPartnerId: profile.id, status: { in: fromStatuses } },
        data: { status: toStatus, ...timestampField },
      });
      if (!changed.count) throw new ConflictException('Delivery state changed; refresh and retry');
      await this.recordDeliveryStatus(
        transaction,
        delivery.id,
        delivery.status,
        toStatus,
        userId,
        reason,
      );
      await transaction.auditLog.create({
        data: {
          actorUserId: userId,
          permission: 'delivery.self.manage',
          action: `DELIVERY_${toStatus}`,
          entityType: 'delivery',
          entityId: delivery.id,
          before: { status: delivery.status },
          after: { status: toStatus },
        },
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      });
    });
  }

  private async transitionOrderFromDelivery(
    transaction: Prisma.TransactionClient,
    orderId: string,
    fromStatus: 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP',
    toStatus: 'PICKED_UP' | 'DELIVERED' | 'DELIVERY_FAILED',
    actorUserId: string,
  ) {
    const changed = await transaction.order.updateMany({
      where: { id: orderId, status: fromStatus },
      data: { status: toStatus },
    });
    if (!changed.count)
      throw new ConflictException('Order state changed during delivery transition');
    await transaction.orderStatusHistory.create({
      data: {
        orderId,
        actorUserId,
        fromStatus,
        toStatus,
        reason: `DELIVERY_${toStatus}`,
      },
    });
  }

  private deliveryCode(deliveryId: string) {
    const secret = process.env.DELIVERY_OTP_SECRET;
    if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
      throw new ConflictException(
        'DELIVERY_OTP_SECRET must be configured with at least 32 characters',
      );
    }
    const key = secret ?? 'urban-spoon-local-delivery-otp-secret';
    const numeric =
      createHmac('sha256', key).update(deliveryId).digest().readUInt32BE(0) % 1_000_000;
    return numeric.toString().padStart(6, '0');
  }

  private otpHash(deliveryId: string, code: string) {
    return createHash('sha256').update(`${deliveryId}:${code}`).digest('hex');
  }

  private baseEarningMinor() {
    const configured = process.env.DELIVERY_BASE_EARNING_MINOR;
    if (configured === undefined && process.env.NODE_ENV === 'production') {
      throw new ConflictException('DELIVERY_BASE_EARNING_MINOR must be configured in production');
    }
    const amount = Number(configured ?? 500);
    if (!Number.isInteger(amount) || amount < 0) {
      throw new ConflictException('DELIVERY_BASE_EARNING_MINOR must be a non-negative integer');
    }
    return amount;
  }

  private calculateEarnings(
    delivery: {
      id: string;
      order: {
        currency: string;
        orderSnapshot: Prisma.JsonValue;
        restaurant: { latitude: number | null; longitude: number | null };
      };
    },
    cashTipMinor: number,
  ) {
    const baseMinor = this.baseEarningMinor();
    const distanceRate = this.configuredEarningAmount(
      'DELIVERY_DISTANCE_EARNING_MINOR_PER_KM',
      100,
    );
    const completionIncentive = this.configuredEarningAmount(
      'DELIVERY_COMPLETION_INCENTIVE_MINOR',
      0,
    );
    const snapshot = delivery.order.orderSnapshot;
    const address =
      typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
        ? snapshot.address
        : null;
    const hasCoordinates =
      typeof address === 'object' &&
      address !== null &&
      !Array.isArray(address) &&
      typeof address.latitude === 'number' &&
      typeof address.longitude === 'number' &&
      delivery.order.restaurant.latitude !== null &&
      delivery.order.restaurant.longitude !== null;
    const straightLineDistanceKm = hasCoordinates
      ? distanceKm(
          delivery.order.restaurant.latitude!,
          delivery.order.restaurant.longitude!,
          (address as Prisma.JsonObject).latitude as number,
          (address as Prisma.JsonObject).longitude as number,
        )
      : 0;
    const distanceMinor = Math.round(straightLineDistanceKm * distanceRate);

    return [
      {
        type: 'BASE' as const,
        amountMinor: baseMinor,
        status: 'PENDING' as const,
        calculation: {
          policyVersion: 1,
          formula: 'fixed_base',
          baseMinor,
        } as Prisma.InputJsonValue,
      },
      ...(distanceMinor > 0
        ? [
            {
              type: 'DISTANCE' as const,
              amountMinor: distanceMinor,
              status: 'PENDING' as const,
              calculation: {
                policyVersion: 1,
                formula: 'straight_line_km_times_rate',
                estimatedDistanceKm: Math.round(straightLineDistanceKm * 100) / 100,
                rateMinorPerKm: distanceRate,
                amountMinor: distanceMinor,
              } as Prisma.InputJsonValue,
            },
          ]
        : []),
      ...(completionIncentive > 0
        ? [
            {
              type: 'INCENTIVE' as const,
              amountMinor: completionIncentive,
              status: 'PENDING' as const,
              calculation: {
                policyVersion: 1,
                formula: 'configured_completion_incentive',
                amountMinor: completionIncentive,
              } as Prisma.InputJsonValue,
            },
          ]
        : []),
      ...(cashTipMinor > 0
        ? [
            {
              type: 'TIP' as const,
              amountMinor: cashTipMinor,
              status: 'PAID' as const,
              calculation: {
                policyVersion: 1,
                formula: 'cash_tip_received_by_partner',
                amountMinor: cashTipMinor,
                paidOutsidePlatform: true,
              } as Prisma.InputJsonValue,
            },
          ]
        : []),
    ];
  }

  private configuredEarningAmount(name: string, fallback: number) {
    const configured = process.env[name];
    const amount = Number(configured ?? fallback);
    if (!Number.isInteger(amount) || amount < 0) {
      throw new ConflictException(`${name} must be a non-negative integer`);
    }
    if (configured === undefined && process.env.NODE_ENV === 'production') {
      throw new ConflictException(`${name} must be configured in production`);
    }
    return amount;
  }

  private async recordDeliveryStatus(
    transaction: Prisma.TransactionClient,
    deliveryId: string,
    fromStatus: DeliveryStatus | null,
    toStatus: DeliveryStatus,
    actorUserId: string | null,
    reason: string,
    correlationId?: string,
  ) {
    await transaction.deliveryStatusHistory.create({
      data: { deliveryId, fromStatus, toStatus, actorUserId, reason, correlationId },
    });
  }

  private async offerView(
    offer: Prisma.DeliveryAssignmentGetPayload<{
      include: {
        delivery: {
          include: {
            order: {
              include: {
                restaurant: {
                  select: {
                    id: true;
                    name: true;
                    addressLine1: true;
                    city: true;
                    latitude: true;
                    longitude: true;
                  };
                };
              };
            };
          };
        };
      };
    }>,
    partnerLocation: { latitude: number; longitude: number } | null,
  ) {
    const snapshot = offer.delivery.order.orderSnapshot as Prisma.JsonObject;
    const address =
      typeof snapshot.address === 'object' &&
      snapshot.address !== null &&
      !Array.isArray(snapshot.address)
        ? (snapshot.address as Prisma.JsonObject)
        : null;
    const restaurant = offer.delivery.order.restaurant;
    const pickupStraightLineKm =
      partnerLocation && restaurant.latitude !== null && restaurant.longitude !== null
        ? distanceKm(
            partnerLocation.latitude,
            partnerLocation.longitude,
            restaurant.latitude,
            restaurant.longitude,
          )
        : null;
    const dropoffStraightLineKm =
      restaurant.latitude !== null &&
      restaurant.longitude !== null &&
      typeof address?.latitude === 'number' &&
      typeof address.longitude === 'number'
        ? distanceKm(restaurant.latitude, restaurant.longitude, address.latitude, address.longitude)
        : null;
    const partnerCoordinates = partnerLocation
      ? { latitude: partnerLocation.latitude, longitude: partnerLocation.longitude }
      : null;
    const restaurantCoordinates =
      restaurant.latitude !== null && restaurant.longitude !== null
        ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
        : null;
    const addressCoordinates =
      typeof address?.latitude === 'number' && typeof address.longitude === 'number'
        ? { latitude: address.latitude, longitude: address.longitude }
        : null;
    const [pickupRoute, dropoffRoute] = await Promise.all([
      partnerCoordinates && restaurantCoordinates
        ? this.routing.route(partnerCoordinates, restaurantCoordinates)
        : null,
      restaurantCoordinates && addressCoordinates
        ? this.routing.route(restaurantCoordinates, addressCoordinates)
        : null,
    ]);
    const pickupDistanceKm = pickupRoute?.distanceKm ?? pickupStraightLineKm;
    const dropoffDistanceKm = dropoffRoute?.distanceKm ?? dropoffStraightLineKm;
    const estimateMinutes = (distance: number | null, routeDuration: number | undefined) =>
      routeDuration ?? (distance === null ? null : Math.max(1, Math.ceil((distance / 20) * 60)));
    return {
      id: offer.id,
      offeredAt: offer.offeredAt,
      expiresAt: offer.expiresAt,
      estimates: {
        kind:
          pickupRoute && dropoffRoute
            ? ('ROAD_ROUTE' as const)
            : pickupRoute || dropoffRoute
              ? ('MIXED' as const)
              : ('STRAIGHT_LINE' as const),
        pickupDistanceKm: pickupDistanceKm === null ? null : Math.round(pickupDistanceKm * 10) / 10,
        pickupMinutes: estimateMinutes(pickupDistanceKm, pickupRoute?.durationMinutes),
        deliveryDistanceKm:
          dropoffDistanceKm === null ? null : Math.round(dropoffDistanceKm * 10) / 10,
        deliveryMinutes: estimateMinutes(dropoffDistanceKm, dropoffRoute?.durationMinutes),
      },
      delivery: {
        id: offer.delivery.id,
        status: offer.delivery.status,
        estimatedPreparationMinutes: offer.delivery.estimatedPreparationMinutes,
        estimatedReadyAt: offer.delivery.estimatedReadyAt,
        restaurant,
        address,
        items: Array.isArray(snapshot.items) ? snapshot.items : [],
      },
    };
  }
}
