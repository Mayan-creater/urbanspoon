'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type CateringRequest = {
  id: string;
  guestCount: number;
  budgetMinor: number;
  currency: string;
  cuisineTypes: string[];
  dietaryTags: string[];
  occasion: string;
  eventAt: string;
  city: string;
  state: string;
  postalCode: string;
  venueAddress: string;
  details: string | null;
  quotes: Array<{ id: string; revision: number; amountMinor: number; taxMinor: number; currency: string; status: string; validUntil: string }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Catering requests are unavailable.');
  return envelope.data as T;
}

function localDateTime(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function CateringProvider({
  restaurantId,
  enabled,
  active,
  onEnabledChange,
}: {
  restaurantId: string;
  enabled: boolean;
  active: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const [requests, setRequests] = useState<CateringRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRequests(await api<CateringRequest[]>(`/partner/restaurants/${restaurantId}/catering/requests`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Catering requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, restaurantId]);

  async function setCateringEnabled(next: boolean) {
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${restaurantId}/catering`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      onEnabledChange(next);
      setNotice(next ? 'Catering requests enabled for this restaurant.' : 'Catering requests disabled.');
      if (!next) setRequests([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Catering settings could not be saved.');
    } finally {
      setPending(false);
    }
  }

  async function submitQuote(event: FormEvent<HTMLFormElement>, request: CateringRequest) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api(`/partner/restaurants/${restaurantId}/catering/requests/${request.id}/quotes`, {
        method: 'POST',
        body: JSON.stringify({
          amountMinor: Math.round(Number(values.get('amount')) * 100),
          taxMinor: Math.round(Number(values.get('tax') || 0) * 100),
          currency: request.currency,
          inclusions: String(values.get('inclusions')).split(',').map((value) => value.trim()).filter(Boolean),
          message: values.get('message'),
          validUntil: new Date(String(values.get('validUntil'))).toISOString(),
        }),
      });
      setNotice('Quotation submitted. The customer can review this revision.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Quotation could not be submitted.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="partner-section catering-provider" aria-labelledby="catering-provider-heading">
      <div className="catering-provider-heading">
        <div><p className="eyebrow">Phase 4 · Catering</p><h2 id="catering-provider-heading">Event quotations</h2></div>
        <label className="partner-toggle">
          <input checked={enabled} disabled={pending || (!active && !enabled)} onChange={(event) => void setCateringEnabled(event.target.checked)} type="checkbox" />
          Receive local event requests
        </label>
      </div>
      {!active && <p className="market-empty">An approved active restaurant is required to receive event requests.</p>}
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message" role="status">{notice}</p>}
      {enabled && loading && <p role="status">Loading local requests…</p>}
      {enabled && !loading && requests.length === 0 && <p className="market-empty">No matching open event requests in this restaurant’s city.</p>}
      {enabled && requests.map((request) => (
        <article className="catering-provider-request" key={request.id}>
          <div className="catering-request-heading">
            <div><p className="eyebrow">{request.city} · {request.guestCount} guests</p><h3>{request.occasion}</h3></div>
            <strong>{(request.budgetMinor / 100).toLocaleString('en-IN', { style: 'currency', currency: request.currency })} budget</strong>
          </div>
          <p>{new Date(request.eventAt).toLocaleString()} · {request.cuisineTypes.join(', ')}</p>
          <p>{request.venueAddress}, {request.city}, {request.state} {request.postalCode}</p>
          {request.dietaryTags.length > 0 && <p>Dietary requirements: {request.dietaryTags.join(', ')}</p>}
          {request.details && <p>{request.details}</p>}
          {request.quotes[0] && <p className="catering-current-quote">Your latest quotation: revision {request.quotes[0].revision} · {request.quotes[0].status.toLowerCase()}</p>}
          <form className="catering-quote-form" onSubmit={(event) => void submitQuote(event, request)}>
            <label className="form-field">Price before tax ({request.currency})<input name="amount" type="number" min="1" step="1" required /></label>
            <label className="form-field">Tax ({request.currency})<input name="tax" type="number" min="0" step="1" defaultValue="0" /></label>
            <label className="form-field">Valid until<input name="validUntil" type="datetime-local" required max={localDateTime(new Date(new Date(request.eventAt).getTime() - 60_000))} min={localDateTime(new Date(Date.now() + 60_000))} /></label>
            <label className="form-field catering-quote-wide">Inclusions<input name="inclusions" required minLength={2} maxLength={600} placeholder="Food, setup, serving staff" /></label>
            <label className="form-field catering-quote-wide">Quote notes<textarea name="message" maxLength={1000} rows={2} /></label>
            <button className="secondary-button" disabled={pending} type="submit">Submit quotation</button>
          </form>
        </article>
      ))}
      <p className="catering-note">Quote revisions and expiry are recorded. Submitting a quotation does not create a booking or collect payment.</p>
    </section>
  );
}