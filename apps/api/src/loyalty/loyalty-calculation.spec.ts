import { describe, expect, it } from 'vitest';
import {
  calculateEarnedPoints,
  calculateRedemption,
  calculateTieredEarnedPoints,
  loyaltyTier,
} from './loyalty-calculation.js';

describe('calculateEarnedPoints', () => {
  it('calculates points from the eligible subtotal and basis-point rate', () => {
    expect(calculateEarnedPoints(10_000, 100)).toBe(100);
  });

  it('rounds down fractional points and grants none for a zero subtotal', () => {
    expect(calculateEarnedPoints(999, 100)).toBe(9);
    expect(calculateEarnedPoints(0, 100)).toBe(0);
  });

  it('rejects invalid subtotal and rule values', () => {
    expect(() => calculateEarnedPoints(-1, 100)).toThrow(RangeError);
    expect(() => calculateEarnedPoints(100, 10_001)).toThrow(RangeError);
  });

  it('applies confirmed lifetime tier thresholds and earning multipliers', () => {
    expect(loyaltyTier(499)).toMatchObject({ name: 'BRONZE', multiplierBps: 10_000 });
    expect(loyaltyTier(500)).toMatchObject({ name: 'SILVER', multiplierBps: 11_000 });
    expect(loyaltyTier(2_500)).toMatchObject({ name: 'GOLD', multiplierBps: 12_500 });
    expect(loyaltyTier(10_000)).toMatchObject({ name: 'PLATINUM', multiplierBps: 15_000 });
    expect(calculateTieredEarnedPoints(10_000, 100, 11_000)).toBe(110);
  });

  it('converts points to minor currency units and rejects invalid or excessive redemption', () => {
    expect(calculateRedemption(100, 250, 5_000, 1)).toEqual({ points: 100, discountMinor: 100 });
    expect(() => calculateRedemption(251, 250, 5_000, 1)).toThrow('Insufficient available FoodCoins');
    expect(() => calculateRedemption(100, 250, 99, 1)).toThrow(
      'Redemption exceeds the eligible item subtotal',
    );
  });
});