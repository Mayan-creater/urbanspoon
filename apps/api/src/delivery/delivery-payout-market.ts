export type DeliveryMarket = 'IN' | 'US' | 'EU' | 'CN' | 'RU';
export type DeliveryPayoutProvider = 'RAZORPAY_ROUTE' | 'STRIPE_CONNECT';

const payoutProviders: Record<DeliveryMarket, Record<string, DeliveryPayoutProvider>> = {
  IN: { INR: 'RAZORPAY_ROUTE' },
  US: { USD: 'STRIPE_CONNECT' },
  EU: { EUR: 'STRIPE_CONNECT' },
  CN: {},
  RU: {},
};

export function deliveryPayoutProvider(market: string, currency: string) {
  return payoutProviders[market as DeliveryMarket]?.[currency] ?? null;
}
