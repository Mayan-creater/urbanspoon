'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface Campaign {
  id: string;
  campaignKey: string;
  campaignName: string;
  version: number;
  code: string;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: number;
  currency: string;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  restaurant: { id: string; name: string } | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
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

export function PromotionCampaignConsole() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function loadCampaigns() {
    setLoading(true);
    setError('');
    try {
      setCampaigns(await api<Campaign[]>('/admin/coupons'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load campaigns.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCampaigns();
  }, []);

  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api<Campaign>('/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          campaignKey: values.get('campaignKey'),
          campaignName: values.get('campaignName'),
          code: values.get('code'),
          discountType: values.get('discountType'),
          discountValue: Number(values.get('discountValue')),
          currency: values.get('currency'),
          minSubtotalMinor: Number(values.get('minSubtotalMinor') || 0),
          maxDiscountMinor: values.get('maxDiscountMinor')
            ? Number(values.get('maxDiscountMinor'))
            : undefined,
          usageLimit: values.get('usageLimit') ? Number(values.get('usageLimit')) : undefined,
          perUserLimit: values.get('perUserLimit')
            ? Number(values.get('perUserLimit'))
            : undefined,
          firstOrderOnly: values.get('firstOrderOnly') === 'on',
          restaurantId: values.get('restaurantId') || undefined,
          startsAt: new Date(String(values.get('startsAt'))).toISOString(),
          endsAt: new Date(String(values.get('endsAt'))).toISOString(),
        }),
      });
      form.reset();
      await loadCampaigns();
      setNotice('Campaign version created. Coupon and FoodCoins cannot stack.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create campaign.');
    } finally {
      setPending(false);
    }
  }

  async function disableCampaign(campaign: Campaign) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/coupons/${campaign.id}/disable`, { method: 'POST' });
      await loadCampaigns();
      setNotice(`${campaign.campaignName} v${campaign.version} disabled.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to disable campaign.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="m8-page">
      <header className="m8-topbar">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <nav aria-label="Admin workspaces">
          <Link href="/admin">Admin console</Link>
          <Link href="/admin/memberships">FoodPass plans</Link>
          <Link href="/admin/delivery">Delivery</Link>
          <Link href="/admin/reviews-support">Reviews &amp; support</Link>
        </nav>
      </header>
      <header className="m8-heading">
        <div>
          <p className="eyebrow">M9 · Promotion controls</p>
          <h1>Campaigns</h1>
        </div>
      </header>

      {(error || notice) && (
        <p className={error ? 'm8-notice is-error' : 'm8-notice'} role={error ? 'alert' : 'status'}>
          {error || notice}
        </p>
      )}

      <section className="m8-section" aria-labelledby="campaign-create-heading">
        <div className="m8-section-heading">
          <div>
            <p className="eyebrow">Versioned rules</p>
            <h2 id="campaign-create-heading">Create campaign version</h2>
          </div>
        </div>
        <form className="m8-campaign-form" onSubmit={(event) => void createCampaign(event)}>
          <label>
            Campaign key
            <input name="campaignKey" pattern="[a-z0-9][a-z0-9_-]{2,63}" required />
          </label>
          <label>
            Campaign name
            <input name="campaignName" maxLength={100} required />
          </label>
          <label>
            Coupon code
            <input name="code" pattern="[A-Za-z0-9_-]{3,40}" required />
          </label>
          <label>
            Discount type
            <select name="discountType" defaultValue="PERCENTAGE">
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED">Fixed amount</option>
            </select>
          </label>
          <label>
            Discount value
            <input name="discountValue" type="number" min="1" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="INR" pattern="[A-Z]{3}" required />
          </label>
          <label>
            Minimum item subtotal (minor units)
            <input name="minSubtotalMinor" type="number" min="0" defaultValue="0" />
          </label>
          <label>
            Maximum discount (minor units)
            <input name="maxDiscountMinor" type="number" min="1" />
          </label>
          <label>
            Total uses
            <input name="usageLimit" type="number" min="1" />
          </label>
          <label>
            Uses per customer
            <input name="perUserLimit" type="number" min="1" />
          </label>
          <label>
            Restaurant ID (optional)
            <input name="restaurantId" />
          </label>
          <label>
            Starts at
            <input name="startsAt" type="datetime-local" required />
          </label>
          <label>
            Ends at
            <input name="endsAt" type="datetime-local" required />
          </label>
          <label className="m8-campaign-checkbox">
            <input name="firstOrderOnly" type="checkbox" />
            First order only
          </label>
          <button className="button button-small" disabled={pending} type="submit">
            Create version
          </button>
        </form>
        <p className="m8-sandbox-note">
          Campaigns are immutable after creation. Creating a version closes overlapping active
          versions; coupon codes and FoodCoins never stack.
        </p>
      </section>

      <section className="m8-section" aria-labelledby="campaign-list-heading">
        <div className="m8-section-heading">
          <div>
            <p className="eyebrow">Availability and usage</p>
            <h2 id="campaign-list-heading">Campaign versions</h2>
          </div>
        </div>
        {loading ? (
          <p className="m8-loading" role="status">
            Loading campaigns…
          </p>
        ) : campaigns.length ? (
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Offer</th>
                  <th>Scope</th>
                  <th>Usage</th>
                  <th>Eligibility</th>
                  <th>Dates</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <strong>{campaign.campaignName} v{campaign.version}</strong>
                      <small>{campaign.campaignKey} · {campaign.code}</small>
                    </td>
                    <td>
                      {campaign.discountType === 'PERCENTAGE'
                        ? `${campaign.discountValue / 100}%`
                        : `${campaign.discountValue} ${campaign.currency} minor units`}
                    </td>
                    <td>{campaign.restaurant?.name ?? `Platform · ${campaign.currency}`}</td>
                    <td>
                      {campaign.usageCount}
                      {campaign.usageLimit === null ? '' : ` / ${campaign.usageLimit}`}
                      <small>{campaign.perUserLimit ?? 'Unlimited'} per customer</small>
                    </td>
                    <td>{campaign.firstOrderOnly ? 'First order' : 'All customers'}</td>
                    <td>
                      {new Date(campaign.startsAt).toLocaleDateString()} –{' '}
                      {new Date(campaign.endsAt).toLocaleDateString()}
                    </td>
                    <td><span className="m8-status">{campaign.isActive ? 'ACTIVE' : 'DISABLED'}</span></td>
                    <td>
                      {campaign.isActive ? (
                        <button
                          className="m8-action is-danger"
                          disabled={pending}
                          onClick={() => void disableCampaign(campaign)}
                          type="button"
                        >
                          Disable
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m8-loading">No campaigns configured.</p>
        )}
      </section>
    </main>
  );
}