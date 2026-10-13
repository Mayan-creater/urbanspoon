import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentSession, CurrentUser, Public } from './auth.decorators.js';
import { EmailCodeDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto } from './auth.dto.js';
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_MS } from './auth.constants.js';
import type { AuthenticatedRequest, AuthenticatedUser, SessionResult } from './auth.types.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async verify(@Body() body: EmailCodeDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.verifyEmail(body);
    this.setSessionCookie(response, result);
    return { user: result.user };
  }

  @Public()
  @Post('verify/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  resendVerification(@Body() body: EmailDto) {
    return this.auth.resendVerification(body);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body);
    this.setSessionCookie(response, result);
    return { user: result.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = (request as AuthenticatedRequest).cookies?.[SESSION_COOKIE_NAME];
    await this.auth.logout(token);
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
    return { message: 'Logged out' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSession() session: { id: string; token: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.refresh(user, session.id, session.token);
    this.setSessionCookie(response, result);
    return { user: result.user };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  forgotPassword(@Body() body: EmailDto) {
    return this.auth.requestPasswordReset(body);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body);
  }

  private setSessionCookie(response: Response, result: SessionResult) {
    response.cookie(SESSION_COOKIE_NAME, result.token, {
      ...this.cookieOptions(),
      maxAge: SESSION_LIFETIME_MS,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
