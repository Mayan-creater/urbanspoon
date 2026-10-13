import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';

@Injectable()
export class VerificationMailerService {
  constructor(private readonly config: ConfigService) {}

  async sendCode(email: string, name: string, code: string, purpose: 'verify' | 'reset') {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) throw new ServiceUnavailableException('Email delivery is unavailable');

    const port = Number(this.config.get<string>('SMTP_PORT') ?? 1025);
    const user = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');
    const transport = createTransport({
      host,
      port,
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      ...(user && password ? { auth: { user, pass: password } } : {}),
    });

    try {
      await transport.sendMail({
        from: this.config.get<string>('SMTP_FROM') ?? 'Urban Spoon <no-reply@urbanspoon.local>',
        to: email,
        subject:
          purpose === 'verify'
            ? 'Verify your Urban Spoon account'
            : 'Reset your Urban Spoon password',
        text:
          purpose === 'verify'
            ? `Hi ${name}, your Urban Spoon verification code is ${code}. It expires in 10 minutes.`
            : `Hi ${name}, your Urban Spoon password reset code is ${code}. It expires in 15 minutes.`,
      });
    } catch {
      throw new ServiceUnavailableException('Email delivery is unavailable');
    } finally {
      transport.close();
    }
  }
}
