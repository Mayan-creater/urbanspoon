import { describe, expect, it } from 'vitest';
import { deliveryPayoutProvider } from './delivery-payout-market.js';

describe('deliveryPayoutProvider', () => {
  it('selects Razorpay Route for India and Stripe Connect for US/euro-area payouts', () => {
    expect(deliveryPayoutProvider('IN', 'INR')).toBe('RAZORPAY_ROUTE');
    expect(deliveryPayoutProvider('US', 'USD')).toBe('STRIPE_CONNECT');
    expect(deliveryPayoutProvider('EU', 'EUR')).toBe('STRIPE_CONNECT');
  });

  it('disables unsupported regions and currency mismatches', () => {
    expect(deliveryPayoutProvider('CN', 'CNY')).toBeNull();
    expect(deliveryPayoutProvider('RU', 'RUB')).toBeNull();
    expect(deliveryPayoutProvider('IN', 'USD')).toBeNull();
    expect(deliveryPayoutProvider('US', 'EUR')).toBeNull();
  });
});
