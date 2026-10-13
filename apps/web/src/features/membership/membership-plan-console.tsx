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
  isActive: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
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

export function MembershipPlanConsole() {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function loadPlans() {
    setLoading(true);
    setError('');
    try {
      setPlans(await api<MembershipPlan[]>('/admin/memberships/plans'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load membership plans.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlans();
  }, []);

  async function createPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api<MembershipPlan>('/admin/memberships/plans', {
        method: 'POST',
        body: JSON.stringify({
          key: values.get('key'),
          name: values.get('name'),
          description: values.get('description'),
          priceMinor: Number(values.get('priceMinor')),
          currency: values.get('currency'),
          interval: values.get('interval'),
          benefits: String(values.get('benefits'))
            .split(',')
            .map((benefit) => benefit.trim())
            .filter(Boolean),
          effectiveFrom: new Date(String(values.get('effectiveFrom'))).toISOString(),
          effectiveUntil: values.get('effectiveUntil')
            ? new Date(String(values.get('effectiveUntil'))).toISOString()
            : undefined,
        }),
      });
      form.reset();
      await loadPlans();
      setNotice('Membership plan version created. Activation remains payment-gated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create membership plan.');
    } finally {
      setPending(false);
    }
  }

  async function disablePlan(plan: MembershipPlan) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api(`/admin/memberships/plans/${plan.id}/disable`, { method: 'POST' });
      await loadPlans();
      setNotice(`${plan.name} v${plan.version} disabled.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to disable membership plan.');
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
          <Link href="/admin/promotions">Promotions</Link>
          <Link href="/membership">FoodPass</Link>
        </nav>
      </header>
      <header className="m8-heading">
        <div>
          <p className="eyebrow">M9 · Membership controls</p>
          <h1>FoodPass plans</h1>
        </div>
      </header>
      {(error || notice) && (
        <p className={error ? 'm8-notice is-error' : 'm8-notice'} role={error ? 'alert' : 'status'}>
          {error || notice}
        </p>
      )}
      <section className="m8-section" aria-labelledby="plan-create-heading">
        <div className="m8-section-heading">
          <div>
            <p className="eyebrow">Effective-dated catalog</p>
            <h2 id="plan-create-heading">Create plan version</h2>
          </div>
        </div>
        <form className="m8-campaign-form" onSubmit={(event) => void createPlan(event)}>
          <label>
            Plan key
            <input name="key" pattern="[a-z0-9][a-z0-9_-]{2,63}" required />
          </label>
          <label>
            Plan name
            <input name="name" maxLength={80} required />
          </label>
          <label>
            Description
            <input name="description" maxLength={300} required />
          </label>
          <label>
            Price (minor units)
            <input name="priceMinor" type="number" min="1" required />
          </label>
          <label>
            Currency
            <input name="currency" defaultValue="INR" pattern="[A-Z]{3}" required />
          </label>
          <label>
            Billing interval
            <select name="interval" defaultValue="MONTHLY">
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </label>
          <label>
            Benefits (comma-separated)
            <input name="benefits" required />
          </label>
          <label>
            Effective from
            <input name="effectiveFrom" type="datetime-local" required />
          </label>
          <label>
            Effective until (optional)
            <input name="effectiveUntil" type="datetime-local" />
          </label>
          <button className="button button-small" disabled={pending} type="submit">
            Create plan version
          </button>
        </form>
        <p className="m8-sandbox-note">
          Payment activation is disabled until a production provider is configured. Creating a plan
          does not activate membership benefits.
        </p>
      </section>
      <section className="m8-section" aria-labelledby="plan-list-heading">
        <div className="m8-section-heading">
          <div>
            <p className="eyebrow">Plan history</p>
            <h2 id="plan-list-heading">Configured plans</h2>
          </div>
        </div>
        {loading ? (
          <p className="m8-loading" role="status">Loading plans…</p>
        ) : plans.length ? (
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Benefits</th>
                  <th>Effective</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>
                      <strong>{plan.name} v{plan.version}</strong>
                      <small>{plan.key} · {plan.interval}</small>
                    </td>
                    <td>{plan.priceMinor} {plan.currency} minor units</td>
                    <td>{plan.benefits.join(', ')}</td>
                    <td>
                      {new Date(plan.effectiveFrom).toLocaleDateString()} –{' '}
                      {plan.effectiveUntil ? new Date(plan.effectiveUntil).toLocaleDateString() : 'Open'}
                    </td>
                    <td><span className="m8-status">{plan.isActive ? 'ACTIVE' : 'DISABLED'}</span></td>
                    <td>
                      {plan.isActive ? (
                        <button
                          className="m8-action is-danger"
                          disabled={pending}
                          onClick={() => void disablePlan(plan)}
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
          <p className="m8-loading">No membership plans configured.</p>
        )}
      </section>
    </main>
  );
}