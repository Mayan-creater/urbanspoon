'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface CartSummary {
  id: string;
  restaurantId: string;
  restaurant: { id: string; name: string };
  items: Array<{ id: string }>;
}

interface GroupItem {
  id: string;
  quantity: number;
  menuItem: { id: string; name: string; priceMinor: number; currency: string };
  addedBy: { id: string; name: string };
}

interface GroupOrder {
  id: string;
  cartId: string;
  hostUserId: string;
  currentUserId: string;
  isHost: boolean;
  status: 'OPEN' | 'LOCKED' | 'CHECKED_OUT' | 'EXPIRED';
  deadlineAt: string | null;
  host: { id: string; name: string };
  members: Array<{ user: { id: string; name: string }; joinedAt: string }>;
  cart: {
    restaurant: { id: string; name: string };
    items: GroupItem[];
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Request failed.');
  return envelope.data as T;
}

export function GroupOrderPage() {
  const [carts, setCarts] = useState<CartSummary[]>([]);
  const [group, setGroup] = useState<GroupOrder | null>(null);
  const [inviteToken, setInviteToken] = useState('');
  const [deadlineAt, setDeadlineAt] = useState('');
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [shareUrl, setShareUrl] = useState('');
  const [intentId, setIntentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') ?? '';
    const groupOrderId = params.get('groupOrderId');
    setInviteToken(token);
    void Promise.all([
      request<CartSummary[]>('/carts').catch(() => []),
      groupOrderId ? request<GroupOrder>(`/group-orders/${groupOrderId}`) : Promise.resolve(null),
    ])
      .then(([cartList, currentGroup]) => {
        setCarts(cartList);
        setGroup(currentGroup);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load this group order.');
      })
      .finally(() => setLoading(false));
  }, []);

  async function createGroup() {
    const cart = carts[0];
    if (!cart) {
      setError('Add items to your cart before starting a group order.');
      return;
    }
    setPending(true);
    setError('');
    setNotice('');
    try {
      const created = await request<GroupOrder>('/group-orders', {
        method: 'POST',
        body: JSON.stringify({
          cartId: cart.id,
          ...(deadlineAt ? { deadlineAt: new Date(deadlineAt).toISOString() } : {}),
        }),
      });
      setGroup(created);
      setGroupRoute(created.id);
      await createInvite(created.id);
      setNotice('Group order created. Share the invite link with participants.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a group order.');
    } finally {
      setPending(false);
    }
  }

  async function createInvite(groupOrderId: string) {
    const invite = await request<{ token: string; expiresAt: string }>(
      `/group-orders/${groupOrderId}/invites`,
      { method: 'POST' },
    );
    const url = new URL('/group-orders', window.location.origin);
    url.searchParams.set('token', invite.token);
    setShareUrl(url.toString());
  }

