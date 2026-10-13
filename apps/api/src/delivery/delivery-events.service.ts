import { ForbiddenException, Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import {
  defer,
  exhaustMap,
  from,
  interval,
  map,
  startWith,
  switchMap,
  distinctUntilChanged,
} from 'rxjs';
import { PrismaService } from '../database/prisma.service.js';
import { DeliveryService } from './delivery.service.js';

@Injectable()
export class DeliveryEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: DeliveryService,
  ) {}

  partnerStream(userId: string, partnerId: string) {
    return defer(() =>
      from(
        this.prisma.deliveryPartner.findUnique({
          where: { userId },
          select: { id: true },
        }),
      ),
    ).pipe(
      switchMap((partner) => {
        if (!partner) throw new NotFoundException('Delivery partner profile not found');
        if (partner.id !== partnerId) throw new ForbiddenException();
        return interval(5_000).pipe(
          startWith(0),
          exhaustMap(() => from(this.partnerSnapshot(partnerId))),
          distinctUntilChanged(
            (previous, current) => JSON.stringify(previous) === JSON.stringify(current),
          ),
          map((data) => ({ data }) satisfies MessageEvent),
        );
      }),
    );
  }

  orderStream(userId: string, orderId: string) {
    return defer(() =>
      from(
        this.prisma.order.findFirst({
          where: { id: orderId, userId },
          select: { id: true },
        }),
      ),
    ).pipe(
      switchMap((order) => {
        if (!order) throw new NotFoundException('Order not found');
        return interval(5_000).pipe(
          startWith(0),
          exhaustMap(() => from(this.deliveries.getCustomerTracking(userId, orderId))),
          distinctUntilChanged(
            (previous, current) => JSON.stringify(previous) === JSON.stringify(current),
          ),
          map((data) => ({ data }) satisfies MessageEvent),
        );
      }),
    );
  }

  private async partnerSnapshot(partnerId: string) {
    const [profile, active, offers] = await Promise.all([
      this.prisma.deliveryPartner.findUnique({
        where: { id: partnerId },
        select: { availability: true, verificationStatus: true },
      }),
      this.prisma.delivery.findFirst({
        where: {
          deliveryPartnerId: partnerId,
          status: { in: ['ASSIGNED', 'ARRIVED_AT_RESTAURANT', 'PICKED_UP', 'ARRIVED'] },
        },
        select: { id: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.deliveryAssignment.findMany({
        where: { deliveryPartnerId: partnerId, status: 'OFFERED', expiresAt: { gt: new Date() } },
        select: { id: true, deliveryId: true, expiresAt: true },
        orderBy: { offeredAt: 'asc' },
      }),
    ]);
    if (!profile) throw new NotFoundException('Delivery partner profile not found');
    return {
      type: 'DELIVERY_PARTNER_SNAPSHOT',
      availability: profile.availability,
      verificationStatus: profile.verificationStatus,
      active: active ? { id: active.id, status: active.status, updatedAt: active.updatedAt } : null,
      offers,
    };
  }
}
