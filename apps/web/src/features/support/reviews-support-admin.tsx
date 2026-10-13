'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface ReviewReport {
  id: string;
  reason: string;
  createdAt: string;
}

interface ModerationReview {
  id: string;
  orderId: string;
  rating: number;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  restaurant: { id: string; name: string };
  reports: ReviewReport[];
}

interface SupportQueueItem {
  id: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  assignedToUserId: string | null;
  createdAt: string;
  orderId: string | null;
}

interface AgentCase extends SupportQueueItem {
  user: { id: string; name: string; email: string };
  customerOutcome: string | null;
  resolutionSummary: string | null;
  order: {
    id: string;
    status: string;
    totalMinor: number;
    currency: string;
    createdAt: string;
  } | null;
  messages: Array<{
    id: string;
    body: string;
    isInternal: boolean;
    createdAt: string;
    author: { id: string; name: string };
  }>;
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

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function money(minor: number, currency: string) {
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** fractionDigits);
}

export function ReviewsSupportAdmin() {
  const [reviews, setReviews] = useState<ModerationReview[]>([]);
  const [reviewStatus, setReviewStatus] = useState('PENDING');
  const [queue, setQueue] = useState<SupportQueueItem[]>([]);
  const [activeCase, setActiveCase] = useState<AgentCase | null>(null);
  const [moderationReasons, setModerationReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const [nextReviews, nextQueue] = await Promise.all([
      api<ModerationReview[]>(`/admin/reviews?status=${reviewStatus}`),
      api<SupportQueueItem[]>('/support/agent/cases'),
    ]);
    setReviews(nextReviews);
    setQueue(nextQueue);
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');
    void load()
      .catch((cause: unknown) => {
        if (mounted) setError(errorText(cause));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reviewStatus]);

  async function moderate(review: ModerationReview, action: 'PUBLISH' | 'HIDE' | 'REJECT') {
    const reason = moderationReasons[review.id]?.trim() ?? '';
    if (action !== 'PUBLISH' && reason.length < 3) {
      setError('Enter a moderation reason before hiding or rejecting a review.');
      return;
    }
    setBusyId(review.id);
    setError('');
    setNotice('');
    try {
      await api(`/admin/reviews/${review.id}/moderation`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      await load();
      setNotice(`Review ${action.toLowerCase()}d.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId('');
    }
  }

  async function openCase(item: SupportQueueItem) {
    setError('');
    if (!item.assignedToUserId) {
      setActiveCase(null);
      setNotice('Claim this case before opening customer details.');
      return;
    }
    setBusyId(item.id);
    try {
      setActiveCase(await api<AgentCase>(`/support/agent/cases/${item.id}`));
      setNotice('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId('');
    }
  }

  async function claimCase(item: SupportQueueItem) {
    setBusyId(item.id);
    setError('');
    setNotice('');
    try {
      setActiveCase(
        await api<AgentCase>(`/support/agent/cases/${item.id}/claim`, { method: 'POST' }),
      );
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId('');
    }
  }

  async function sendAgentMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusyId(activeCase.id);
    setError('');
    try {
      setActiveCase(
        await api<AgentCase>(`/support/agent/cases/${activeCase.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            body: form.get('body'),
            isInternal: form.get('isInternal') === 'on',
          }),
        }),
      );
      formElement.reset();
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId('');
    }
  }

  async function resolveCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCase) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusyId(activeCase.id);
    setError('');
    try {
      const resolved = await api<AgentCase>(`/support/agent/cases/${activeCase.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          resolutionSummary: form.get('resolutionSummary'),
          customerOutcome: form.get('customerOutcome'),
        }),
      });
      setActiveCase(resolved);
      await load();
      setNotice('Case resolved and the customer outcome was sent.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="support-page support-admin-page">
      <nav className="support-topbar" aria-label="Support operations navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <Link href="/account">Account</Link>
      </nav>
      <header className="support-header">
        <p className="eyebrow">Operations</p>
        <h1>Reviews & support</h1>
        <p>Moderate reported content and work only cases assigned to you.</p>
      </header>
      {(error || notice) && (
        <p
          className={`support-notice ${error ? 'form-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
        </p>
      )}
      {loading ? (
        <p className="support-muted">Loading operations…</p>
      ) : (
        <div className="support-admin-layout">
          <section className="support-section" aria-labelledby="moderation-heading">
            <div className="support-section-heading">
              <div>
                <p className="eyebrow">Customer feedback</p>
                <h2 id="moderation-heading">Review moderation</h2>
              </div>
              <label className="support-filter">
                Queue
                <select
                  onChange={(event) => setReviewStatus(event.target.value)}
                  value={reviewStatus}
                >
                  <option value="PENDING">Pending</option>
                  <option value="REPORTED">Reported</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="HIDDEN">Hidden</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </label>
            </div>
            {reviews.length ? (
              <div className="support-review-list">
                {reviews.map((review) => (
                  <article className="support-item" key={review.id}>
                    <div className="support-item-heading">
                      <div>
                        <h3>
                          {review.restaurant.name} · {review.rating}/5
                        </h3>
                        <p>
                          {review.user.name} · {review.user.email}
                        </p>
                      </div>
                      <span className="support-status">{review.status.toLowerCase()}</span>
                    </div>
                    <h4>{review.title}</h4>
                    <p className="support-review-body">{review.body}</p>
                    {review.reports.length > 0 && (
                      <div className="support-report-list">
                        <strong>{review.reports.length} open report(s)</strong>
                        {review.reports.map((report) => (
                          <p key={report.id}>{report.reason}</p>
                        ))}
                      </div>
                    )}
                    <label className="form-field">
                      Moderation reason
                      <input
                        maxLength={500}
                        onChange={(event) =>
                          setModerationReasons((current) => ({
                            ...current,
                            [review.id]: event.target.value,
                          }))
                        }
                        value={moderationReasons[review.id] ?? ''}
                      />
                    </label>
                    <div className="support-actions">
                      {['PENDING', 'HIDDEN'].includes(review.status) && (
                        <button
                          className="button"
                          disabled={Boolean(busyId)}
                          onClick={() => void moderate(review, 'PUBLISH')}
                          type="button"
                        >
                          Publish
                        </button>
                      )}
                      {['PENDING', 'PUBLISHED'].includes(review.status) && (
                        <button
                          className="secondary-button"
                          disabled={Boolean(busyId)}
                          onClick={() => void moderate(review, 'HIDE')}
                          type="button"
                        >
                          Hide
                        </button>
                      )}
                      {review.status === 'PENDING' && (
                        <button
                          className="support-text-button"
                          disabled={Boolean(busyId)}
                          onClick={() => void moderate(review, 'REJECT')}
                          type="button"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="support-muted">No reviews in this queue.</p>
            )}
          </section>

          <section className="support-section" aria-labelledby="cases-heading">
            <div className="support-section-heading">
              <div>
                <p className="eyebrow">Customer care</p>
                <h2 id="cases-heading">Support case queue</h2>
              </div>
              <span className="support-count">{queue.length}</span>
            </div>
            {queue.length ? (
              <div className="support-case-list">
                {queue.map((item) => (
                  <article className="support-item" key={item.id}>
                    <button
                      className="support-case-select"
                      onClick={() => void openCase(item)}
                      type="button"
                    >
                      <span>
                        <strong>{item.subject}</strong>
                        <small>
                          {item.category.toLowerCase()} · {item.priority.toLowerCase()} ·{' '}
                          {item.status.replaceAll('_', ' ').toLowerCase()}
                        </small>
                      </span>
                      <span aria-hidden="true">›</span>
                    </button>
                    {!item.assignedToUserId && (
                      <button
                        className="button button-small"
                        disabled={Boolean(busyId)}
                        onClick={() => void claimCase(item)}
                        type="button"
                      >
                        Claim case
                      </button>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="support-muted">No unassigned or assigned cases.</p>
            )}
            {activeCase && (
              <article className="support-case-detail">
                <div className="support-section-heading">
                  <div>
                    <p className="eyebrow">Assigned case</p>
                    <h3>{activeCase.subject}</h3>
                    <p className="support-muted">
                      {activeCase.user.name} · {activeCase.user.email}
                    </p>
                  </div>
                  <span className="support-status">
                    {activeCase.status.replaceAll('_', ' ').toLowerCase()}
                  </span>
                </div>
                {activeCase.order && (
                  <p className="support-order-summary">
                    Order {activeCase.order.id} · {activeCase.order.status.toLowerCase()} ·{' '}
                    {money(activeCase.order.totalMinor, activeCase.order.currency)}
                  </p>
                )}
                <div className="support-thread">
                  {activeCase.messages.map((message) => (
                    <article
                      className={`support-message ${message.isInternal ? 'is-internal' : ''}`}
                      key={message.id}
                    >
                      <strong>
                        {message.author.name}
                        {message.isInternal ? ' · Internal note' : ''}
                      </strong>
                      <p>{message.body}</p>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleString()}
                      </time>
                    </article>
                  ))}
                </div>
                {!['RESOLVED', 'CLOSED'].includes(activeCase.status) && (
                  <>
                    <form
                      className="support-reply-form"
                      onSubmit={(event) => void sendAgentMessage(event)}
                    >
                      <label className="form-field">
                        Reply or internal note
                        <textarea maxLength={4000} minLength={2} name="body" required rows={3} />
                      </label>
                      <label className="support-checkbox">
                        <input name="isInternal" type="checkbox" />
                        Internal note, hidden from customer
                      </label>
                      <button className="secondary-button" disabled={Boolean(busyId)} type="submit">
                        Send message
                      </button>
                    </form>
                    <form
                      className="support-resolve-form"
                      onSubmit={(event) => void resolveCase(event)}
                    >
                      <h4>Resolve case</h4>
                      <label className="form-field">
                        Internal resolution summary
                        <textarea
                          maxLength={1000}
                          minLength={5}
                          name="resolutionSummary"
                          required
                          rows={2}
                        />
                      </label>
                      <label className="form-field">
                        Customer-visible outcome
                        <textarea
                          maxLength={500}
                          minLength={5}
                          name="customerOutcome"
                          required
                          rows={2}
                        />
                      </label>
                      <button className="button" disabled={Boolean(busyId)} type="submit">
                        Resolve and notify
                      </button>
                    </form>
                  </>
                )}
              </article>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
