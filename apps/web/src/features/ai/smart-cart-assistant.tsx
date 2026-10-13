'use client';

import Link from 'next/link';
import { useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type SmartCartResult = {
  cartId: string;
  restaurant: { id: string; name: string; city: string };
  currency: string;
  duplicates: Array<{ menuItemId: string; name: string; lineCount: number; totalQuantity: number }>;
  valueAlternatives: Array<{
    currentMenuItemId: string;
    currentName: string;
    replacement: { id: string; name: string; priceMinor: number; currency: string };
    quantity: number;
    potentialSavingsMinor: number;
  }>;
  availableOffers: Array<{ id: string; title: string; description: string; terms: string | null; validUntil: string }>;
  complementarySuggestions: Array<{
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
    reason: string;
  }>;
  potentialSavingsMinor: number;
  savingsNote: string;
  summary: string;
  uncertainty: string;
};

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Smart Cart is unavailable.');
  return envelope.data as T;
}

function money(amountMinor: number, currency: string) {
  return (amountMinor / 100).toLocaleString('en-IN', { style: 'currency', currency });
}

export function SmartCartAssistant({
  cartId,
  restaurant,
  onCartUpdated,
}: {
  cartId: string;
  restaurant: { id: string; name: string };
  onCartUpdated: () => Promise<void>;
}) {
  const [result, setResult] = useState<SmartCartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function analyze() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      setResult(await request<SmartCartResult>('/ai/smart-cart', { cartId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Smart Cart is unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function addSuggestion(menuItemId: string) {
    setAddingId(menuItemId);
    setError('');
    try {
      await request(`/carts/${cartId}/items`, { menuItemId, quantity: 1 });
      await onCartUpdated();
      setNotice('Item added to your cart. Review the updated total before checkout.');
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This suggestion could not be added.');
    } finally {
      setAddingId('');
    }
  }

  return (
    <section className="smart-cart" aria-labelledby="smart-cart-heading">
      <div className="smart-cart-heading">
        <div>
          <p className="eyebrow">{restaurant.name}</p>
          <h3 id="smart-cart-heading">Smart Cart</h3>
        </div>
        {!result && (
          <button className="secondary-button" disabled={loading} onClick={() => void analyze()} type="button">
            {loading ? 'Reviewing…' : 'Review cart'}
          </button>
        )}
      </div>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message" role="status">{notice}</p>}
      {result && (
        <div className="smart-cart-result">
          <p>{result.summary}</p>
          {result.potentialSavingsMinor > 0 && (
            <p className="smart-cart-savings">
              Potential item savings <strong>{money(result.potentialSavingsMinor, result.currency)}</strong>
            </p>
          )}
          <p className="ai-caveat">{result.savingsNote}</p>
          {result.duplicates.length > 0 && (
            <div className="smart-cart-group">
              <h4>Duplicate lines</h4>
              {result.duplicates.map((item) => (
                <p key={item.menuItemId}>{item.name} · {item.lineCount} lines · quantity {item.totalQuantity}</p>
              ))}
            </div>
          )}
          {result.valueAlternatives.length > 0 && (
            <div className="smart-cart-group">
              <h4>Lower-priced alternatives</h4>
              {result.valueAlternatives.map((item) => (
                <p key={item.currentMenuItemId}>
                  {item.replacement.name} instead of {item.currentName} · save up to {money(item.potentialSavingsMinor, result.currency)} ·{' '}
                  <Link href={`/restaurants/${restaurant.id}`}>Review menu</Link>
                </p>
              ))}
            </div>
          )}
          {result.availableOffers.length > 0 && (
            <div className="smart-cart-group">
              <h4>Current restaurant offers</h4>
              {result.availableOffers.map((offer) => (
                <p key={offer.id}><strong>{offer.title}</strong> · {offer.description}{offer.terms ? ` · ${offer.terms}` : ''}</p>
              ))}
            </div>
          )}
          {result.complementarySuggestions.length > 0 && (
            <div className="smart-cart-group">
              <h4>Suggested additions</h4>
              {result.complementarySuggestions.map((item) => (
                <div className="smart-cart-suggestion" key={item.id}>
                  <div><strong>{item.name}</strong><span>{item.reason}</span></div>
                  <strong>{money(item.priceMinor, item.currency)}</strong>
                  <button className="secondary-button" disabled={Boolean(addingId)} onClick={() => void addSuggestion(item.id)} type="button">
                    {addingId === item.id ? 'Adding…' : 'Add to cart'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {result.uncertainty && <p className="ai-caveat">{result.uncertainty}</p>}
          <button className="text-button" onClick={() => setResult(null)} type="button">Close review</button>
        </div>
      )}
    </section>
  );
}