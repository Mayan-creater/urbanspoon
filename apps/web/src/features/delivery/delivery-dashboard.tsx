'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const payoutCurrencyByMarket = {
  IN: 'INR',
  US: 'USD',
  EU: 'EUR',
  CN: null,
  RU: null,
} as const;

type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
type Availability = 'OFFLINE' | 'ONLINE' | 'BUSY' | 'SUSPENDED';
type DeliveryStatus =
  | 'ASSIGNED'
  | 'ARRIVED_AT_RESTAURANT'
  | 'PICKED_UP'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

interface PartnerProfile {
  id: string;
  vehicleType: string;
  marketRegion: 'IN' | 'US' | 'EU' | 'CN' | 'RU';
  verificationStatus: VerificationStatus;
  availability: Availability;
}

interface DeliveryOffer {
  id: string;
  expiresAt: string;
  estimates: {
    kind: 'ROAD_ROUTE' | 'STRAIGHT_LINE' | 'MIXED';
    pickupDistanceKm: number | null;
    pickupMinutes: number | null;
    deliveryDistanceKm: number | null;
    deliveryMinutes: number | null;
  };
  delivery: {
    id: string;
    restaurant: { name: string; addressLine1: string; city: string };
    estimatedPreparationMinutes: number;
    estimatedReadyAt: string | null;
    address: { line1?: string; city?: string; state?: string; postalCode?: string } | null;
    items: Array<{ name?: string; quantity?: number }>;
  };
}

interface ActiveDelivery {
  id: string;
  status: DeliveryStatus;
  estimatedPreparationMinutes: number;
  estimatedReadyAt: string | null;
  order: {
    id: string;
    status: string;
    currency: string;
    totalMinor: number;
    restaurant: { name: string; addressLine1: string; city: string; phone?: string | null };
    orderSnapshot: {
      address?: { line1?: string; city?: string; state?: string; postalCode?: string } | null;
      items?: Array<{ name?: string; quantity?: number }>;
    };
  };
  statusHistory: Array<{ toStatus: string; reason: string | null; createdAt: string }>;
}

interface EarningSummary {
  from: string;
  to: string;
  totals: Record<string, number>;
  availableTotals: Record<string, number>;
  earnings: Array<{
    id: string;
    earningType: string;
    amountMinor: number;
    currency: string;
    status: string;
  }>;
  payouts: Array<{
    id: string;
    amountMinor: number;
    currency: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    requestedAt: string;
    rejectionReason: string | null;
  }>;
}

interface EvidenceItem {
  id: string;
  evidenceType: 'IDENTITY' | 'VEHICLE' | 'PICKUP_PROOF' | 'DELIVERY_PROOF';
  originalFilename: string;
  sizeBytes: number;
  deliveryId: string | null;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Request failed.');
  return envelope.data as T;
}

function money(minor: number, currency = 'INR') {
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** fractionDigits);
}

function displayAddress(address: DeliveryOffer['delivery']['address']) {
  if (!address) return 'Address not available';
  return [address.line1, address.city, address.state, address.postalCode]
    .filter(Boolean)
    .join(', ');
}

