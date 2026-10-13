'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type Quote = {
  id: string;
  revision: number;
  status: string;
  amountMinor: number;
  taxMinor: number;
  currency: string;
  inclusions: string[];
  message: string | null;
  validUntil: string;
  restaurant: { id: string; name: string; city: string };
};

type EventRequest = {
  id: string;
  status: string;
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
  quotes: Quote[];
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
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Catering service is unavailable.');
  return envelope.data as T;
}

function money(amountMinor: number, currency: string) {
  return (amountMinor / 100).toLocaleString('en-IN', { style: 'currency', currency });
}

function localDateTime(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function CateringMarketplace() {
  const [requests, setRequests] = useState<EventRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    try {
      setRequests(await api<EventRequest[]>('/catering/requests'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in to manage catering requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setError('');
    setNotice('');
    try {
      await api('/catering/requests', {
        method: 'POST',
        body: JSON.stringify({
          guestCount: Number(values.get('guestCount')),
          budgetMinor: Math.round(Number(values.get('budget')) * 100),
          cuisineTypes: String(values.get('cuisineTypes')).split(',').map((value) => value.trim()).filter(Boolean),
          dietaryTags: String(values.get('dietaryTags') ?? '').split(',').map((value) => value.trim()).filter(Boolean),
          occasion: values.get('occasion'),
          eventAt: new Date(String(values.get('eventAt'))).toISOString(),
          city: values.get('city'),
          state: values.get('state'),
          postalCode: values.get('postalCode'),
          venueAddress: values.get('venueAddress'),
          details: values.get('details'),
        }),
      });
      form.reset();
      setNotice('Event request sent to matching opted-in caterers.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Event request could not be submitted.');
    } finally {
      setPending(false);
    }
  }

  async function withdraw(requestId: string) {
    setPending(true);
    setError('');
    try {
      await api(`/catering/requests/${requestId}/withdraw`, { method: 'POST' });
      setNotice('Event request withdrawn.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request could not be withdrawn.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="catering-page">
      <nav className="top-nav" aria-label="Catering navigation">
        <Link className="wordmark" href="/">Urban Spoon</Link>
        <div className="top-nav-actions">
          <Link href="/restaurants">Restaurants</Link>
          <Link href="/cart">Cart</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>
      <header className="catering-heading">
        <p className="eyebrow">Events / Catering</p>
        <h1>Plan a table for everyone.</h1>
        <p>Share the event requirements and compare itemized quotations from opted-in local restaurants.</p>
      </header>
      {(error || notice) && <p className={`form-message ${error ? 'form-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
      <div className="catering-layout">
        <section className="catering-form-section" aria-labelledby="event-request-heading">
          <p className="eyebrow">Request details</p>
          <h2 id="event-request-heading">Event requirements</h2>
          <form className="catering-form" onSubmit={(event) => void createRequest(event)}>
            <label className="form-field">Occasion<input name="occasion" required minLength={3} maxLength={100} placeholder="Team lunch, birthday, wedding" /></label>
            <label className="form-field">Event date and time<input name="eventAt" required type="datetime-local" min={localDateTime(new Date(Date.now() + 60 * 60 * 1000))} /></label>
            <label className="form-field">Guests<input name="guestCount" required type="number" min="5" max="5000" /></label>
            <label className="form-field">Budget (₹)<input name="budget" required type="number" min="5" max="1000000" step="1" /></label>
            <label className="form-field">Cuisine preferences<input name="cuisineTypes" required minLength={2} maxLength={200} placeholder="Indian, Italian" /></label>
            <label className="form-field">Dietary requirements<input name="dietaryTags" maxLength={260} placeholder="vegetarian, vegan" /></label>
            <label className="form-field">City<input name="city" required maxLength={80} /></label>
            <label className="form-field">State<input name="state" required maxLength={80} /></label>
            <label className="form-field">Postal code<input name="postalCode" required minLength={3} maxLength={12} /></label>
            <label className="form-field catering-address">Venue address<input name="venueAddress" required minLength={5} maxLength={180} /></label>
            <label className="form-field catering-details">Additional requirements<textarea name="details" maxLength={1000} rows={3} /></label>
            <button className="button" disabled={pending} type="submit">{pending ? 'Sending…' : 'Request quotations'}</button>
          </form>
        </section>
        <section className="catering-requests" aria-labelledby="your-events-heading">
          <div className="catering-list-heading">
            <div><p className="eyebrow">Your requests</p><h2 id="your-events-heading">Event quotations</h2></div>
            <button className="secondary-button" disabled={loading} onClick={() => void load()} type="button">Refresh</button>
          </div>
          {loading && <p role="status">Loading event requests…</p>}
          {!loading && requests.length === 0 && <p className="market-empty">Your event requests and incoming quotations will appear here.</p>}
          {requests.map((request) => (
            <article className="catering-request" key={request.id}>
              <div className="catering-request-heading">
                <div><p className="eyebrow">{request.city} · {request.guestCount} guests</p><h3>{request.occasion}</h3></div>
                <span className="catering-status">{request.status.toLowerCase()}</span>
              </div>
              <p>{new Date(request.eventAt).toLocaleString()} · Budget {money(request.budgetMinor, request.currency)}</p>
              <p>{request.cuisineTypes.join(', ')}{request.dietaryTags.length ? ` · ${request.dietaryTags.join(', ')}` : ''}</p>
              <div className="catering-quotes">
                <h4>Quotations ({request.quotes.filter((quote) => quote.status === 'SUBMITTED' && new Date(quote.validUntil) > new Date()).length} current)</h4>
                {request.quotes.map((quote) => (
                  <div className="catering-quote" key={quote.id}>
                    <div><strong>{quote.restaurant.name} · revision {quote.revision}</strong><span>{quote.status.toLowerCase()} · valid until {new Date(quote.validUntil).toLocaleString()}</span></div>
                    <strong>{money(quote.amountMinor + quote.taxMinor, quote.currency)} total</strong>
                    <p>{quote.inclusions.join(', ')}{quote.message ? ` · ${quote.message}` : ''}</p>
                  </div>
                ))}
                {request.quotes.length === 0 && <p className="market-empty">No quotations yet.</p>}
              </div>
              {request.status === 'OPEN' && <button className="text-button" disabled={pending} onClick={() => void withdraw(request.id)} type="button">Withdraw request</button>}
            </article>
          ))}
        </section>
      </div>
      <p className="catering-note">Quotations are proposals, not bookings. This flow does not accept quotes or collect payment.</p>
    </main>
  );
}