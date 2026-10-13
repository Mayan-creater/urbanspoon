'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const tabs = [
  'Overview',
  'Reports',
  'Users',
  'Orders',
  'Payments',
  'Refunds',
  'Settlements',
  'Audit',
] as const;
type AdminTab = (typeof tabs)[number];

interface PageData<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  roles: Array<{ role: string; scopeType: string }>;
}

interface AdminOrder {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  user: { name: string; email: string };
  restaurant: { name: string };
  refunds: Array<{ status: string; amountMinor: number; currency: string }>;
}

interface PaymentAttempt {
  id: string;
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  createdAt: string;
  orderIntent: { user: { name: string }; order: { id: string; status: string } | null };
}

interface Refund {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  reason: string;
  createdAt: string;
  order: { id: string; status: string } | null;
  requestedBy: { name: string } | null;
}

interface Settlement {
  id: string;
  status: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  netAmountMinor: number;
  externalTransferReference: string | null;
  restaurant: { name: string };
  _count: { items: number; adjustments: number };
}

interface AuditRecord {
  id: string;
  actorUserId: string | null;
  permission: string;
  action: string;
  entityType: string;
  entityId: string;
  correlationId: string | null;
  createdAt: string;
}

interface DashboardData {
  range: { from: string; to: string };
  orders: {
    count: number;
    delivered: Array<{
      currency: string;
      _count: { _all: number };
      _sum: { subtotalMinor: number | null };
    }>;
  };
  payments: Array<{
    status: string;
    currency: string;
    _count: { _all: number };
    _sum: { amountMinor: number | null };
  }>;
  refunds: Array<{
    status: string;
    currency: string;
    _count: { _all: number };
    _sum: { amountMinor: number | null };
  }>;
  newUsers: number;
  newRestaurants: number;
}