export function DeliveryDashboard() {
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [offers, setOffers] = useState<DeliveryOffer[]>([]);
  const [active, setActive] = useState<ActiveDelivery | null>(null);
  const [earnings, setEarnings] = useState<EarningSummary | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deliveryCode, setDeliveryCode] = useState('');
  const [cashTip, setCashTip] = useState('0');
  const [failureReason, setFailureReason] = useState('');
  const lastLocationSentAt = useRef(0);

  async function loadProfile() {
    try {
      const result = await api<PartnerProfile>('/delivery/profile');
      setProfile(result);
      return result;
    } catch (cause) {
      setProfile(null);
      if (cause instanceof Error && !cause.message.toLowerCase().includes('profile not found')) {
        setError(
          cause.message.toLowerCase().includes('unauthorized')
            ? 'Sign in before submitting a delivery partner application.'
            : cause.message,
        );
      }
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function refreshWork(partner: PartnerProfile) {
    const prefix = `/delivery/partners/${partner.id}`;
    const [nextOffers, currentDelivery, currentEarnings] = await Promise.all([
      partner.availability === 'ONLINE'
        ? api<DeliveryOffer[]>(`${prefix}/offers`)
        : Promise.resolve([]),
      api<ActiveDelivery | null>(`${prefix}/active`),
      api<EarningSummary>(`${prefix}/earnings`),
    ]);
    setOffers(nextOffers);
    setActive(currentDelivery);
    setEarnings(currentEarnings);
  }

  async function loadEvidence(partnerId: string) {
    const result = await api<EvidenceItem[]>(`/delivery/partners/${partnerId}/evidence`);
    setEvidence(result);
  }

  useEffect(() => {
    void loadProfile().then((result) => {
      if (result)
        void Promise.all([refreshWork(result), loadEvidence(result.id)]).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not load delivery work.');
        });
    });
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .register('/delivery-sw.js', { scope: '/' })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!profile) return;
    const timer = window.setInterval(() => {
      void loadProfile().then((current) => {
        if (current) {
          void refreshWork(current).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Could not refresh delivery work.');
          });
        }
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile) return;
    const stream = new EventSource(`${apiBase}/delivery/partners/${profile.id}/events`, {
      withCredentials: true,
    });
    stream.onmessage = () => {
      void loadProfile().then((current) => {
        if (current) {
          void refreshWork(current).catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : 'Could not refresh delivery work.');
          });
        }
      });
    };
    return () => stream.close();
  }, [profile?.id]);

  useEffect(() => {
    if (!profile || !['ONLINE', 'BUSY'].includes(profile.availability) || !navigator.geolocation) {
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        if (Date.now() - lastLocationSentAt.current < 5_500) return;
        lastLocationSentAt.current = Date.now();
        void api(`/delivery/partners/${profile.id}/location`, {
          method: 'POST',
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
            ...(active ? { deliveryId: active.id } : {}),
          }),
        }).catch(() => undefined);
      },
      () =>
        setMessage(
          'Location is unavailable. Keep this page open and allow location to receive nearby offers.',
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [profile?.id, profile?.availability, active?.id]);

  async function submitOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<PartnerProfile>('/delivery/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          vehicleType: form.get('vehicleType'),
          marketRegion: form.get('marketRegion'),
        }),
      });
      setProfile(result);
      setMessage('Application submitted. You can go online after verification.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit your application.');
    } finally {
      setPending(false);
    }
  }

  async function toggleAvailability() {
    if (!profile) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const result = await api<PartnerProfile>(`/delivery/partners/${profile.id}/availability`, {
        method: 'PATCH',
        body: JSON.stringify({ isOnline: profile.availability !== 'ONLINE' }),
      });
      setProfile(result);
      await refreshWork(result);
      setMessage(
        result.availability === 'ONLINE'
          ? 'You are online for delivery offers.'
          : 'You are offline.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update availability.');
    } finally {
      setPending(false);
    }
  }

  async function respondToOffer(offerId: string, accept: boolean) {
    if (!profile) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      if (accept) {
        await api(`/delivery/partners/${profile.id}/offers/${offerId}/accept`, { method: 'POST' });
      } else {
        await api(`/delivery/partners/${profile.id}/offers/${offerId}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Unable to accept this delivery offer' }),
        });
      }
      const current = await loadProfile();
      if (current) await refreshWork(current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not respond to the offer.');
    } finally {
      setPending(false);
    }
  }

  async function deliveryAction(path: string, body?: Record<string, string | number>) {
    if (!profile) return;
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api(`/delivery/partners/${profile.id}/${path}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setDeliveryCode('');
      setCashTip('0');
      setFailureReason('');
      const current = await loadProfile();
      if (current) await refreshWork(current);
      setMessage('Delivery status updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the delivery.');
    } finally {
      setPending(false);
    }
  }

  async function uploadEvidence(
    evidenceType: EvidenceItem['evidenceType'],
    file: File,
    deliveryId?: string,
  ) {
    if (!profile) return;
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData();
    form.append('evidenceType', evidenceType);
    if (deliveryId) form.append('deliveryId', deliveryId);
    form.append('file', file);
    const path = deliveryId ? `/delivery/partners/${profile.id}/evidence` : '/delivery/documents';
    try {
      await api(path, { method: 'POST', body: form });
      await loadEvidence(profile.id);
      setMessage('Evidence uploaded securely.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not upload evidence.');
    } finally {
      setPending(false);
    }
  }

  async function downloadEvidence(item: EvidenceItem) {
    if (!profile) return;
    const path = `/delivery/partners/${profile.id}/evidence/${item.id}/content`;
    try {
      const response = await fetch(`${apiBase}${path}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Evidence could not be downloaded.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = item.originalFilename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evidence could not be downloaded.');
    }
  }

  async function requestPayout() {
    if (!profile || !earnings) return;
    const marketCurrency = payoutCurrencyByMarket[profile.marketRegion];
    if (!marketCurrency) {
      setError('Payouts are not enabled for this market yet.');
      return;
    }
    const currency = Object.keys(earnings.availableTotals)[0];
    if (currency !== marketCurrency) {
      setError(`Payouts for this market must settle in ${marketCurrency}.`);
      return;
    }
    if (!currency || earnings.availableTotals[currency] <= 0) {
      setError('There are no completed earnings available for payout.');
      return;
    }
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api(`/delivery/partners/${profile.id}/payouts`, {
        method: 'POST',
        headers: { 'idempotency-key': globalThis.crypto.randomUUID() },
        body: JSON.stringify({ from: earnings.from, to: earnings.to, currency }),
      });
      const current = await loadProfile();
      if (current) await refreshWork(current);
      setMessage('Payout request submitted for review.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request payout.');
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="delivery-page">
        <p className="delivery-loading">Loading delivery workspace…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="delivery-page">
        <header className="delivery-topbar">
          <Link className="wordmark" href="/">
            Urban Spoon
          </Link>
          <nav className="delivery-nav" aria-label="Account navigation">
            <Link href="/login">Sign in</Link>
            <Link href="/account">Account</Link>
          </nav>
        </header>
        <section className="delivery-onboarding">
          <p className="eyebrow">Delivery partner</p>
          <h1>Start delivering.</h1>
          <p className="delivery-muted">
            Create your partner profile. An administrator must verify it before you can go online.
          </p>
          <form className="delivery-form" onSubmit={submitOnboarding}>
            <label className="form-field">
              Vehicle type
              <select name="vehicleType" defaultValue="SCOOTER">
                <option value="BICYCLE">Bicycle</option>
                <option value="SCOOTER">Scooter</option>
                <option value="MOTORCYCLE">Motorcycle</option>
                <option value="CAR">Car</option>
              </select>
            </label>
            <label className="form-field">
              Courier market
              <select name="marketRegion" defaultValue="IN">
                <option value="IN">India · INR · Razorpay Route</option>
                <option value="US">United States · USD · Stripe Connect</option>
                <option value="EU">Euro area · EUR · Stripe Connect</option>
                <option value="CN">China · CNY · payouts not enabled</option>
                <option value="RU">Russia · RUB · payouts not enabled</option>
              </select>
            </label>
            <button className="button" disabled={pending} type="submit">
              {pending ? 'Submitting…' : 'Submit application'}
            </button>
          </form>
          {error && (
            <p className="form-message form-error" role="alert">
              {error}
            </p>
          )}
          <p className="delivery-footnote">
            Identity and vehicle checks are completed by the operations team. Do not submit identity
            numbers in this form.
          </p>
        </section>
      </main>
    );
  }

  const online = profile.availability === 'ONLINE';
  const busy = profile.availability === 'BUSY';
  const address = active?.order.orderSnapshot.address ?? null;
  const canPickup =
    active?.status === 'ARRIVED_AT_RESTAURANT' &&
    ['PREPARING', 'READY_FOR_PICKUP'].includes(active.order.status);

  return (
    <main className="delivery-page">
      <header className="delivery-topbar">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <nav aria-label="Partner navigation" className="delivery-nav">
          <span>Delivery partner</span>
          <Link href="/account">Account</Link>
        </nav>
      </header>

      <section className="delivery-header">
        <div>
          <p className="eyebrow">Partner workspace</p>
          <h1>Deliveries</h1>
          <p className="delivery-muted">
            {profile.vehicleType.replaceAll('_', ' ').toLowerCase()} · {profile.marketRegion} ·{' '}
            {profile.verificationStatus.toLowerCase()}
          </p>
        </div>
        <div className={`delivery-presence ${online ? 'is-online' : busy ? 'is-busy' : ''}`}>
          <span className="delivery-presence-dot" aria-hidden="true" />
          {profile.availability.toLowerCase()}
        </div>
      </section>

      {profile.verificationStatus !== 'VERIFIED' && (
        <section className="delivery-verification" aria-live="polite">
          <strong>
            {profile.verificationStatus === 'PENDING'
              ? 'Verification pending'
              : 'Application needs review'}
          </strong>
          <p>
            {profile.verificationStatus === 'PENDING'
              ? 'Operations will review your partner profile. Going online is enabled after verification.'
              : 'Your partner profile is not eligible for dispatch. Contact operations for next steps.'}
          </p>
          {profile.verificationStatus === 'PENDING' && (
            <div className="m6-evidence-upload">
              {(['IDENTITY', 'VEHICLE'] as const).map((evidenceType) => (
                <label className="form-field" key={evidenceType}>
                  {evidenceType === 'IDENTITY' ? 'Identity document' : 'Vehicle document'}
                  <input
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={pending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadEvidence(evidenceType, file);
                      event.currentTarget.value = '';
                    }}
                    type="file"
                  />
                </label>
              ))}
              {evidence
                .filter((item) => !item.deliveryId)
                .map((item) => (
                  <button
                    className="delivery-text-button"
                    key={item.id}
                    onClick={() => void downloadEvidence(item)}
                    type="button"
                  >
                    Download {item.evidenceType.toLowerCase()} · {item.originalFilename}
                  </button>
                ))}
            </div>
          )}
        </section>
      )}

      {profile.verificationStatus === 'VERIFIED' && !busy && (
        <section className="delivery-presence-control">
          <div>
            <h2>{online ? 'You are available' : 'You are offline'}</h2>
            <p className="delivery-muted">
              {online
                ? 'Nearby delivery offers will appear here.'
                : 'Go online when you are ready to receive work.'}
            </p>
          </div>
          <button
            className={`button ${online ? 'button-outline' : ''}`}
            disabled={pending}
            onClick={() => void toggleAvailability()}
            type="button"
          >
            {online ? 'Go offline' : 'Go online'}
          </button>
        </section>
      )}

      {(error || message) && (
        <p
          className={`delivery-notice ${error ? 'form-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || message}
        </p>
      )}

      <div className="delivery-layout">
        <section className="delivery-work-column">
          {active ? (
            <article className="delivery-active">
              <div className="delivery-section-heading">
                <div>
                  <p className="eyebrow">Active delivery</p>
                  <h2>{active.order.restaurant.name}</h2>
                </div>
                <span className="delivery-status">
                  {active.status.replaceAll('_', ' ').toLowerCase()}
                </span>
              </div>
              {active.estimatedReadyAt &&
                ['ASSIGNED', 'ARRIVED_AT_RESTAURANT'].includes(active.status) && (
                  <p className="delivery-muted">
                    Restaurant prep estimate: {active.estimatedPreparationMinutes} min · ready
                    around{' '}
                    {new Date(active.estimatedReadyAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              <div className="delivery-route">
                <div>
                  <span className="route-dot route-pickup" />
                  <div>
                    <small>Pickup</small>
                    <p>
                      {active.order.restaurant.addressLine1}, {active.order.restaurant.city}
                    </p>
                  </div>
                </div>
                <div>
                  <span className="route-dot route-dropoff" />
                  <div>
                    <small>Drop-off</small>
                    <p>{displayAddress(address)}</p>
                  </div>
                </div>
              </div>
              <div className="delivery-items">
                <h3>Order items</h3>
                {(active.order.orderSnapshot.items ?? []).map((item, index) => (
                  <p key={`${item.name ?? 'item'}-${index}`}>
                    <span>
                      {item.quantity ?? 1} × {item.name ?? 'Item'}
                    </span>
                  </p>
                ))}
              </div>
              <div className="delivery-actions">
                {active.status === 'PICKED_UP' && (
                  <label className="form-field m6-proof-upload">
                    Pickup proof
                    <input
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      disabled={pending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadEvidence('PICKUP_PROOF', file, active.id);
                        event.currentTarget.value = '';
                      }}
                      type="file"
                    />
                  </label>
                )}
                {active.status === 'ARRIVED' && (
                  <label className="form-field m6-proof-upload">
                    Delivery proof
                    <input
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      disabled={pending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadEvidence('DELIVERY_PROOF', file, active.id);
                        event.currentTarget.value = '';
                      }}
                      type="file"
                    />
                  </label>
                )}
                {active.status === 'ASSIGNED' && (
                  <button
                    className="button"
                    disabled={pending}
                    onClick={() => void deliveryAction('active/arrived-at-restaurant')}
                    type="button"
                  >
                    I’ve arrived at pickup
                  </button>
                )}
                {canPickup && (
                  <button
                    className="button"
                    disabled={pending}
                    onClick={() => void deliveryAction('active/pickup')}
                    type="button"
                  >
                    Confirm pickup
                  </button>
                )}
                {active.status === 'PICKED_UP' && (
                  <button
                    className="button"
                    disabled={pending}
                    onClick={() => void deliveryAction('active/arrived')}
                    type="button"
                  >
                    I’ve arrived at drop-off
                  </button>
                )}
                {['PICKED_UP', 'ARRIVED'].includes(active.status) && (
                  <form
                    className="delivery-completion"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void deliveryAction('active/complete', {
                        deliveryCode,
                        cashTipMinor: Math.round((Number(cashTip) || 0) * 100),
                      });
                    }}
                  >
                    <label className="form-field">
                      Cash tip received ({active.order.currency}, optional)
                      <input
                        inputMode="decimal"
                        max="500"
                        min="0"
                        onChange={(event) => setCashTip(event.target.value)}
                        step="0.01"
                        type="number"
                        value={cashTip}
                      />
                      <small>
                        Record only cash already handed to you. It will not be included in a payout.
                      </small>
                    </label>
                    <label className="form-field">
                      Customer delivery code
                      <input
                        inputMode="numeric"
                        maxLength={6}
                        minLength={6}
                        onChange={(event) => setDeliveryCode(event.target.value.replace(/\D/g, ''))}
                        pattern="[0-9]{6}"
                        placeholder="6-digit code"
                        required
                        value={deliveryCode}
                      />
                    </label>
                    <button
                      className="button"
                      disabled={pending || deliveryCode.length !== 6}
                      type="submit"
                    >
                      Complete delivery
                    </button>
                  </form>
                )}
                {['ASSIGNED', 'ARRIVED_AT_RESTAURANT'].includes(active.status) && (
                  <button
                    className="delivery-text-button"
                    disabled={pending}
                    onClick={() =>
                      void deliveryAction('active/release', {
                        reason: 'Partner released this assignment',
                      })
                    }
                    type="button"
                  >
                    Release assignment
                  </button>
                )}
                {['PICKED_UP', 'ARRIVED'].includes(active.status) && (
                  <form
                    className="delivery-failure"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void deliveryAction('active/fail', { reason: failureReason });
                    }}
                  >
                    <label className="form-field">
                      Report a delivery problem
                      <input
                        minLength={3}
                        onChange={(event) => setFailureReason(event.target.value)}
                        placeholder="Briefly describe the issue"
                        required
                        value={failureReason}
                      />
                    </label>
                    <button className="delivery-text-button" disabled={pending} type="submit">
                      Report failed delivery
                    </button>
                  </form>
                )}
              </div>
              <ol className="delivery-history">
                {active.statusHistory.map((entry, index) => (
                  <li key={`${entry.toStatus}-${entry.createdAt}-${index}`}>
                    <span>{entry.toStatus.replaceAll('_', ' ').toLowerCase()}</span>
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </li>
                ))}
              </ol>
              {evidence.some((item) => item.deliveryId === active.id) && (
                <div className="m6-evidence-list">
                  {evidence
                    .filter((item) => item.deliveryId === active.id)
                    .map((item) => (
                      <button
                        className="delivery-text-button"
                        key={item.id}
                        onClick={() => void downloadEvidence(item)}
                        type="button"
                      >
                        Download {item.evidenceType.toLowerCase()} · {item.originalFilename}
                      </button>
                    ))}
                </div>
              )}
            </article>
          ) : (
            <section className="delivery-empty">
              <p className="eyebrow">Current work</p>
              <h2>No active delivery</h2>
              <p className="delivery-muted">
                {online
                  ? 'Accept an offer when you are ready to begin.'
                  : 'Your active delivery will appear here.'}
              </p>
            </section>
          )}

          <section className="delivery-offers">
            <div className="delivery-section-heading">
              <div>
                <p className="eyebrow">Dispatch</p>
                <h2>Incoming offers</h2>
              </div>
              <span className="delivery-count">{offers.length}</span>
            </div>
            {offers.length ? (
              offers.map((offer) => (
                <article className="delivery-offer" key={offer.id}>
                  <div className="delivery-offer-heading">
                    <div>
                      <h3>{offer.delivery.restaurant.name}</h3>
                      <p>
                        {offer.delivery.restaurant.addressLine1}, {offer.delivery.restaurant.city}
                      </p>
                    </div>
                    <time dateTime={offer.expiresAt}>
                      Until{' '}
                      {new Date(offer.expiresAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  <p className="delivery-address">
                    Drop-off: {displayAddress(offer.delivery.address)}
                  </p>
                  <p className="delivery-muted">
                    Prep estimate: {offer.delivery.estimatedPreparationMinutes} min
                    {offer.delivery.estimatedReadyAt &&
                      ` · ready around ${new Date(offer.delivery.estimatedReadyAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                  </p>
                  <p className="delivery-item-count">
                    {offer.estimates.kind === 'ROAD_ROUTE'
                      ? 'Road-route estimate'
                      : offer.estimates.kind === 'MIXED'
                        ? 'Mixed route estimate'
                        : 'Straight-line estimate'}
                    : {offer.estimates.pickupDistanceKm ?? '—'} km to pickup ·{' '}
                    {offer.estimates.pickupMinutes ?? '—'} min pickup ETA
                  </p>
                  <p className="delivery-item-count">{offer.delivery.items.length} order line(s)</p>
                  <div className="delivery-offer-actions">
                    <button
                      className="button"
                      disabled={pending || Boolean(active)}
                      onClick={() => void respondToOffer(offer.id, true)}
                      type="button"
                    >
                      Accept offer
                    </button>
                    <button
                      className="delivery-text-button"
                      disabled={pending}
                      onClick={() => void respondToOffer(offer.id, false)}
                      type="button"
                    >
                      Decline
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p className="delivery-muted delivery-empty-inline">No offers right now.</p>
            )}
          </section>
        </section>

        <aside className="delivery-side-column">
          <section className="delivery-earnings">
            <p className="eyebrow">Last 30 days</p>
            <h2>
              {money(
                Object.values(earnings?.totals ?? {}).reduce((sum, amount) => sum + amount, 0),
              )}
            </h2>
            <p className="delivery-muted">Recorded delivery earnings</p>
            <div className="delivery-earning-list">
              {(earnings?.earnings ?? []).slice(0, 5).map((earning) => (
                <div className="delivery-earning-row" key={earning.id}>
                  <span>
                    {earning.earningType.toLowerCase()} · {earning.status.toLowerCase()}
                  </span>
                  <strong>{money(earning.amountMinor, earning.currency)}</strong>
                </div>
              ))}
              {!earnings?.earnings.length && (
                <p className="delivery-muted">No delivery earnings yet.</p>
              )}
            </div>
            <div className="delivery-payout-request">
              <div>
                <small>Available for payout</small>
                <strong>
                  {money(
                    Object.values(earnings?.availableTotals ?? {}).reduce(
                      (sum, amount) => sum + amount,
                      0,
                    ),
                  )}
                </strong>
              </div>
              <button
                className="button button-small"
                disabled={
                  pending ||
                  !payoutCurrencyByMarket[profile.marketRegion] ||
                  !Object.values(earnings?.availableTotals ?? {}).some((amount) => amount > 0)
                }
                onClick={() => void requestPayout()}
                type="button"
              >
                {payoutCurrencyByMarket[profile.marketRegion]
                  ? 'Request payout'
                  : 'Payouts unavailable'}
              </button>
            </div>
            <div className="delivery-payout-history">
              <h3>Payout requests</h3>
              {(earnings?.payouts ?? []).slice(0, 4).map((payout) => (
                <div className="delivery-earning-row" key={payout.id}>
                  <span>
                    {payout.status.toLowerCase()}
                    {payout.rejectionReason ? ` · ${payout.rejectionReason}` : ''}
                  </span>
                  <strong>{money(payout.amountMinor, payout.currency)}</strong>
                </div>
              ))}
              {!earnings?.payouts.length && (
                <p className="delivery-muted">No payout requests yet.</p>
              )}
            </div>
          </section>
          <section className="delivery-location-note">
            <h2>Location sharing</h2>
            <p>
              Your location is shared only while online. Location history is retained for 30 days;
              you go offline automatically if updates stop for 90 seconds.
            </p>
            {online && (
              <p className="delivery-location-live">
                <span className="delivery-presence-dot" /> Sharing while this page is open
              </p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
