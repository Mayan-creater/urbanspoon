import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service.js';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import { IS_PUBLIC } from './auth.decorators.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { hashSessionToken } from './crypto.util.js';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token) throw new UnauthorizedException();

    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException();
    }

    request.authUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    request.authSessionId = session.id;
    request.authToken = token;
    return true;
  }
}
