import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AddressesModule } from './addresses/addresses.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PermissionsGuard } from './auth/permissions.guard.js';
import { SessionAuthGuard } from './auth/session-auth.guard.js';
import { RolesModule } from './admin/roles.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { UsersModule } from './users/users.module.js';
import { RestaurantsModule } from './restaurants/restaurants.module.js';
import { CartsModule } from './carts/carts.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { SupportModule } from './support/support.module.js';
import { LoyaltyModule } from './loyalty/loyalty.module.js';
import { GroupOrdersModule } from './group-orders/group-orders.module.js';
import { AiModule } from './ai/ai.module.js';
import { CateringModule } from './catering/catering.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      validate: (environment) => {
        const authSecret = environment.AUTH_TOKEN_SECRET;
        if (
          environment.NODE_ENV === 'production' &&
          (!authSecret ||
            authSecret.length < 32 ||
            authSecret === 'development-only-change-before-production')
        ) {
          throw new Error('AUTH_TOKEN_SECRET must be a unique 32-character secret in production.');
        }
        if (environment.NODE_ENV === 'production') {
          const evidenceKey = environment.DELIVERY_EVIDENCE_ENCRYPTION_KEY ?? '';
          if (
            !/^[A-Za-z0-9+/]{43}=$/.test(evidenceKey) ||
            Buffer.from(evidenceKey, 'base64').length !== 32
          ) {
            throw new Error(
              'DELIVERY_EVIDENCE_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production.',
            );
          }
        }
        return environment;
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RestaurantsModule,
    CartsModule,
    OrdersModule,
    ReviewsModule,
    SupportModule,
    LoyaltyModule,
    GroupOrdersModule,
    AiModule,
    CateringModule,
    AddressesModule,
    RolesModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
