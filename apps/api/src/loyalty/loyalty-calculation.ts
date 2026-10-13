export function calculateEarnedPoints(eligibleSubtotalMinor: number, earnRateBps: number) {
  if (!Number.isSafeInteger(eligibleSubtotalMinor) || eligibleSubtotalMinor < 0) {
    throw new RangeError('Eligible subtotal must be a non-negative safe integer');
  }
  if (!Number.isInteger(earnRateBps) || earnRateBps < 0 || earnRateBps > 10_000) {
    throw new RangeError('Loyalty earning rate must be between 0 and 10000 basis points');
  }
  return Math.floor((eligibleSubtotalMinor * earnRateBps) / 10_000);
}

const loyaltyTiers = [
  { name: 'BRONZE', threshold: 0, multiplierBps: 10_000 },
  { name: 'SILVER', threshold: 500, multiplierBps: 11_000 },
  { name: 'GOLD', threshold: 2_500, multiplierBps: 12_500 },
  { name: 'PLATINUM', threshold: 10_000, multiplierBps: 15_000 },
] as const;

export type LoyaltyTier = (typeof loyaltyTiers)[number];

export function loyaltyTier(lifetimeEarnedPoints: number): LoyaltyTier {
  if (!Number.isSafeInteger(lifetimeEarnedPoints) || lifetimeEarnedPoints < 0) {
    throw new RangeError('Lifetime earned points must be a non-negative safe integer');
  }
  return [...loyaltyTiers].reverse().find((tier) => lifetimeEarnedPoints >= tier.threshold)!;
}

export function calculateTieredEarnedPoints(
  eligibleSubtotalMinor: number,
  earnRateBps: number,
  multiplierBps: number,
) {
  if (!Number.isInteger(multiplierBps) || multiplierBps < 10_000 || multiplierBps > 20_000) {
    throw new RangeError('Loyalty tier multiplier must be between 10000 and 20000 basis points');
  }
  const basePoints = calculateEarnedPoints(eligibleSubtotalMinor, earnRateBps);
  return Math.floor((basePoints * multiplierBps) / 10_000);
}

export function calculateRedemption(
  requestedPoints: number,
  availablePoints: number,
  eligibleSubtotalMinor: number,
  redeemMinorPerPoint: number,
) {
  if (!Number.isSafeInteger(requestedPoints) || requestedPoints <= 0) {
    throw new RangeError('Redemption points must be a positive safe integer');
  }
  if (!Number.isSafeInteger(availablePoints) || availablePoints < requestedPoints) {
    throw new RangeError('Insufficient available FoodCoins');
  }
  if (!Number.isSafeInteger(eligibleSubtotalMinor) || eligibleSubtotalMinor <= 0) {
    throw new RangeError('Eligible subtotal must be a positive safe integer');
  }
  if (!Number.isSafeInteger(redeemMinorPerPoint) || redeemMinorPerPoint <= 0) {
    throw new RangeError('Redemption conversion must be a positive safe integer');
  }
  const discountMinor = requestedPoints * redeemMinorPerPoint;
  if (!Number.isSafeInteger(discountMinor) || discountMinor > eligibleSubtotalMinor) {
    throw new RangeError('Redemption exceeds the eligible item subtotal');
  }
  return { points: requestedPoints, discountMinor };
}