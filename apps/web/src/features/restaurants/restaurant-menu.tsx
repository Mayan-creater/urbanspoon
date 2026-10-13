'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface MenuOption {
  id: string;
  name: string;
  priceDeltaMinor: number;
}

interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  dietaryTags: string[];
  optionGroups: Array<{
    id: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    options: MenuOption[];
  }>;
}

interface MenuCategory {
  id: string;
  name: string;
  description: string | null;
  items: MenuItem[];
}

interface Menu {
  id: string;
  name: string;
  description: string | null;
  city: string;
  state: string;
  isAcceptingOrders: boolean;
  categories: MenuCategory[];
  items: MenuItem[];
}

interface RestaurantReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  createdAt: string;
}

function price(minor: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100);
}

function MenuItemRow({
  item,
  acceptingOrders,
  loginHref,
  onAdd,
}: {
  item: MenuItem;
  acceptingOrders: boolean;
  loginHref: string;
  onAdd: (quantity: number, optionIds: string[]) => Promise<void>;
}) {
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const selectedOptionIds = Object.values(selectedByGroup).flat();
  const selectedOptions = item.optionGroups.flatMap((group) =>
    group.options.filter((option) => selectedByGroup[group.id]?.includes(option.id)),
  );
  const unitPrice =
    item.priceMinor + selectedOptions.reduce((total, option) => total + option.priceDeltaMinor, 0);

  function selectOption(groupId: string, optionId: string, selected: boolean) {
    setSelectedByGroup((current) => {
      const currentIds = current[groupId] ?? [];
      const nextIds = selected
        ? [...currentIds, optionId]
        : currentIds.filter((currentId) => currentId !== optionId);
      return { ...current, [groupId]: nextIds };
    });
  }

  async function addToCart() {
    const invalidGroup = item.optionGroups.find((group) => {
      const count = selectedByGroup[group.id]?.length ?? 0;
      return count < group.minSelections || count > group.maxSelections;
    });
    if (invalidGroup) {
      setError(
        `Choose ${invalidGroup.minSelections}-${invalidGroup.maxSelections} option(s) for ${invalidGroup.name}.`,
      );
      return;
    }
    setPending(true);
    setError('');
    try {
      await onAdd(quantity, selectedOptionIds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add this item.');
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="menu-item-row">
      <div>
        <h3>{item.name}</h3>
        {item.description && <p>{item.description}</p>}
        {item.dietaryTags.length > 0 && (
          <p className="dietary-tags">{item.dietaryTags.join(' · ')}</p>
        )}
        {item.optionGroups.map((group) => (
          <fieldset className="menu-option-group" key={group.id}>
            <legend>
              {group.name}
              {group.minSelections > 0 ? ' (required)' : ' (optional)'}
            </legend>
            {group.maxSelections === 1 && group.minSelections === 0 && (
              <label>
                <input
                  type="radio"
                  name={`${item.id}-${group.id}`}
                  checked={(selectedByGroup[group.id] ?? []).length === 0}
                  onChange={() => setSelectedByGroup((current) => ({ ...current, [group.id]: [] }))}
                />
                No selection
              </label>
            )}
            {group.options.map((option) => (
              <label key={option.id}>
                <input
                  type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                  name={`${item.id}-${group.id}`}
                  checked={selectedByGroup[group.id]?.includes(option.id) ?? false}
                  disabled={
                    group.maxSelections > 1 &&
                    (selectedByGroup[group.id]?.length ?? 0) >= group.maxSelections &&
                    !selectedByGroup[group.id]?.includes(option.id)
                  }
                  onChange={(event) => {
                    if (group.maxSelections === 1) {
                      setSelectedByGroup((current) => ({ ...current, [group.id]: [option.id] }));
                    } else {
                      selectOption(group.id, option.id, event.target.checked);
                    }
                  }}
                />
                {option.name}
                {option.priceDeltaMinor ? ` +${price(option.priceDeltaMinor, item.currency)}` : ''}
              </label>
            ))}
          </fieldset>
        ))}
        {error && (
          <p className="form-message form-error" role="alert">
            {error}
            {error === 'Sign in before adding items to your cart.' && (
              <> <Link href={loginHref}>Sign in</Link> to continue.</>
            )}
            {error === 'Your cart has items from another restaurant.' && (
              <> <Link href="/cart">Clear your cart</Link> before ordering here.</>
            )}
          </p>
        )}
      </div>
      <div className="menu-item-actions">
        <strong>{price(unitPrice, item.currency)}</strong>
        <label className="quantity-control">
          <span>Quantity</span>
          <input
            type="number"
            min="1"
            max="99"
            value={quantity}
            onChange={(event) =>
              setQuantity(Math.max(1, Math.min(99, Number(event.target.value) || 1)))
            }
          />
        </label>
        <button
          className="button button-small"
          type="button"
          disabled={!acceptingOrders || pending}
          onClick={() => void addToCart()}
        >
          {pending ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
    </article>
  );
}

export function RestaurantMenu({ restaurantId }: { restaurantId: string }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [reviews, setReviews] = useState<RestaurantReview[]>([]);
  const [reportingReviewId, setReportingReviewId] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [reviewNotice, setReviewNotice] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cartMessage, setCartMessage] = useState('');
  const [groupOrderId, setGroupOrderId] = useState('');

  useEffect(() => {
    setGroupOrderId(new URLSearchParams(window.location.search).get('groupOrderId') ?? '');
  }, []);

  useEffect(() => {
    let current = true;
    fetch(`${apiBase}/restaurants/${encodeURIComponent(restaurantId)}/menu`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Restaurant not found.');
        const result = (await response.json()) as { data: Menu };
        if (current) setMenu(result.data);
      })
      .catch(() => {
        if (current) setError('This restaurant could not be loaded.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [restaurantId]);

  useEffect(() => {
    let current = true;
    fetch(`${apiBase}/restaurants/${encodeURIComponent(restaurantId)}/reviews`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Reviews are temporarily unavailable.');
        const result = (await response.json()) as { data: RestaurantReview[] };
        if (current) setReviews(result.data);
      })
      .catch(() => {
        if (current) setReviewError('Reviews are temporarily unavailable.');
      });
    return () => {
      current = false;
    };
  }, [restaurantId]);

  async function reportReview(event: React.FormEvent<HTMLFormElement>, reviewId: string) {
    event.preventDefault();
    setReviewError('');
    setReviewNotice('');
    const response = await fetch(`${apiBase}/reviews/${reviewId}/reports`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: reportReason }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!response.ok) {
      setReviewError(result.error?.message ?? 'Review could not be reported. Sign in and retry.');
      return;
    }
    setReportingReviewId('');
    setReportReason('');
    setReviewNotice('Report sent to our moderation team.');
  }

  async function addToCart(item: MenuItem, quantity: number, optionIds: string[]) {
    if (!menu) throw new Error('Menu is not ready.');
    if (groupOrderId) {
      const response = await fetch(`${apiBase}/group-orders/${groupOrderId}/items`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ menuItemId: item.id, quantity, optionIds }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not add this group item.');
      setCartMessage('Added to the shared group order.');
      return;
    }
    let cartResponse = await fetch(`${apiBase}/carts`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (cartResponse.status === 401) throw new Error('Sign in before adding items to your cart.');
    if (!cartResponse.ok) throw new Error('Could not load your cart.');
    const existing = (await cartResponse.json()) as {
      data: Array<{ id: string; restaurantId: string }>;
    };
    let cart = existing.data[0];
    if (cart && cart.restaurantId !== menu.id) {
      throw new Error('Your cart has items from another restaurant.');
    }
    if (!cart) {
      cartResponse = await fetch(`${apiBase}/carts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restaurantId: menu.id }),
      });
      const envelope = (await cartResponse.json().catch(() => ({}))) as {
        data?: { id: string };
        error?: { message?: string };
      };
      if (!cartResponse.ok)
        throw new Error(envelope.error?.message ?? 'Could not create your cart.');
      cart = { ...envelope.data!, restaurantId: menu.id };
    }
    const response = await fetch(`${apiBase}/carts/${cart.id}/items`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ menuItemId: item.id, quantity, optionIds }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? 'Could not add this item.');
    setCartMessage('Added to your cart.');
  }

  const loginHref = `/login?returnTo=${encodeURIComponent(`/restaurants/${restaurantId}`)}`;

  return (
    <main className="market-page">
      <nav className="top-nav" aria-label="Restaurant navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <Link href="/restaurants">All restaurants</Link>
        <Link href="/cart">Your cart</Link>
        <Link href={groupOrderId ? `/group-orders?groupOrderId=${encodeURIComponent(groupOrderId)}` : '/group-orders'}>
          {groupOrderId ? 'Back to group order' : 'Group order'}
        </Link>
        <Link href="/account">Your account</Link>
        <Link href="/support">Reviews & support</Link>
      </nav>
      {loading && <p role="status">Loading menu…</p>}
      {error && (
        <section className="menu-status">
          <h1>Restaurant unavailable</h1>
          <p>{error}</p>
        </section>
      )}
      {cartMessage && (
        <p className="form-message" role="status">
          {cartMessage}
        </p>
      )}
      {groupOrderId && <p className="form-message">Adding items to a shared group order.</p>}
      {menu && (
        <>
          <header className="restaurant-detail-heading">
            <p className="eyebrow">
              {menu.city}, {menu.state}
            </p>
            <h1>{menu.name}</h1>
            {menu.description && <p>{menu.description}</p>}
            <p className={menu.isAcceptingOrders ? 'availability-open' : 'availability-closed'}>
              {menu.isAcceptingOrders ? 'Taking orders' : 'Not taking orders right now'}
            </p>
          </header>
          {menu.categories.map((category) => (
            <section className="menu-section" key={category.id}>
              <div className="menu-section-heading">
                <h2>{category.name}</h2>
                {category.description && <p>{category.description}</p>}
              </div>
              {category.items.map((item) => (
                <MenuItemRow
                  item={item}
                  key={item.id}
                  acceptingOrders={menu.isAcceptingOrders}
                  loginHref={loginHref}
                  onAdd={(quantity, optionIds) => addToCart(item, quantity, optionIds)}
                />
              ))}
              {category.items.length === 0 && (
                <p className="market-empty">No available items in this section.</p>
              )}
            </section>
          ))}
          {menu.items.map((item) => (
            <MenuItemRow
              item={item}
              key={item.id}
              acceptingOrders={menu.isAcceptingOrders}
              loginHref={loginHref}
              onAdd={(quantity, optionIds) => addToCart(item, quantity, optionIds)}
            />
          ))}
          <section className="restaurant-reviews" aria-labelledby="restaurant-reviews-heading">
            <div className="menu-section-heading">
              <p className="eyebrow">From diners</p>
              <h2 id="restaurant-reviews-heading">Customer reviews</h2>
            </div>
            {(reviewError || reviewNotice) && (
              <p
                className={`form-message ${reviewError ? 'form-error' : ''}`}
                role={reviewError ? 'alert' : 'status'}
              >
                {reviewError || reviewNotice}
              </p>
            )}
            {reviews.map((review) => (
              <article className="restaurant-review" key={review.id}>
                <div className="restaurant-review-heading">
                  <div>
                    <h3>{review.title}</h3>
                    <p>
                      Verified diner · {review.rating}/5 ·{' '}
                      {new Date(review.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    className="review-report-button"
                    onClick={() => {
                      setReportingReviewId(reportingReviewId === review.id ? '' : review.id);
                      setReviewError('');
                    }}
                    type="button"
                  >
                    Report
                  </button>
                </div>
                <p>{review.body}</p>
                {reportingReviewId === review.id && (
                  <form
                    className="review-report-form"
                    onSubmit={(event) => void reportReview(event, review.id)}
                  >
                    <label className="form-field">
                      Why should this review be checked?
                      <textarea
                        maxLength={500}
                        minLength={10}
                        onChange={(event) => setReportReason(event.target.value)}
                        required
                        rows={2}
                        value={reportReason}
                      />
                    </label>
                    <button className="secondary-button" type="submit">
                      Send report
                    </button>
                  </form>
                )}
              </article>
            ))}
            {!reviews.length && !reviewError && (
              <p className="market-empty">No published reviews yet.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