interface ReportData {
  ordersByStatusAndCurrency: Array<{
    status: string;
    currency: string;
    _count: { _all: number };
    _sum: Record<string, number | null>;
  }>;
  paymentsByStatusAndCurrency: DashboardData['payments'];
  refundsByStatusAndCurrency: DashboardData['refunds'];
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
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sign in to access the admin console.');
    if (response.status === 403)
      throw new Error('Your account does not have the required admin permission.');
    throw new Error(envelope.error?.message ?? 'Request failed.');
  }
  return envelope.data as T;
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateRangeQuery(from: string, to: string) {
  return `?from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T00:00:00.000Z`)}`;
}

function money(amountMinor: number, currency: string) {
  const fractionDigits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    amountMinor / 10 ** (fractionDigits ?? 2),
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function listData<T>(payload: unknown): PageData<T> {
  return payload as PageData<T>;
}

export function AdminConsole() {
  const today = new Date();
  const utcToday = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const [from, setFrom] = useState(dateString(new Date(utcToday.getTime() - 30 * 86_400_000)));
  const [to, setTo] = useState(dateString(utcToday));
  const [activeTab, setActiveTab] = useState<AdminTab>('Overview');
  const [payload, setPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [paymentAttemptId, setPaymentAttemptId] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundRestaurantAdjustment, setRefundRestaurantAdjustment] = useState('0');
  const [refundReason, setRefundReason] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [commissionRate, setCommissionRate] = useState('');
  const [adjustmentAmounts, setAdjustmentAmounts] = useState<Record<string, string>>({});
  const [adjustmentReasons, setAdjustmentReasons] = useState<Record<string, string>>({});
  const [transferReferences, setTransferReferences] = useState<Record<string, string>>({});

  async function loadSection(section = activeTab) {
    const range = dateRangeQuery(from, to);
    let path = '/admin/dashboard' + range;
    if (section === 'Reports') path = '/admin/reports' + range;
    if (section === 'Users')
      path = `/admin/users?page=1&limit=50${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`;
    if (section === 'Orders') path = `/admin/orders${range}&page=1&limit=50`;
    if (section === 'Payments') path = `/admin/payment-attempts${range}&page=1&limit=50`;
    if (section === 'Refunds') path = `/admin/refunds${range}&page=1&limit=50`;
    if (section === 'Settlements') path = '/admin/settlements?page=1&limit=50';
    if (section === 'Audit') path = `/admin/audit-logs${range}&page=1&limit=50`;
    setPayload(await api(path));
  }

  function selectTab(tab: AdminTab) {
    setLoading(true);
    setError('');
    setPayload(null);
    setActiveTab(tab);
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    void loadSection()
      .catch((cause: unknown) => {
        if (mounted) setError(errorText(cause));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeTab, from, to]);

  async function runAction(path: string, body?: unknown, headers?: Record<string, string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(path, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers,
      });
      await loadSection();
      setNotice('Changes saved.');
      setReason('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(user: AdminUser) {
    const nextStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (reason.trim().length < 3) {
      setError('Enter a reason before changing user status.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/admin/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, reason }),
      });
      await loadSection();
      setNotice(`User status changed to ${nextStatus.toLowerCase()}.`);
      setReason('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function requestRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentAttemptId || !refundAmount || refundReason.trim().length < 3) {
      setError('Payment attempt, amount, and reason are required.');
      return;
    }
    const idempotencyKey =
      globalThis.crypto?.randomUUID?.() ?? `refund-${Date.now()}-${paymentAttemptId}`;
    setBusy(true);
    setError('');
    try {
      await api('/admin/refunds', {
        method: 'POST',
        body: JSON.stringify({
          paymentAttemptId,
          amountMinor: Number(refundAmount),
          restaurantAdjustmentMinor: Number(refundRestaurantAdjustment),
          reason: refundReason,
        }),
        headers: { 'idempotency-key': idempotencyKey },
      });
      await loadSection();
      setNotice('Refund queued for approval. No funds have been moved.');
      setPaymentAttemptId('');
      setRefundAmount('');
      setRefundRestaurantAdjustment('0');
      setRefundReason('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function generateSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restaurantId) {
      setError('Restaurant ID is required.');
      return;
    }
    await runAction('/admin/settlements/generate', {
      restaurantId,
      from: `${from}T00:00:00.000Z`,
      to: `${to}T00:00:00.000Z`,
    });
  }

  async function createCommissionRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restaurantId || !commissionRate) {
      setError('Restaurant ID and commission rate are required.');
      return;
    }
    await runAction('/admin/commission-rules', {
      ruleKey: `restaurant-${restaurantId.slice(0, 8)}`,
      restaurantId,
      rateBps: Math.round(Number(commissionRate) * 100),
      effectiveFrom: new Date().toISOString(),
    });
  }

  async function exportReport() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${apiBase}/admin/reports/export${dateRangeQuery(from, to)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Sign in to access the admin console.');
        if (response.status === 403) {
          throw new Error('Your account does not have the required admin permission.');
        }
        throw new Error('Could not export this report.');
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'urban-spoon-report.csv';
      link.click();
      URL.revokeObjectURL(objectUrl);
      setNotice('Report exported.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="m8-page">
      <header className="m8-topbar">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <nav aria-label="Admin workspaces">
          <Link href="/admin/promotions">Promotions</Link>
          <Link href="/admin/memberships">FoodPass plans</Link>
          <Link href="/admin/delivery">Delivery</Link>
          <Link href="/admin/reviews-support">Reviews &amp; support</Link>
          <Link href="/account">Account</Link>
        </nav>
      </header>

      <header className="m8-heading">
        <div>
          <p className="eyebrow">Platform operations</p>
          <h1>Admin console</h1>
        </div>
        <div className="m8-date-range">
          <label>
            From (UTC)
            <input onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
          </label>
          <label>
            Before (UTC)
            <input onChange={(event) => setTo(event.target.value)} type="date" value={to} />
          </label>
        </div>
      </header>

      <nav aria-label="Admin sections" className="m8-tabs" role="group">
        {tabs.map((tab) => (
          <button
            aria-pressed={activeTab === tab}
            className={activeTab === tab ? 'm8-tab is-active' : 'm8-tab'}
            key={tab}
            onClick={() => selectTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </nav>

      {(error || notice) && (
        <p className={error ? 'm8-notice is-error' : 'm8-notice'} role={error ? 'alert' : 'status'}>
          {error || notice}
          {error === 'Sign in to access the admin console.' ? (
            <>
              {' '}
              <Link href="/login">Sign in</Link>
            </>
          ) : null}
        </p>
      )}

      {loading ? <p className="m8-loading">Loading {activeTab.toLowerCase()}…</p> : null}

      {!loading && activeTab === 'Overview' && payload ? (
        <Overview data={payload as DashboardData} />
      ) : null}

      {!loading && activeTab === 'Reports' && payload ? (
        <Reports data={payload as ReportData} busy={busy} onExport={() => void exportReport()} />
      ) : null}

      {!loading && activeTab === 'Users' && payload ? (
        <section className="m8-section" aria-labelledby="users-heading">
          <div className="m8-section-heading">
            <div>
              <p className="eyebrow">Identity</p>
              <h2 id="users-heading">Users</h2>
            </div>
            <form
              className="m8-inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                void loadSection().catch((cause: unknown) => setError(errorText(cause)));
              }}
            >
              <input
                aria-label="Search users"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name or email"
                value={search}
              />
              <button className="button button-small" type="submit">
                Search
              </button>
            </form>
          </div>
          <label className="m8-reason-field">
            Status change reason
            <input onChange={(event) => setReason(event.target.value)} value={reason} />
          </label>
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role assignments</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {listData<AdminUser>(payload).items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </td>
                    <td>
                      {user.roles.map((role) => `${role.role} · ${role.scopeType}`).join(', ') ||
                        'Customer'}
                    </td>
                    <td>
                      <span className="m8-status">{user.status}</span>
                    </td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="m8-action"
                        disabled={busy}
                        onClick={() => void updateUser(user)}
                        type="button"
                      >
                        {user.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m8-result-count">{listData<AdminUser>(payload).total} users</p>
        </section>
      ) : null}

      {!loading && activeTab === 'Orders' && payload ? (
        <section className="m8-section" aria-labelledby="orders-heading">
          <div className="m8-section-heading">
            <div>
              <p className="eyebrow">Marketplace</p>
              <h2 id="orders-heading">Orders</h2>
            </div>
          </div>
          <label className="m8-reason-field">
            Cancellation reason
            <input onChange={(event) => setReason(event.target.value)} value={reason} />
          </label>
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Restaurant</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {listData<AdminOrder>(payload).items.map((order) => (
                  <tr key={order.id}>
                    <td className="m8-id">{order.id}</td>
                    <td>
                      {order.user.name}
                      <small>{order.user.email}</small>
                    </td>
                    <td>{order.restaurant.name}</td>
                    <td>{money(order.totalMinor, order.currency)}</td>
                    <td>
                      <span className="m8-status">{order.status}</span>
                    </td>
                    <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                    <td>
                      {[
                        'CONFIRMED',
                        'RESTAURANT_ACCEPTED',
                        'PREPARING',
                        'READY_FOR_PICKUP',
                      ].includes(order.status) ? (
                        <button
                          className="m8-action is-danger"
                          disabled={busy}
                          onClick={() =>
                            void runAction(`/admin/orders/${order.id}/cancel`, { reason })
                          }
                          type="button"
                        >
                          Cancel
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m8-result-count">{listData<AdminOrder>(payload).total} orders</p>
        </section>
      ) : null}

      {!loading && activeTab === 'Payments' && payload ? (
        <section className="m8-section" aria-labelledby="payments-heading">
          <div className="m8-section-heading">
            <div>
              <p className="eyebrow">Finance</p>
              <h2 id="payments-heading">Payment attempts</h2>
            </div>
          </div>
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Attempt</th>
                  <th>Customer</th>
                  <th>Provider</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Failure</th>
                  <th>Refund</th>
                </tr>
              </thead>
              <tbody>
                {listData<PaymentAttempt>(payload).items.map((attempt) => (
                  <tr key={attempt.id}>
                    <td className="m8-id">{attempt.id}</td>
                    <td>{attempt.orderIntent.user.name}</td>
                    <td>{attempt.provider}</td>
                    <td>{money(attempt.amountMinor, attempt.currency)}</td>
                    <td>
                      <span className="m8-status">{attempt.status}</span>
                    </td>
                    <td>{attempt.failureCode ?? '—'}</td>
                    <td>
                      {attempt.status === 'SUCCEEDED' ? (
                        <button
                          className="m8-action"
                          onClick={() => {
                            setPaymentAttemptId(attempt.id);
                            setActiveTab('Refunds');
                          }}
                          type="button"
                        >
                          Request refund
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m8-sandbox-note">
            Payment records are operational snapshots. No provider transfer is initiated from this
            screen.
          </p>
        </section>
      ) : null}

      {!loading && activeTab === 'Refunds' && payload ? (
        <section className="m8-section" aria-labelledby="refunds-heading">
          <div className="m8-section-heading">
            <div>
              <p className="eyebrow">Finance</p>
              <h2 id="refunds-heading">Refund queue</h2>
            </div>
          </div>
          <form className="m8-refund-form" onSubmit={(event) => void requestRefund(event)}>
            <label>
              Payment attempt ID
              <input
                onChange={(event) => setPaymentAttemptId(event.target.value)}
                value={paymentAttemptId}
              />
            </label>
            <label>
              Amount (minor units)
              <input
                min="1"
                onChange={(event) => setRefundAmount(event.target.value)}
                type="number"
                value={refundAmount}
              />
            </label>
            <label>
              Restaurant adjustment (minor units)
              <input
                min="0"
                onChange={(event) => setRefundRestaurantAdjustment(event.target.value)}
                type="number"
                value={refundRestaurantAdjustment}
              />
            </label>
            <label>
              Reason
              <input
                onChange={(event) => setRefundReason(event.target.value)}
                value={refundReason}
              />
            </label>
            <button className="button button-small" disabled={busy} type="submit">
              Request
            </button>
          </form>
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Refund</th>
                  <th>Order</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Requested by</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {listData<Refund>(payload).items.map((refund) => (
                  <tr key={refund.id}>
                    <td className="m8-id">{refund.id}</td>
                    <td className="m8-id">{refund.order?.id ?? 'Unlinked'}</td>
                    <td>{money(refund.amountMinor, refund.currency)}</td>
                    <td>{refund.reason}</td>
                    <td>
                      <span className="m8-status">{refund.status}</span>
                    </td>
                    <td>{refund.requestedBy?.name ?? 'System'}</td>
                    <td className="m8-row-actions">
                      {refund.status === 'REQUESTED' ? (
                        <>
                          <button
                            className="m8-action"
                            disabled={busy}
                            onClick={() => void runAction(`/admin/refunds/${refund.id}/approve`)}
                            type="button"
                          >
                            Approve
                          </button>
                          <button
                            className="m8-action is-danger"
                            disabled={busy}
                            onClick={() =>
                              void runAction(`/admin/refunds/${refund.id}/reject`, {
                                reason: reason || 'Rejected after review',
                              })
                            }
                            type="button"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {refund.status === 'FAILED' ? (
                        <button
                          className="m8-action"
                          disabled={busy}
                          onClick={() => void runAction(`/admin/refunds/${refund.id}/retry`)}
                          type="button"
                        >
                          Retry
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m8-sandbox-note">
            Approving or retrying queues the refund state only. External payment processing is not
            connected.
          </p>
        </section>
      ) : null}

      {!loading && activeTab === 'Settlements' && payload ? (
        <section className="m8-section" aria-labelledby="settlements-heading">
          <div className="m8-section-heading">
            <div>
              <p className="eyebrow">Finance</p>
              <h2 id="settlements-heading">Restaurant settlements</h2>
            </div>
          </div>
          <div className="m8-settlement-tools">
            <form className="m8-tool-form" onSubmit={(event) => void generateSettlement(event)}>
              <h3>Generate settlement</h3>
              <label>
                Restaurant ID
                <input
                  onChange={(event) => setRestaurantId(event.target.value)}
                  value={restaurantId}
                />
              </label>
              <button className="button button-small" disabled={busy} type="submit">
                Generate period
              </button>
            </form>
            <form className="m8-tool-form" onSubmit={(event) => void createCommissionRule(event)}>
              <h3>Version commission rule</h3>
              <label>
                Rate (%)
                <input
                  min="0"
                  max="100"
                  onChange={(event) => setCommissionRate(event.target.value)}
                  step="0.01"
                  type="number"
                  value={commissionRate}
                />
              </label>
              <button className="button button-small" disabled={busy} type="submit">
                Save rate
              </button>
            </form>
          </div>
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Restaurant</th>
                  <th>Period</th>
                  <th>Orders</th>
                  <th>Net</th>
                  <th>Status</th>
                  <th>Transfer reference</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {listData<Settlement>(payload).items.map((settlement) => (
                  <tr key={settlement.id}>
                    <td>{settlement.restaurant.name}</td>
                    <td>
                      {new Date(settlement.periodStart).toLocaleDateString()} –{' '}
                      {new Date(settlement.periodEnd).toLocaleDateString()}
                    </td>
                    <td>{settlement._count.items}</td>
                    <td>{money(settlement.netAmountMinor, settlement.currency)}</td>
                    <td>
                      <span className="m8-status">{settlement.status}</span>
                    </td>
                    <td>{settlement.externalTransferReference ?? '—'}</td>
                    <td className="m8-row-actions">
                      {settlement.status === 'DRAFT' ? (
                        <button
                          className="m8-action"
                          disabled={busy}
                          onClick={() =>
                            void runAction(`/admin/settlements/${settlement.id}/approve`)
                          }
                          type="button"
                        >
                          Approve
                        </button>
                      ) : null}
                      {settlement.status === 'DRAFT' ? (
                        <>
                          <input
                            aria-label="Settlement adjustment in minor units"
                            onChange={(event) =>
                              setAdjustmentAmounts((current) => ({
                                ...current,
                                [settlement.id]: event.target.value,
                              }))
                            }
                            placeholder="Adjustment"
                            type="number"
                            value={adjustmentAmounts[settlement.id] ?? ''}
                          />
                          <input
                            aria-label="Settlement adjustment reason"
                            onChange={(event) =>
                              setAdjustmentReasons((current) => ({
                                ...current,
                                [settlement.id]: event.target.value,
                              }))
                            }
                            placeholder="Reason"
                            value={adjustmentReasons[settlement.id] ?? ''}
                          />
                          <button
                            className="m8-action"
                            disabled={busy}
                            onClick={() =>
                              void runAction(`/admin/settlements/${settlement.id}/adjustments`, {
                                amountMinor: Number(adjustmentAmounts[settlement.id]),
                                reason: adjustmentReasons[settlement.id] ?? reason,
                              })
                            }
                            type="button"
                          >
                            Adjust
                          </button>
                        </>
                      ) : null}
                      {settlement.status === 'APPROVED' ? (
                        <>
                          <input
                            aria-label="External transfer reference"
                            onChange={(event) =>
                              setTransferReferences((current) => ({
                                ...current,
                                [settlement.id]: event.target.value,
                              }))
                            }
                            placeholder="Reference"
                            value={transferReferences[settlement.id] ?? ''}
                          />
                          <button
                            className="m8-action"
                            disabled={busy}
                            onClick={() =>
                              void runAction(`/admin/settlements/${settlement.id}/mark-paid`, {
                                externalTransferReference: transferReferences[settlement.id],
                              })
                            }
                            type="button"
                          >
                            Reconcile
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m8-sandbox-note">
            Settlement approval records authorization. Reconcile only after an external transfer;
            Urban Spoon does not move funds.
          </p>
        </section>
      ) : null}

      {!loading && activeTab === 'Audit' && payload ? (
        <section className="m8-section" aria-labelledby="audit-heading">
          <div className="m8-section-heading">
            <div>
              <p className="eyebrow">Controls</p>
              <h2 id="audit-heading">Audit log</h2>
            </div>
          </div>
          <div className="m8-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Permission</th>
                  <th>Target</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {listData<AuditRecord>(payload).items.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.createdAt).toLocaleString()}</td>
                    <td className="m8-id">{record.actorUserId ?? 'System'}</td>
                    <td>{record.action}</td>
                    <td>{record.permission}</td>
                    <td>
                      {record.entityType} · <span className="m8-id">{record.entityId}</span>
                    </td>
                    <td className="m8-id">{record.correlationId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m8-sandbox-note">
            Viewing audit records itself is recorded as an audit event.
          </p>
        </section>
      ) : null}
    </main>
  );
}

function Overview({ data }: { data: DashboardData }) {
  return (
    <>
      <section aria-label="Platform totals" className="m8-metrics">
        <article>
          <span>Orders</span>
          <strong>{data.orders.count}</strong>
          <small>Created in period</small>
        </article>
        <article>
          <span>New users</span>
          <strong>{data.newUsers}</strong>
          <small>Created in period</small>
        </article>
        <article>
          <span>New restaurants</span>
          <strong>{data.newRestaurants}</strong>
          <small>Created in period</small>
        </article>
        <article>
          <span>Delivered item GMV</span>
          <strong>{data.orders.delivered.length ? 'By currency' : '—'}</strong>
          <small>Item subtotal; currencies stay separate</small>
        </article>
      </section>
      <section className="m8-section" aria-labelledby="delivered-heading">
        <div className="m8-section-heading">
          <div>
            <p className="eyebrow">Order outcomes</p>
            <h2 id="delivered-heading">Delivered orders</h2>
          </div>
        </div>
        <div className="m8-breakdown">
          {data.orders.delivered.length ? (
            data.orders.delivered.map((row) => (
              <article key={row.currency}>
                <strong>{row._count._all} orders</strong>
                <span>{money(row._sum.subtotalMinor ?? 0, row.currency)}</span>
                <small>{row.currency} item subtotal</small>
              </article>
            ))
          ) : (
            <p>No deliveries in this period.</p>
          )}
        </div>
      </section>
      <section className="m8-section" aria-labelledby="payment-summary-heading">
        <div className="m8-section-heading">
          <div>
            <p className="eyebrow">Reconciliation</p>
            <h2 id="payment-summary-heading">Payments and refunds</h2>
          </div>
        </div>
        <div className="m8-two-columns">
          <Breakdown title="Payment attempts" rows={data.payments} />
          <Breakdown title="Refunds" rows={data.refunds} />
        </div>
      </section>
    </>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    status: string;
    currency: string;
    _count: { _all: number };
    _sum: { amountMinor: number | null };
  }>;
}) {
  return (
    <div className="m8-breakdown-table">
      <h3>{title}</h3>
      {rows.length ? (
        rows.map((row) => (
          <p key={`${row.status}-${row.currency}`}>
            <span>
              {row.status} · {row.currency}
            </span>
            <strong>
              {row._count._all} · {money(row._sum.amountMinor ?? 0, row.currency)}
            </strong>
          </p>
        ))
      ) : (
        <p>No records in this period.</p>
      )}
    </div>
  );
}

function Reports({
  data,
  busy,
  onExport,
}: {
  data: ReportData;
  busy: boolean;
  onExport: () => void;
}) {
  return (
    <section className="m8-section" aria-labelledby="reports-heading">
      <div className="m8-section-heading">
        <div>
          <p className="eyebrow">Business reporting</p>
          <h2 id="reports-heading">Financial and order totals</h2>
        </div>
        <button className="button button-small" disabled={busy} onClick={onExport} type="button">
          Export CSV
        </button>
      </div>
      <div className="m8-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order status</th>
              <th>Currency</th>
              <th>Count</th>
              <th>Item subtotal</th>
              <th>Discount</th>
              <th>Fees</th>
              <th>Tax</th>
              <th>Tips</th>
              <th>Order total</th>
            </tr>
          </thead>
          <tbody>
            {data.ordersByStatusAndCurrency.map((row) => (
              <tr key={`${row.status}-${row.currency}`}>
                <td>{row.status}</td>
                <td>{row.currency}</td>
                <td>{row._count._all}</td>
                <td>{money(row._sum.subtotalMinor ?? 0, row.currency)}</td>
                <td>{money(row._sum.discountMinor ?? 0, row.currency)}</td>
                <td>{money(row._sum.feesMinor ?? 0, row.currency)}</td>
                <td>{money(row._sum.taxMinor ?? 0, row.currency)}</td>
                <td>{money(row._sum.tipMinor ?? 0, row.currency)}</td>
                <td>{money(row._sum.totalMinor ?? 0, row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="m8-two-columns">
        <Breakdown title="Payments by status" rows={data.paymentsByStatusAndCurrency} />
        <Breakdown title="Refunds by status" rows={data.refundsByStatusAndCurrency} />
      </div>
    </section>
  );
}
