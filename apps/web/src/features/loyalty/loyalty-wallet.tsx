'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface LoyaltyTransaction {
  id: string;
  type: 'EARN' | 'REDEMPTION' | 'REFUND_REVERSAL' | 'REFUND_RESTORATION';
  points: number;
  createdAt: string;
  order: { id: string };
  rule: { currency: string; version: number };
}

interface Wallet {
  balancePoints: number;
  lifetimeEarnedPoints: number;
  tier: { name: string; threshold: number; multiplierBps: number };
  transactions: LoyaltyTransaction[];
}

const transactionLabels: Record<LoyaltyTransaction['type'], string> = {
  EARN: 'Order delivered',
  REDEMPTION: 'Redeemed at checkout',
  REFUND_REVERSAL: 'Points reversed after refund',
  REFUND_RESTORATION: 'Points restored after refund',
};

export function LoyaltyWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [error, setError] = useState('');

  async function loadWallet() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/loyalty`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (response.status === 401) {
        setSignedIn(false);
        setWallet(null);
        return;
      }
      if (!response.ok) throw new Error('Unable to load FoodCoins.');
      const envelope = (await response.json()) as { data: Wallet };
      setWallet(envelope.data);
      setSignedIn(true);
    } catch {
      setError('The FoodCoins service could not be reached. Retry in a moment.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWallet();
  }, []);

  return (
    <main className="loyalty-page">
      <nav className="top-nav" aria-label="Account navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <div className="top-nav-actions">
          <Link href="/account">Account</Link>
          <Link href="/support">Reviews & support</Link>
        </div>
      </nav>
      <section className="loyalty-content" aria-labelledby="loyalty-title">
        <p className="eyebrow">Your rewards</p>
        <h1 id="loyalty-title">FoodCoins</h1>

        {loading ? (
          <p role="status">Loading your balance…</p>
        ) : !signedIn ? (
          <section className="loyalty-empty">
            <h2>Sign in to view your balance</h2>
            <p>Your FoodCoins balance and earning history are tied to your account.</p>
            <Link className="button" href="/login">
              Sign in
            </Link>
          </section>
        ) : error ? (
          <div className="loyalty-empty">
            <p className="form-message form-error" role="alert">
              {error}
            </p>
            <button className="secondary-button" type="button" onClick={() => void loadWallet()}>
              Retry
            </button>
          </div>
        ) : wallet ? (
          <>
            <section className="loyalty-summary" aria-label="FoodCoins balance">
              <div>
                <p className="loyalty-label">Available balance</p>
                <p className="loyalty-balance">
                  {wallet.balancePoints.toLocaleString()}
                  <span> coins</span>
                </p>
              </div>
              <p className="loyalty-note">
                {wallet.tier.name} tier · {wallet.lifetimeEarnedPoints.toLocaleString()} lifetime
                points
              </p>
            </section>
            <section className="loyalty-history" aria-labelledby="loyalty-history-title">
              <div className="loyalty-history-heading">
                <h2 id="loyalty-history-title">Earning history</h2>
                <span>{wallet.transactions.length} recent entries</span>
              </div>
              {wallet.transactions.length ? (
                <ul className="loyalty-entry-list">
                  {wallet.transactions.map((transaction) => (
                    <li className="loyalty-entry" key={transaction.id}>
                      <div>
                        <strong>{transactionLabels[transaction.type]}</strong>
                        <p>
                          Order {transaction.order.id.slice(0, 8)} · Rule v{transaction.rule.version}
                        </p>
                      </div>
                      <div className="loyalty-entry-value">
                        <strong>
                          {transaction.points > 0 ? '+' : ''}
                          {transaction.points.toLocaleString()}
                        </strong>
                        <time dateTime={transaction.createdAt}>
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(transaction.createdAt))}
                        </time>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="loyalty-empty-copy">Your delivered-order earnings will appear here.</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}