import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VerificationPurpose } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import {
  MAX_VERIFICATION_ATTEMPTS,
  PASSWORD_RESET_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  VERIFICATION_LIFETIME_MS,
} from './auth.constants.js';
import type {
  EmailCodeDto,
  EmailDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto.js';
import {
  createOneTimeCode,
  createSessionToken,
  hashOneTimeCode,
  hashPassword,
  hashSessionToken,
  safelyCompareHex,
  verifyPassword,
} from './crypto.util.js';
import type { AuthenticatedUser, SessionResult } from './auth.types.js';
import { VerificationMailerService } from './verification-mailer.service.js';

const GENERIC_REGISTRATION_MESSAGE =
  'If the address can be registered, a verification code will be sent.';
const GENERIC_RECOVERY_MESSAGE =
  'If an account exists for that address, password recovery instructions will be sent.';

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: VerificationMailerService,
  ) {}

  async register(input: RegisterDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const code = createOneTimeCode();
    const userId = crypto.randomUUID();

    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.user.create({
          data: {
            id: userId,
            name: input.name.trim(),
            email,
            phone: input.phone?.trim() || null,
            credentials: {
              create: {
                provider: 'password',
                providerSubject: email,
                passwordHash,
              },
            },
            roles: {
              create: { role: 'customer', scopeType: 'PLATFORM' },
            },
          },
        });
        await transaction.authVerification.create({
          data: {
            userId,
            purpose: VerificationPurpose.EMAIL,
            tokenHash: this.hashCode(code, 'EMAIL'),
            expiresAt: new Date(Date.now() + VERIFICATION_LIFETIME_MS),
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return { message: GENERIC_REGISTRATION_MESSAGE };
      throw error;
    }

    await this.mailer.sendCode(email, input.name.trim(), code, 'verify');
    return { message: GENERIC_REGISTRATION_MESSAGE };
  }

  async resendVerification(input: EmailDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { credentials: { where: { provider: 'password' } } },
    });
    const credential = user?.credentials[0];
    if (!user || !credential || credential.verifiedAt) {
      return { message: GENERIC_REGISTRATION_MESSAGE };
    }

    const code = await this.prisma.$transaction(async (transaction) =>
      this.issueCode(transaction, user.id, VerificationPurpose.EMAIL, 'EMAIL'),
    );
    await this.mailer.sendCode(email, user.name, code, 'verify');
    return { message: GENERIC_REGISTRATION_MESSAGE };
  }

  async verifyEmail(input: EmailCodeDto): Promise<SessionResult> {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { credentials: { where: { provider: 'password' } } },
    });
    const credential = user?.credentials[0];
    if (!user || !credential || credential.verifiedAt || user.status !== 'ACTIVE') {
      throw new BadRequestException('Verification code is invalid or expired');
    }

    const now = new Date();
    const verification = await this.prisma.authVerification.findFirst({
      where: {
        userId: user.id,
        purpose: VerificationPurpose.EMAIL,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification) throw new BadRequestException('Verification code is invalid or expired');

    if (!safelyCompareHex(verification.tokenHash, this.hashCode(input.code, 'EMAIL'))) {
      const nextAttempts = verification.attempts + 1;
      await this.prisma.authVerification.updateMany({
        where: {
          id: verification.id,
          consumedAt: null,
          attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        },
        data: {
          attempts: { increment: 1 },
          ...(nextAttempts >= MAX_VERIFICATION_ATTEMPTS ? { consumedAt: now } : {}),
        },
      });
      throw new BadRequestException('Verification code is invalid or expired');
    }

    return this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.authVerification.updateMany({
        where: {
          id: verification.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('Verification code is invalid or expired');
      }

      await transaction.authCredential.update({
        where: { id: credential.id },
        data: { verifiedAt: now },
      });
      return this.createSession(transaction, {
        id: user.id,
        email: user.email,
        name: user.name,
      });
    });
  }

  async login(input: LoginDto): Promise<SessionResult> {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { credentials: { where: { provider: 'password' } } },
    });
    const credential = user?.credentials[0];
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !credential ||
      !credential.verifiedAt ||
      !(await verifyPassword(input.password, credential.passwordHash))
    ) {
      throw new UnauthorizedException('Email or password is incorrect');
    }

    return this.createSession(this.prisma, {
      id: user.id,
      email: user.email,
      name: user.name,
    });
  }

  async logout(token?: string): Promise<void> {
    if (!token) return;
    await this.prisma.authSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async refresh(
    user: AuthenticatedUser,
    sessionId: string,
    oldToken: string,
  ): Promise<SessionResult> {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    const updated = await this.prisma.authSession.updateMany({
      where: {
        id: sessionId,
        userId: user.id,
        tokenHash: hashSessionToken(oldToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { tokenHash: hashSessionToken(token), expiresAt },
    });
    if (updated.count !== 1) throw new UnauthorizedException();
    return { user, token, sessionId };
  }

  async requestPasswordReset(input: EmailDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return { message: GENERIC_RECOVERY_MESSAGE };

    const code = await this.prisma.$transaction(async (transaction) => {
      await transaction.passwordReset.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const nextCode = createOneTimeCode();
      await transaction.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: this.hashCode(nextCode, 'PASSWORD_RESET'),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_LIFETIME_MS),
        },
      });
      return nextCode;
    });

    await this.mailer.sendCode(email, user.name, code, 'reset');
    return { message: GENERIC_RECOVERY_MESSAGE };
  }

  async resetPassword(input: ResetPasswordDto): Promise<{ message: string }> {
    const email = this.normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { credentials: { where: { provider: 'password' } } },
    });
    const credential = user?.credentials[0];
    const now = new Date();
    const reset = user
      ? await this.prisma.passwordReset.findFirst({
          where: {
            userId: user.id,
            consumedAt: null,
            expiresAt: { gt: now },
            attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    if (!user || !credential || !reset || reset.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      throw new BadRequestException('Reset code is invalid or expired');
    }

    if (!safelyCompareHex(reset.tokenHash, this.hashCode(input.code, 'PASSWORD_RESET'))) {
      const nextAttempts = reset.attempts + 1;
      await this.prisma.passwordReset.updateMany({
        where: {
          id: reset.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        },
        data: {
          attempts: { increment: 1 },
          ...(nextAttempts >= MAX_VERIFICATION_ATTEMPTS ? { consumedAt: now } : {}),
        },
      });
      throw new BadRequestException('Reset code is invalid or expired');
    }

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.passwordReset.updateMany({
        where: {
          id: reset.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: MAX_VERIFICATION_ATTEMPTS },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException('Reset code is invalid or expired');
      await transaction.authCredential.update({
        where: { id: credential.id },
        data: { passwordHash },
      });
      await transaction.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
    });
    return { message: 'Password updated. Please sign in again.' };
  }

  private async issueCode(
    transaction: Prisma.TransactionClient,
    userId: string,
    purpose: VerificationPurpose,
    hashPurpose: string,
  ): Promise<string> {
    const now = new Date();
    await transaction.authVerification.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    const code = createOneTimeCode();
    await transaction.authVerification.create({
      data: {
        userId,
        purpose,
        tokenHash: this.hashCode(code, hashPurpose),
        expiresAt: new Date(now.getTime() + VERIFICATION_LIFETIME_MS),
      },
    });
    return code;
  }

  private async createSession(
    transaction: Prisma.TransactionClient | PrismaService,
    user: AuthenticatedUser,
  ): Promise<SessionResult> {
    const token = createSessionToken();
    const session = await transaction.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      },
    });
    return { user, token, sessionId: session.id };
  }

  private hashCode(code: string, purpose: string): string {
    return hashOneTimeCode(code, this.config.getOrThrow<string>('AUTH_TOKEN_SECRET'), purpose);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
