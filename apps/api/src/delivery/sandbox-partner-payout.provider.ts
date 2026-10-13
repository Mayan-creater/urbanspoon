import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class SandboxPartnerPayoutProvider {
  createTransfer(payoutId: string) {
    if (
      process.env.NODE_ENV === 'production' ||
      (process.env.DELIVERY_PAYOUT_MODE ?? 'sandbox') !== 'sandbox'
    ) {
      throw new ConflictException('Sandbox payouts are disabled; configure a transfer provider');
    }
    return {
      providerReference: `sandbox-${payoutId}`,
      status: 'SUCCEEDED' as const,
      fundsMoved: false as const,
    };
  }
}
