'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type Mode = 'assistant' | 'recommendations' | 'meal-plans' | 'voice-order';
type Restaurant = { id: string; name: string; city: string };
type Suggestion = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  restaurant: { id: string; name: string; city: string };
  reason: string;
  quantity?: number;
};
type FoodResult = {
  answer?: string;
  summary?: string;
  restaurantId?: string;
  suggestions?: Suggestion[];
  items?: Suggestion[];
  totalMinor?: number;
  uncertainty: string;
};
type ReviewAnalysis = {
  restaurantId: string;
  restaurantName: string;
  summary: string;
  uncertainty: string;
  themes: Array<{ topic: string; sentiment: string; evidence: string; reviewIds: string[] }>;
};

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'AI request failed.');
  return envelope.data as T;
}

function money(amountMinor: number, currency = 'INR') {
  return (amountMinor / 100).toLocaleString('en-IN', { style: 'currency', currency });
}

export function AiWorkspace() {
  const [mode, setMode] = useState<Mode>('assistant');
  const [prompt, setPrompt] = useState('');
  const [city, setCity] = useState('');
  const [budget, setBudget] = useState('');
  const [people, setPeople] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [dietaryTags, setDietaryTags] = useState('');
  const [result, setResult] = useState<FoodResult | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [analysis, setAnalysis] = useState<ReviewAnalysis | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [voiceNotice, setVoiceNotice] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/restaurants`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('');
        const envelope = (await response.json()) as { data: Restaurant[] };
        if (active) setRestaurants(envelope.data);
      })
      .catch(() => {
        if (active) setError('Restaurants are temporarily unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function submitFood(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setResult(null);
    setAnalysis(null);
    try {
      const payload = {
        prompt,
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(budget.trim() ? { budgetMinor: Math.round(Number(budget) * 100) } : {}),
        ...(people.trim() ? { people: Number(people) } : {}),
        ...(latitude.trim() && longitude.trim()
          ? { latitude: Number(latitude), longitude: Number(longitude) }
          : {}),
        ...(dietaryTags.trim()
          ? { dietaryTags: dietaryTags.split(',').map((tag) => tag.trim()).filter(Boolean) }
          : {}),
      };
      const path = mode === 'assistant' ? '/ai/food-assistant' : `/ai/${mode}`;
      setResult(await post<FoodResult>(path, payload));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI request failed.');
    } finally {
      setPending(false);
    }
  }

  async function analyzeReviews() {
    if (!restaurantId) return;
    setPending(true);
    setError('');
    setAnalysis(null);
    setResult(null);
    try {
      setAnalysis(await post<ReviewAnalysis>('/ai/review-analysis', { restaurantId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review analysis failed.');
    } finally {
      setPending(false);
    }
  }

  function startVoiceInput() {
    type SpeechRecognitionLike = {
      lang: string;
      interimResults: boolean;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      start: () => void;
    };
    type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceNotice('Voice input is not available in this browser.');
      return;
    }
    const recognition = new Recognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((entry: ArrayLike<{ transcript: string }>) => entry[0]?.transcript ?? '')
        .join(' ');
      setPrompt((current) => `${current}${current ? ' ' : ''}${transcript}`);
      setMode('voice-order');
      setVoiceNotice('Transcript added. Review it before sending.');
    };
    recognition.onerror = () => setVoiceNotice('Voice input could not be captured.');
    setVoiceNotice('Listening…');
    recognition.start();
  }

  return (
    <main className="ai-page">
      <nav className="top-nav" aria-label="AI workspace navigation">
        <Link className="wordmark" href="/">Urban Spoon</Link>
        <div className="top-nav-actions">
          <Link href="/restaurants">Restaurants</Link>
          <Link href="/cart">Cart</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>
      <header className="ai-heading">
        <p className="eyebrow">Urban Spoon / Food intelligence</p>
        <h1>Find your next good meal.</h1>
        <p>Suggestions come from live, orderable menus. Check every detail before you decide.</p>
      </header>

      <div className="ai-layout">
        <section className="ai-controls" aria-label="Food assistant">
          <div className="ai-modes" role="group" aria-label="Choose an AI tool">
            {([
              ['assistant', 'Ask'],
              ['recommendations', 'Recommend'],
              ['meal-plans', 'Plan a meal'],
              ['voice-order', 'Voice order'],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={mode === value}
                className={mode === value ? 'ai-mode is-active' : 'ai-mode'}
                key={value}
                onClick={() => {
                  setMode(value);
                  setResult(null);
                  setAnalysis(null);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <form className="ai-form" onSubmit={(event) => void submitFood(event)}>
            <label className="form-field">
              What sounds good?
              <textarea
                maxLength={600}
                minLength={3}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Vegetarian dinner for two under ₹800, preferably spicy"
                required
                rows={4}
                value={prompt}
              />
            </label>
            <button className="ai-voice" onClick={startVoiceInput} type="button" aria-label="Add voice input">
              <span aria-hidden="true">◉</span> Voice input
            </button>
            {voiceNotice && <p className="ai-voice-notice" role="status">{voiceNotice}</p>}
            <div className="ai-fields">
              <label className="form-field">
                City
                <input maxLength={80} onChange={(event) => setCity(event.target.value)} value={city} />
              </label>
              <label className="form-field">
                Budget (₹)
                <input min="1" onChange={(event) => setBudget(event.target.value)} required={mode === 'meal-plans'} step="1" type="number" value={budget} />
              </label>
              <label className="form-field">
                People
                <input max="30" min="1" onChange={(event) => setPeople(event.target.value)} required={mode === 'meal-plans'} type="number" value={people} />
              </label>
              <label className="form-field">
                Latitude (optional)
                <input max="90" min="-90" onChange={(event) => setLatitude(event.target.value)} step="any" type="number" value={latitude} />
              </label>
              <label className="form-field">
                Longitude (optional)
                <input max="180" min="-180" onChange={(event) => setLongitude(event.target.value)} step="any" type="number" value={longitude} />
              </label>
              <label className="form-field">
                Dietary needs
                <input maxLength={260} onChange={(event) => setDietaryTags(event.target.value)} placeholder="vegetarian, vegan" value={dietaryTags} />
              </label>
            </div>
            <button className="button" disabled={pending} type="submit">
              {pending
                ? 'Thinking…'
                : mode === 'meal-plans'
                  ? 'Build meal plan'
                  : mode === 'voice-order'
                    ? 'Propose this order'
                    : mode === 'recommendations'
                      ? 'Get recommendations'
                      : 'Ask the assistant'}
            </button>
          </form>

          <section className="ai-review-tool" aria-labelledby="ai-review-title">
            <div>
              <p className="eyebrow">From published reviews</p>
              <h2 id="ai-review-title">Review analysis</h2>
            </div>
            <label className="form-field">
              Restaurant
              <select onChange={(event) => setRestaurantId(event.target.value)} value={restaurantId}>
                <option value="">Choose a restaurant</option>
                {restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name} · {restaurant.city}</option>)}
              </select>
            </label>
            <button className="secondary-button" disabled={pending || !restaurantId} onClick={() => void analyzeReviews()} type="button">
              Analyze published reviews
            </button>
          </section>
        </section>

        <section className="ai-results" aria-live="polite" aria-label="Suggestions">
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {!result && !analysis && !error && (
            <div className="ai-empty">
              <span className="ai-index">01 / DISCOVER</span>
              <h2>A thoughtful shortlist, grounded in what’s available.</h2>
              <p>Only current menu items are suggested. Prices and dietary tags are checked against restaurant data.</p>
            </div>
          )}
          {result && (
            <div className="ai-result-content">
              <p className="eyebrow">
                {mode === 'meal-plans'
                  ? 'Proposed meal plan'
                  : mode === 'voice-order'
                    ? 'Proposed voice order'
                    : 'Your suggestions'}
              </p>
              <h2>{result.answer ?? result.summary}</h2>
              {(result.items ?? result.suggestions ?? []).map((item) => (
                <article className="ai-suggestion" key={`${item.restaurant.id}-${item.id}`}>
                  <div>
                    <p className="ai-restaurant-name">{item.restaurant.name} · {item.restaurant.city}</p>
                    <h3>{item.name}{item.quantity ? ` × ${item.quantity}` : ''}</h3>
                    <p>{item.reason}</p>
                  </div>
                  <strong>{money(item.priceMinor * (item.quantity ?? 1), item.currency)}</strong>
                  <Link href={`/restaurants/${item.restaurant.id}`}>View menu</Link>
                </article>
              ))}
              {result.totalMinor !== undefined && <p className="ai-total">Proposed total <strong>{money(result.totalMinor)}</strong></p>}
              {result.uncertainty && <p className="ai-caveat">{result.uncertainty}</p>}
            </div>
          )}
          {analysis && (
            <div className="ai-result-content">
              <p className="eyebrow">Review analysis · {analysis.restaurantName}</p>
              <h2>{analysis.summary}</h2>
              <div className="ai-themes">
                {analysis.themes.map((theme) => (
                  <article className="ai-theme" key={`${theme.topic}-${theme.sentiment}`}>
                    <div><h3>{theme.topic}</h3><span className={`ai-sentiment sentiment-${theme.sentiment}`}>{theme.sentiment}</span></div>
                    <p>{theme.evidence}</p>
                    <small>
                      Sources: {theme.reviewIds.map((reviewId, index) => (
                        <span key={reviewId}>
                          {index > 0 ? ', ' : ''}<code title={reviewId}>{reviewId.slice(0, 8)}</code>
                        </span>
                      ))} · <Link href={`/restaurants/${analysis.restaurantId}#restaurant-reviews-heading`}>View published reviews</Link>
                    </small>
                  </article>
                ))}
              </div>
              {analysis.uncertainty && <p className="ai-caveat">{analysis.uncertainty}</p>}
            </div>
          )}
        </section>
      </div>
      <p className="ai-disclaimer">AI output can be incomplete. Confirm the menu, price, ingredients, and availability with the restaurant. Voice orders are proposals only; nothing is added to your cart or submitted automatically.</p>
    </main>
  );
}