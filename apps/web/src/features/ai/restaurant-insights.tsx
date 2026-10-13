'use client';

import Link from 'next/link';
import { useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type Insights = {
  restaurant: { id: string; name: string };
  metrics: {
    days: number;
    orderCount: number;
    cancelledOrderCount: number;
    netSalesMinor: number;
    salesTrend: Array<{ date: string; orderCount: number; netSalesMinor: number; cancellations: number }>;
    itemPerformance: Array<{ menuItemId: string; name: string; quantity: number; salesMinor: number }>;
    cancellationPatterns: Array<{ status: string; count: number }>;
    publishedReviewCount: number;
    averageRating: number | null;
  };
  sentimentThemes: Array<{ topic: string; sentiment: string; evidence: string; reviewIds: string[] }>;
  recommendations: Array<{ title: string; rationale: string; metricKeys: string[] }>;
  summary: string;
};

async function getInsights(restaurantId: string, days: number): Promise<Insights> {
  const response = await fetch(`${apiBase}/ai/partner/restaurants/${encodeURIComponent(restaurantId)}/insights`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: Insights;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Restaurant insights are unavailable.');
  return envelope.data as Insights;
}

function money(amountMinor: number) {
  return (amountMinor / 100).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
}

export function RestaurantInsights({ restaurantId }: { restaurantId: string }) {
  const [days, setDays] = useState(30);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    setLoading(true);
    setError('');
    try {
      setInsights(await getInsights(restaurantId, days));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Restaurant insights are unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="partner-section insight-section" aria-labelledby="insights-heading">
      <div className="insights-heading">
        <div>
          <p className="eyebrow">Orders and published reviews</p>
          <h2 id="insights-heading">Restaurant insights</h2>
        </div>
        <div className="insights-controls">
          <label className="form-field">
            Period
            <select onChange={(event) => setDays(Number(event.target.value))} value={days}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button className="secondary-button" disabled={loading} onClick={() => void generate()} type="button">
            {loading ? 'Analyzing…' : 'Generate insights'}
          </button>
        </div>
      </div>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {insights && (
        <div className="insights-content">
          <p className="insights-summary">{insights.summary}</p>
          <div className="insights-metrics">
            <article><span>Net item sales</span><strong>{money(insights.metrics.netSalesMinor)}</strong></article>
            <article><span>Orders</span><strong>{insights.metrics.orderCount}</strong></article>
            <article><span>Cancellations</span><strong>{insights.metrics.cancelledOrderCount}</strong></article>
            <article><span>Published rating</span><strong>{insights.metrics.averageRating ?? 'No ratings'}</strong></article>
          </div>
          <div className="insights-columns">
            <section>
              <h3>Item performance</h3>
              {insights.metrics.itemPerformance.map((item) => (
                <div className="insight-row" key={item.menuItemId}>
                  <span>{item.name}<small>{item.quantity} sold</small></span><strong>{money(item.salesMinor)}</strong>
                </div>
              ))}
              {insights.metrics.itemPerformance.length === 0 && <p className="market-empty">No completed item sales in this period.</p>}
            </section>
            <section>
              <h3>Cancellation patterns</h3>
              {insights.metrics.cancellationPatterns.map((item) => (
                <div className="insight-row" key={item.status}><span>{item.status.replaceAll('_', ' ').toLowerCase()}</span><strong>{item.count}</strong></div>
              ))}
              {insights.metrics.cancellationPatterns.length === 0 && <p className="market-empty">No cancellations in this period.</p>}
            </section>
          </div>
          {insights.sentimentThemes.length > 0 && (
            <section className="insight-themes">
              <h3>Customer sentiment</h3>
              {insights.sentimentThemes.map((theme) => (
                <article key={`${theme.topic}-${theme.sentiment}`}>
                  <div><strong>{theme.topic}</strong><span>{theme.sentiment}</span></div>
                  <p>{theme.evidence}</p>
                  <small>
                    Sources: {theme.reviewIds.map((reviewId, index) => (
                      <span key={reviewId}>{index ? ', ' : ''}<code title={reviewId}>{reviewId.slice(0, 8)}</code></span>
                    ))} · <Link href={`/restaurants/${restaurantId}#restaurant-reviews-heading`}>Review sources</Link>
                  </small>
                </article>
              ))}
            </section>
          )}
          {insights.recommendations.length > 0 && (
            <section className="insight-recommendations">
              <h3>Operational opportunities</h3>
              {insights.recommendations.map((recommendation) => (
                <article key={recommendation.title}>
                  <strong>{recommendation.title}</strong>
                  <p>{recommendation.rationale}</p>
                  <small>Based on {recommendation.metricKeys.map((key) => key.replaceAll('_', ' ')).join(', ')}</small>
                </article>
              ))}
            </section>
          )}
          <details className="insight-trend">
            <summary>Daily sales and cancellation trend</summary>
            <div className="insight-trend-table">
              {insights.metrics.salesTrend.map((day) => (
                <div className="insight-row" key={day.date}>
                  <span>{day.date}<small>{day.orderCount} orders · {day.cancellations} cancellations</small></span>
                  <strong>{money(day.netSalesMinor)}</strong>
                </div>
              ))}
            </div>
          </details>
          <p className="ai-caveat">Insights describe recorded orders and published reviews in the selected period. Recommendations are advisory; review the source metrics before changing operations.</p>
        </div>
      )}
    </section>
  );
}