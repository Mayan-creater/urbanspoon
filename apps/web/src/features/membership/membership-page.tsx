'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface MembershipPlan {
  id: string;
  key: string;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  interval: 'MONTHLY' | 'YEARLY';
  benefits: string[];
  version: number;
}

interface CurrentMembership {
  id: string;
  status: string;
  endsAt: string | null;
  plan: MembershipPlan;
}

function price(plan: MembershipPlan) {
  const options = { style: 'currency', currency: plan.currency } as const;
  const digits = new Intl.NumberFormat('en', options).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat('en', options).format(plan.priceMinor / 10 ** (digits ?? 2));
}

export function MembershipPage() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [membership, setMembership] = useState<CurrentMembership | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [plansResponse, membershipResponse] = await Promise.all([
          fetch(`${apiBase}/memberships/plans`, { cache: 'no-store' }),
          fetch(`${apiBase}/memberships/me`, { credentials: 'include', cache: 'no-store' }),
        ]);
        if (!plansResponse.ok) throw new Error('Membership plans could not be loaded.');
        const planEnvelope = (await plansResponse.json()) as { data: MembershipPlan[] };
        setPlans(planEnvelope.data);
        if (membershipResponse.status === 401) {
          setSignedIn(false);
          setMembership(null);
        } else if (membershipResponse.ok) {
          const membershipEnvelope = (await membershipResponse.json()) as {
            data: { membership: CurrentMembership | null; activationAvailable: boolean };
          };
          setSignedIn(true);
          setMembership(membershipEnvelope.data.membership);
        } else {
          throw new Error('Membership status could not be loaded.');
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Membership is unavailable.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <main className="membership-page">
      <nav className="top-nav" aria-label="Membership navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <div className="top-nav-actions">
          <Link href="/loyalty">FoodCoins</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>
      <section className="membership-content" aria-labelledby="membership-title">
        <p className="eyebrow">Urban Spoon FoodPass</p>
        <h1 id="membership-title">Membership plans</h1>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {loading ? (
          <p role="status">Loading membership plans…</p>
        ) : (
          <>
            <section className="membership-status" aria-labelledby="membership-status-title">
              <div>
                <h2 id="membership-status-title">Your membership</h2>
                {membership ? (
                  <p>
                    {membership.plan.name} · {membership.status}
                    {membership.endsAt
                      ? ` · Ends ${new Date(membership.endsAt).toLocaleDateString()}`
                      : ''}
                  </p>
                ) : (
                  <p>
                    {signedIn ? 'No active membership.' : 'Sign in to view your membership status.'}
                  </p>
                )}
              </div>
              {!signedIn && <Link className="text-link" href="/login">Sign in</Link>}
            </section>
            <p className="membership-gate" role="note">
              Plan activation is unavailable until a payment provider is configured. No benefits are
              applied before payment confirmation.
            </p>
            <section className="membership-plans" aria-labelledby="available-plans-title">
              <div className="membership-section-heading">
                <h2 id="available-plans-title">Available plans</h2>
                <span>{plans.length} plans</span>
              </div>
              {plans.length ? (
                <ul className="membership-plan-list">
                  {plans.map((plan) => (
                    <li className="membership-plan" key={plan.id}>
                      <div>
                        <h3>{plan.name}</h3>
                        <p>{plan.description}</p>
                        <ul>
                          {plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                        </ul>
                      </div>
                      <div className="membership-plan-price">
                        <strong>{price(plan)}</strong>
                        <span>per {plan.interval === 'MONTHLY' ? 'month' : 'year'}</span>
                        <small>Plan v{plan.version}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="membership-empty">No membership plans are currently available.</p>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}