  async function joinGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    try {
      const joined = await request<GroupOrder>('/group-orders/join', {
        method: 'POST',
        body: JSON.stringify({ token: inviteToken.trim() }),
      });
      setGroup(joined);
      setGroupRoute(joined.id);
      setInviteToken('');
      setNotice('You joined the group order. Add items from the restaurant menu.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join this group order.');
    } finally {
      setPending(false);
    }
  }

  function setGroupRoute(groupOrderId: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    url.searchParams.set('groupOrderId', groupOrderId);
    window.history.replaceState({}, '', url);
  }

  async function refreshGroup() {
    if (group) setGroup(await request<GroupOrder>(`/group-orders/${group.id}`));
  }

  async function removeItem(itemId: string) {
    if (!group) return;
    setPending(true);
    setError('');
    try {
      await request(`/group-orders/${group.id}/items/${itemId}`, { method: 'DELETE' });
      await refreshGroup();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove the item.');
    } finally {
      setPending(false);
    }
  }

  async function updateItem(itemId: string) {
    if (!group) return;
    setPending(true);
    setError('');
    try {
      await request(`/group-orders/${group.id}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: itemQuantities[itemId] ?? 1 }),
      });
      await refreshGroup();
      setNotice('Shared item quantity updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the item.');
    } finally {
      setPending(false);
    }
  }

  async function lockGroup() {
    if (!group) return;
    setPending(true);
    setError('');
    try {
      await request(`/group-orders/${group.id}/lock`, { method: 'POST' });
      await refreshGroup();
      setNotice('Group locked. The host can now start checkout.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not lock this group order.');
    } finally {
      setPending(false);
    }
  }

  async function checkoutGroup() {
    if (!group) return;
    setPending(true);
    setError('');
    try {
      const intent = await request<{ id: string }>(`/group-orders/${group.id}/checkout`, {
        method: 'POST',
      });
      setIntentId(intent.id);
      await refreshGroup();
      setNotice('Checkout is ready. The host can continue with payment.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start group checkout.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="group-order-page">
      <nav className="top-nav" aria-label="Group order navigation">
        <Link className="wordmark" href="/">Urban Spoon</Link>
        <div className="top-nav-actions">
          <Link href="/restaurants">Restaurants</Link>
          <Link href="/cart">Cart</Link>
          <Link href="/account">Account</Link>
        </div>
      </nav>
      <section className="group-order-content" aria-labelledby="group-order-title">
        <p className="eyebrow">Shared ordering</p>
        <h1 id="group-order-title">Group order</h1>
        {loading && <p role="status">Loading your cart…</p>}
        {(error || notice) && (
          <p className={error ? 'form-message form-error' : 'form-message'} role={error ? 'alert' : 'status'}>
            {error || notice}
          </p>
        )}
        {!group && !loading && (
          <div className="group-entry-layout">
            <section className="group-entry-section">
              <h2>Start a group order</h2>
              <p>Use your current restaurant cart as the shared order.</p>
              {carts[0] ? (
                <p className="group-cart-origin">{carts[0].restaurant.name} · {carts[0].items.length} items</p>
              ) : <p className="group-cart-origin">Your cart is empty.</p>}
              <label className="form-field">
                Group deadline (optional)
                <input type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} />
              </label>
              <button className="button" disabled={pending || !carts.length} onClick={() => void createGroup()} type="button">
                Create group order
              </button>
            </section>
            <section className="group-entry-section">
              <h2>Join with an invite</h2>
              <form className="group-join-form" onSubmit={(event) => void joinGroup(event)}>
                <label className="form-field">
                  Invite token
                  <input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} minLength={32} maxLength={128} required />
                </label>
                <button className="secondary-button" disabled={pending} type="submit">Join group</button>
              </form>
            </section>
          </div>
        )}
        {group && (
          <>
            <section className="group-summary" aria-label="Group order status">
              <div>
                <p className="eyebrow">{group.cart.restaurant.name}</p>
                <h2>{group.status.replaceAll('_', ' ')}</h2>
                <p>Host: {group.host.name} · {group.members.length} participants</p>
              </div>
              <div className="group-actions">
                <button className="secondary-button" disabled={pending} onClick={() => void refreshGroup()} type="button">
                  Refresh
                </button>
                {group.status === 'OPEN' && group.isHost && (
                  <>
                    <button className="secondary-button" disabled={pending} onClick={() => void createInvite(group.id)} type="button">New invite</button>
                    <button className="button" disabled={pending || !group.cart.items.length} onClick={() => void lockGroup()} type="button">Lock group</button>
                  </>
                )}
                {group.status === 'LOCKED' && group.isHost && (
                  <button className="button" disabled={pending} onClick={() => void checkoutGroup()} type="button">Start checkout</button>
                )}
              </div>
            </section>
            {shareUrl && (
              <label className="form-field group-share-field">
                Single-use invite link
                <input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
            )}
            {group.status === 'OPEN' && (
              <Link className="group-menu-link" href={`/restaurants/${group.cart.restaurant.id}?groupOrderId=${encodeURIComponent(group.id)}`}>
                Browse {group.cart.restaurant.name} menu
              </Link>
            )}
            {intentId && <p className="group-intent-id">Checkout intent: {intentId}</p>}
            <section className="group-members" aria-labelledby="group-members-title">
              <h2 id="group-members-title">Participants</h2>
              <ul>{group.members.map(({ user }) => <li key={user.id}>{user.name}{user.id === group.hostUserId ? ' · Host' : ''}</li>)}</ul>
            </section>
            <section className="group-items" aria-labelledby="group-items-title">
              <h2 id="group-items-title">Shared items</h2>
              {group.cart.items.length ? (
                <ul>
                  {group.cart.items.map((item) => (
                    <li key={item.id}>
                      <div><strong>{item.quantity} × {item.menuItem.name}</strong><span>Added by {item.addedBy.name}</span></div>
                      {group.status === 'OPEN' && (group.isHost || item.addedBy.id === group.currentUserId) && (
                        <div className="group-item-actions">
                          <label>
                            Quantity
                            <input
                              type="number"
                              min="1"
                              max="99"
                              value={itemQuantities[item.id] ?? item.quantity}
                              onChange={(event) =>
                                setItemQuantities((current) => ({
                                  ...current,
                                  [item.id]: Math.max(1, Math.min(99, Number(event.target.value) || 1)),
                                }))
                              }
                            />
                          </label>
                          <button className="text-button" disabled={pending} onClick={() => void updateItem(item.id)} type="button">Save</button>
                          <button className="text-button" disabled={pending} onClick={() => void removeItem(item.id)} type="button">Remove</button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : <p className="group-cart-origin">No items yet.</p>}
            </section>
          </>
        )}
      </section>
    </main>
  );
}