'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface CustomerOrder {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  restaurant: { name: string };
}

interface CustomerReview {
  id: string;
  orderId: string;
  rating: number;
  title: string;
  status: string;
  restaurant: { name: string };
}

interface CaseMessage {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string };
}

interface CustomerCase {
  id: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  customerOutcome: string | null;
  createdAt: string;
  order: { id: string; status: string } | null;
  messages: CaseMessage[];
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

function money(minor: number, currency: string) {
  const fractionDigits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    minor / 10 ** fractionDigits,
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export function SupportCenter() {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [reviews, setReviews] = useState<CustomerReview[]>([]);
  const [cases, setCases] = useState<CustomerCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [category, setCategory] = useState('ORDER');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setError('');
    try {
      const [nextOrders, nextReviews, nextCases] = await Promise.all([
        api<CustomerOrder[]>('/orders'),
        api<CustomerReview[]>('/reviews/mine'),
        api<CustomerCase[]>('/support/cases'),
      ]);
      setOrders(nextOrders);
      setReviews(nextReviews);
      setCases(nextCases);
      setSelectedCaseId((current) => current || nextCases[0]?.id || '');
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'Unauthorized') setSignedOut(true);
      else setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitReview(event: FormEvent<HTMLFormElement>, order: CustomerOrder) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api('/reviews', {
        method: 'POST',
        headers: { 'idempotency-key': globalThis.crypto.randomUUID() },
        body: JSON.stringify({
          orderId: order.id,
          rating: Number(form.get('rating')),
          title: form.get('title'),
          body: form.get('body'),
        }),
      });
      await load();
      setNotice('Review submitted for moderation.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  async function createCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedCategory = String(form.get('category'));
    setPending(true);
    setError('');
    setNotice('');
    try {
      const created = await api<CustomerCase>('/support/cases', {
        method: 'POST',
        headers: { 'idempotency-key': globalThis.crypto.randomUUID() },
        body: JSON.stringify({
          category: selectedCategory,
          priority: form.get('priority'),
          ...(form.get('orderId') ? { orderId: form.get('orderId') } : {}),
          subject: form.get('subject'),
          message: form.get('message'),
        }),
      });
      formElement.reset();
      setCategory('ORDER');
      setSelectedCaseId(created.id);
      await load();
      setNotice('Support case created.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  async function replyToCase(event: FormEvent<HTMLFormElement>, supportCase: CustomerCase) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError('');
    try {
      await api(`/support/cases/${supportCase.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: form.get('body') }),
      });
      formElement.reset();
      await load();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <main className="support-page">
        <p role="status">Loading reviews and support…</p>
      </main>
    );
  }

  if (signedOut) {
    return (
      <main className="support-page">
        <nav className="support-topbar">
          <Link className="wordmark" href="/">
            Urban Spoon
          </Link>
          <Link href="/login">Sign in</Link>
        </nav>
        <section className="support-empty">
          <h1>Sign in to review an order or contact support.</h1>
          <Link className="button" href="/login">
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  const reviewedOrderIds = new Set(reviews.map(({ orderId }) => orderId));
  const eligibleOrders = orders.filter(
    (order) => order.status === 'DELIVERED' && !reviewedOrderIds.has(order.id),
  );
  const orderCategory = ['ORDER', 'PAYMENT', 'DELIVERY'].includes(category);

  return (
    <main className="support-page">
      <nav className="support-topbar" aria-label="Support navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <div className="support-nav-links">
          <Link href="/account">Account</Link>
          <Link href="/restaurants">Restaurants</Link>
        </div>
      </nav>
      <header className="support-header">
        <p className="eyebrow">Customer care</p>
        <h1>Reviews & support</h1>
        <p>Review delivered orders, track a case, or send our team a message.</p>
      </header>
      {(error || notice) && (
        <p
          className={`support-notice ${error ? 'form-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
        </p>
      )}

      <section className="support-section" aria-labelledby="review-heading">
        <div className="support-section-heading">
          <div>
            <p className="eyebrow">Your orders</p>
            <h2 id="review-heading">Reviews</h2>
          </div>
          <span className="support-count">{eligibleOrders.length}</span>
        </div>
        {eligibleOrders.length ? (
          <div className="support-review-list">
            {eligibleOrders.map((order) => (
              <article className="support-item" key={order.id}>
                <div className="support-item-heading">
                  <div>
                    <h3>{order.restaurant.name}</h3>
                    <p>
                      {new Date(order.createdAt).toLocaleDateString()} ·{' '}
                      {money(order.totalMinor, order.currency)}
                    </p>
                  </div>
                  <span className="support-status">Delivered</span>
                </div>
                <form
                  className="support-review-form"
                  onSubmit={(event) => void submitReview(event, order)}
                >
                  <fieldset className="support-rating">
                    <legend>Rating</legend>
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <label key={rating}>
                        <input
                          defaultChecked={rating === 5}
                          name="rating"
                          type="radio"
                          value={rating}
                        />
                        {rating}
                      </label>
                    ))}
                  </fieldset>
                  <label className="form-field">
                    Review title
                    <input maxLength={120} minLength={3} name="title" required />
                  </label>
                  <label className="form-field">
                    Your review
                    <textarea maxLength={2000} minLength={10} name="body" required rows={3} />
                  </label>
                  <button className="button" disabled={pending} type="submit">
                    Submit review
                  </button>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <p className="support-muted">No delivered orders are waiting for a review.</p>
        )}
        {reviews.length > 0 && (
          <div className="support-review-history">
            <h3>Submitted reviews</h3>
            {reviews.map((review) => (
              <p key={review.id}>
                <strong>{review.restaurant.name}</strong> · {review.rating}/5 ·{' '}
                {review.status.toLowerCase()}
              </p>
            ))}
          </div>
        )}
      </section>

      <div className="support-layout">
        <section className="support-section" aria-labelledby="case-create-heading">
          <p className="eyebrow">Get help</p>
          <h2 id="case-create-heading">Create a support case</h2>
          <form className="support-case-form" onSubmit={(event) => void createCase(event)}>
            <label className="form-field">
              Topic
              <select
                name="category"
                onChange={(event) => setCategory(event.target.value)}
                value={category}
              >
                <option value="ORDER">Order</option>
                <option value="PAYMENT">Payment or refund</option>
                <option value="DELIVERY">Delivery</option>
                <option value="ACCOUNT">Account</option>
                <option value="OTHER">Something else</option>
              </select>
            </label>
            {orderCategory && (
              <label className="form-field">
                Related order
                <select name="orderId" required>
                  <option value="">Choose an order</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.restaurant.name} · {new Date(order.createdAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="form-field">
              Priority
              <select defaultValue="NORMAL" name="priority">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </label>
            <label className="form-field">
              Subject
              <input maxLength={120} minLength={4} name="subject" required />
            </label>
            <label className="form-field">
              Message
              <textarea maxLength={4000} minLength={10} name="message" required rows={4} />
            </label>
            <button className="button" disabled={pending} type="submit">
              Create case
            </button>
          </form>
        </section>

        <section className="support-section" aria-labelledby="case-list-heading">
          <div className="support-section-heading">
            <div>
              <p className="eyebrow">Your requests</p>
              <h2 id="case-list-heading">Support cases</h2>
            </div>
            <span className="support-count">{cases.length}</span>
          </div>
          {cases.length ? (
            <div className="support-case-list">
              {cases.map((supportCase) => (
                <article className="support-item" key={supportCase.id}>
                  <button
                    aria-expanded={selectedCaseId === supportCase.id}
                    className="support-case-select"
                    onClick={() =>
                      setSelectedCaseId(selectedCaseId === supportCase.id ? '' : supportCase.id)
                    }
                    type="button"
                  >
                    <span>
                      <strong>{supportCase.subject}</strong>
                      <small>
                        {supportCase.category.toLowerCase()} ·{' '}
                        {supportCase.status.replaceAll('_', ' ').toLowerCase()}
                      </small>
                    </span>
                    <span aria-hidden="true">{selectedCaseId === supportCase.id ? '−' : '+'}</span>
                  </button>
                  {selectedCaseId === supportCase.id && (
                    <div className="support-thread">
                      {supportCase.customerOutcome && (
                        <p className="support-outcome">{supportCase.customerOutcome}</p>
                      )}
                      {supportCase.messages.map((message) => (
                        <article className="support-message" key={message.id}>
                          <strong>{message.author.name}</strong>
                          <p>{message.body}</p>
                          <time dateTime={message.createdAt}>
                            {new Date(message.createdAt).toLocaleString()}
                          </time>
                        </article>
                      ))}
                      {!['RESOLVED', 'CLOSED'].includes(supportCase.status) ? (
                        <form
                          className="support-reply-form"
                          onSubmit={(event) => void replyToCase(event, supportCase)}
                        >
                          <label className="form-field">
                            Reply
                            <textarea
                              maxLength={4000}
                              minLength={2}
                              name="body"
                              required
                              rows={2}
                            />
                          </label>
                          <button className="secondary-button" disabled={pending} type="submit">
                            Send reply
                          </button>
                        </form>
                      ) : (
                        <p className="support-muted">This case has been resolved.</p>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="support-muted">You have no support cases.</p>
          )}
        </section>
      </div>
    </main>
  );
}
