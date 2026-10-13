import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { VerificationMailerService } from './verification-mailer.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, VerificationMailerService],
  exports: [AuthService],
})
export class AuthModule {}
