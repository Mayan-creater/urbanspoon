'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SmartCartAssistant } from '../ai/smart-cart-assistant';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface CartOption {
  id: string;
  name: string;
  priceDeltaMinor: number;
}

interface CartOptionGroup {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  options: CartOption[];
}

interface CartLine {
  id: string;
  quantity: number;
  menuItem: {
    id: string;
    name: string;
    description: string | null;
    priceMinor: number;
    currency: string;
    isAvailable: boolean;
    archivedAt: string | null;
    optionGroups: CartOptionGroup[];
  };
  selections: Array<{
    optionId: string;
    groupNameSnapshot: string;
    optionNameSnapshot: string;
    priceDeltaMinorSnapshot: number;
  }>;
}

interface Cart {
  id: string;
  currency: string;
  restaurant: { id: string; name: string; status: string; isAcceptingOrders: boolean };
  items: CartLine[];
}

interface Address {
  id: string;
  label: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
}

interface CheckoutPreview {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  feesMinor: number;
  taxMinor: number;
  tipMinor: number;
  totalMinor: number;
  coupon: { code: string; discountMinor: number } | null;
  loyaltyRedemption: { points: number; discountMinor: number } | null;
  charges: Array<{
    type: string;
    amountMinor: number;
    ruleId: string | null;
    ruleVersion: number | null;
  }>;
}

interface PlacedOrder {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
}

interface CheckoutIntent {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
  order: { id: string; status: string } | null;
}

const sandboxCheckoutEnabled = process.env.NODE_ENV !== 'production';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Request failed.');
  return envelope.data as T;
}

function currencyFractionDigits(currency: string) {
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency });
  return formatter.resolvedOptions().maximumFractionDigits ?? 2;
}

function money(minor: number, currency: string) {
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency });
  const scale = 10 ** currencyFractionDigits(currency);
  return formatter.format(minor / scale);
}

function toMinorUnits(amount: number, currency: string) {
  return Math.round(amount * 10 ** currencyFractionDigits(currency));
}

function CartLineEditor({
  line,
  currency,
  pending,
  onSave,
  onRemove,
}: {
  line: CartLine;
  currency: string;
  pending: boolean;
  onSave: (quantity: number, optionIds: string[]) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(line.quantity);
  const availableOptionIds = new Set(
    line.menuItem.optionGroups.flatMap((group) => group.options.map(({ id }) => id)),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    line.selections
      .map(({ optionId }) => optionId)
      .filter((optionId) => availableOptionIds.has(optionId)),
  );
  const [message, setMessage] = useState('');

  function choose(group: CartOptionGroup, optionId: string, selected: boolean) {
    setSelectedIds((current) => {
      const groupIds = new Set(group.options.map(({ id }) => id));
      const kept = current.filter((id) => !groupIds.has(id));
      if (!selected) return kept;
      if (group.maxSelections === 1) return [...kept, optionId];
      return [...current, optionId];
    });
  }

  async function save() {
    const invalidGroup = line.menuItem.optionGroups.find((group) => {
      const count = group.options.filter(({ id }) => selectedIds.includes(id)).length;
      return count < group.minSelections || count > group.maxSelections;
    });
    if (invalidGroup) {
      setMessage(
        `Choose ${invalidGroup.minSelections}-${invalidGroup.maxSelections} option(s) for ${invalidGroup.name}.`,
      );
      return;
    }
    setMessage('');
    await onSave(quantity, selectedIds);
  }

  const optionTotal = line.menuItem.optionGroups
    .flatMap(({ options }) => options)
    .filter(({ id }) => selectedIds.includes(id))
    .reduce((total, option) => total + option.priceDeltaMinor, 0);
  const unitTotal = line.menuItem.priceMinor + optionTotal;

  return (
    <article className="cart-line">
      <div className="cart-line-heading">
        <div>
          <h2>{line.menuItem.name}</h2>
          {line.menuItem.description && <p>{line.menuItem.description}</p>}
          {!line.menuItem.isAvailable && (
            <p className="form-message form-error">Currently unavailable</p>
          )}
        </div>
        <strong>{money(unitTotal * quantity, currency)}</strong>
      </div>
      {line.menuItem.optionGroups.map((group) => (
        <fieldset className="cart-option-group" key={group.id}>
          <legend>
            {group.name}
            {group.minSelections ? ' (required)' : ' (optional)'}
          </legend>
          {group.maxSelections === 1 && group.minSelections === 0 && (
            <label>
              <input
                type="radio"
                name={`${line.id}-${group.id}`}
                checked={!group.options.some(({ id }) => selectedIds.includes(id))}
                onChange={() => choose(group, '', false)}
              />
              No selection
            </label>
          )}
          {group.options.map((option) => (
            <label key={option.id}>
              <input
                type={group.maxSelections === 1 ? 'radio' : 'checkbox'}
                name={`${line.id}-${group.id}`}
                checked={selectedIds.includes(option.id)}
                onChange={(event) => choose(group, option.id, event.target.checked)}
              />
              {option.name}
              {option.priceDeltaMinor ? ` +${money(option.priceDeltaMinor, currency)}` : ''}
            </label>
          ))}
        </fieldset>
      ))}
      <div className="cart-line-actions">
        <label className="form-field cart-quantity">
          Quantity
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
          className="secondary-button"
          type="button"
          disabled={pending}
          onClick={() => void save()}
        >
          Save changes
        </button>
        <button
          className="text-button"
          type="button"
          disabled={pending}
          onClick={() => void onRemove()}
        >
          Remove
        </button>
        {message && (
          <span className="form-message form-error" role="alert">
            {message}
          </span>
        )}
      </div>
    </article>
  );
}

export function CartPanel() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [couponMessage, setCouponMessage] = useState('');
  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [tipBasisPoints, setTipBasisPoints] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  const [cartClearWarning, setCartClearWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState('');
  const checkoutKeys = useRef<{
    body: string;
    intent: string;
    payment: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [carts, savedAddresses] = await Promise.all([
        request<Cart[]>('/carts'),
        request<Address[]>('/addresses'),
      ]);
      setCart(carts[0] ?? null);
      setAddresses(savedAddresses);
      setAddressId(
        (current) => current || savedAddresses.find(({ isDefault }) => isDefault)?.id || '',
      );
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'Unauthorized') {
        setSignedOut(true);
      } else {
        setError(cause instanceof Error ? cause.message : 'Unable to load your cart.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshCart() {
    const carts = await request<Cart[]>('/carts');
    setCart(carts[0] ?? null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveLine(line: CartLine, quantity: number, optionIds: string[]) {
    if (!cart) return;
    setPending(true);
    setError('');
    setPreview(null);
    try {
      const updated = await request<Cart>(`/carts/${cart.id}/items/${line.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity, optionIds }),
      });
      setCart(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update this item.');
    } finally {
      setPending(false);
    }
  }

  async function removeLine(lineId: string) {
    if (!cart) return;
    setPending(true);
    setError('');
    setPreview(null);
    try {
      await request(`/carts/${cart.id}/items/${lineId}`, { method: 'DELETE' });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove this item.');
    } finally {
      setPending(false);
    }
  }

  async function clearCart() {
    if (!cart) return;
    setPending(true);
    setError('');
    try {
      await request(`/carts/${cart.id}`, { method: 'DELETE' });
      setCart(null);
      setPreview(null);
      setCouponMessage('');
      setLoyaltyPoints('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to clear the cart.');
    } finally {
      setPending(false);
    }
  }

  function checkoutInput() {
    return {
      cartId: cart!.id,
      ...(addressId ? { addressId } : {}),
      ...(couponCode.trim() ? { couponCode: couponCode.trim().toUpperCase() } : {}),
      ...(Number(loyaltyPoints) > 0 ? { loyaltyPoints: Number(loyaltyPoints) } : {}),
      ...(tipBasisPoints !== null ? { tipBasisPoints } : {}),
      ...(tipBasisPoints === null && Number(customTip) > 0 && cart
        ? { customTipMinor: toMinorUnits(Number(customTip), cart.currency) }
        : {}),
    };
  }

  async function validateCoupon() {
    if (!cart || !couponCode.trim()) {
      setCouponMessage('Enter a coupon code first.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await request<{ code: string; discountMinor: number; currency: string }>(
        '/promotions/validate',
        { method: 'POST', body: JSON.stringify(checkoutInput()) },
      );
      setCouponMessage(
        `${result.code} applied: ${money(result.discountMinor, result.currency)} off.`,
      );
    } catch (cause) {
      setCouponMessage(cause instanceof Error ? cause.message : 'Coupon could not be applied.');
    } finally {
      setPending(false);
    }
  }

  async function previewCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart) return;
    setPending(true);
    setError('');
    try {
      setPreview(
        await request<CheckoutPreview>('/checkout/preview', {
          method: 'POST',
          body: JSON.stringify(checkoutInput()),
        }),
      );
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : 'Unable to calculate checkout totals.');
    } finally {
      setPending(false);
    }
  }

  async function placeTestOrder() {
    if (!cart || !preview) return;
    setPending(true);
    setError('');
    const requestBody = JSON.stringify(checkoutInput());
    const keys =
      checkoutKeys.current?.body === requestBody
        ? checkoutKeys.current
        : {
            body: requestBody,
            intent: globalThis.crypto.randomUUID(),
            payment: globalThis.crypto.randomUUID(),
          };
    checkoutKeys.current = keys;
    try {
      const intent = await request<CheckoutIntent>('/orders/intents', {
        method: 'POST',
        headers: { 'idempotency-key': keys.intent },
        body: requestBody,
      });
      if (intent.order) {
        await showPlacedOrder({ ...intent.order, totalMinor: intent.totalMinor, currency: intent.currency });
        return;
      }
      await request(`/orders/intents/${intent.id}/payment-attempts`, {
        method: 'POST',
        headers: { 'idempotency-key': keys.payment },
      });
      const result = await request<{ order?: PlacedOrder }>(
        `/orders/intents/${intent.id}/sandbox-payment`,
        { method: 'POST', body: JSON.stringify({ outcome: 'SUCCEEDED' }) },
      );
      if (!result.order) {
        throw new Error('The test payment completed, but the order could not be confirmed.');
      }
      await showPlacedOrder(result.order);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to place this test order.');
    } finally {
      setPending(false);
    }
  }

  async function showPlacedOrder(order: PlacedOrder) {
    if (!cart) return;
    setPlacedOrder(order);
    setCart(null);
    setPreview(null);
    checkoutKeys.current = null;
    try {
      await request(`/carts/${cart.id}`, { method: 'DELETE' });
    } catch {
      setCartClearWarning('Your order is confirmed, but the remaining cart could not be cleared.');
    }
  }

  if (loading) {
    return (
      <main className="cart-page">
        <p role="status">Loading your cart…</p>
      </main>
    );
  }

  return (
    <main className="cart-page">
      <nav className="top-nav" aria-label="Cart navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <Link href="/restaurants">Continue browsing</Link>
        <Link href="/group-orders">Group order</Link>
        <Link href="/account">Your account</Link>
      </nav>
      <header className="cart-heading">
        <p className="eyebrow">Your order</p>
        <h1>{placedOrder ? 'Order confirmation' : 'Cart and checkout preview'}</h1>
      </header>
      {error && (
        <p className="form-message form-error" role="alert">
          {error}
        </p>
      )}
      {signedOut && (
        <section className="cart-empty">
          <h2>Sign in to see your cart</h2>
          <Link className="button" href="/login">
            Sign in
          </Link>
        </section>
      )}
      {placedOrder && (
        <section className="cart-empty" role="status">
          <h2>Test order confirmed</h2>
          <p>Order ID: {placedOrder.id}</p>
          <p>
            {placedOrder.status.replaceAll('_', ' ')} · {money(placedOrder.totalMinor, placedOrder.currency)}
          </p>
          <p>No real payment was collected. This was a local sandbox order.</p>
          {cartClearWarning && <p className="form-message form-error">{cartClearWarning}</p>}
          <Link className="button" href="/restaurants">
            Browse restaurants
          </Link>
        </section>
      )}
      {!signedOut && !cart && !placedOrder && (
        <section className="cart-empty">
          <h2>Your cart is empty</h2>
          <Link className="button" href="/restaurants">
            Browse restaurants
          </Link>
        </section>
      )}
      {!signedOut && cart && (
        <div className="cart-layout">
          <section className="cart-lines" aria-label="Cart items">
            <div className="cart-restaurant-heading">
              <div>
                <p className="eyebrow">Restaurant</p>
                <h2>{cart.restaurant.name}</h2>
              </div>
              <button
                className="text-button"
                type="button"
                disabled={pending}
                onClick={() => void clearCart()}
              >
                Clear cart
              </button>
            </div>
            {cart.items.map((line) => (
              <CartLineEditor
                key={line.id}
                line={line}
                currency={cart.currency}
                pending={pending}
                onSave={(quantity, optionIds) => saveLine(line, quantity, optionIds)}
                onRemove={() => removeLine(line.id)}
              />
            ))}
            {cart.items.length === 0 && <p className="market-empty">Your cart is empty.</p>}
          </section>
          <aside className="checkout-panel" aria-labelledby="checkout-heading">
            <h2 id="checkout-heading">Checkout preview</h2>
            {cart.items.length > 0 && (
              <SmartCartAssistant
                cartId={cart.id}
                restaurant={cart.restaurant}
                onCartUpdated={refreshCart}
              />
            )}
            {addresses.length > 0 ? (
              <label className="form-field">
                Delivery address
                <select
                  value={addressId}
                  onChange={(event) => {
                    setAddressId(event.target.value);
                    setPreview(null);
                  }}
                >
                  <option value="">Choose an address</option>
                  {addresses.map((address) => (
                    <option value={address.id} key={address.id}>
                      {address.label} · {address.line1}, {address.city}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="checkout-note">
                Add a saved address in your <Link href="/account">account</Link> to check delivery
                serviceability.
              </p>
            )}
            <div className="coupon-entry">
              <label className="form-field">
                Coupon code
                <input
                  value={couponCode}
                  disabled={Boolean(loyaltyPoints.trim())}
                  onChange={(event) => {
                    setCouponCode(event.target.value);
                    setCouponMessage('');
                    setPreview(null);
                  }}
                  maxLength={40}
                />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={pending || !couponCode.trim()}
                onClick={() => void validateCoupon()}
              >
                Apply
              </button>
            </div>
            <label className="form-field">
              FoodCoins to redeem
              <input
                disabled={Boolean(couponCode.trim())}
                inputMode="numeric"
                min="1"
                max="1000000"
                onChange={(event) => {
                  setLoyaltyPoints(event.target.value);
                  setPreview(null);
                  setCouponMessage('');
                }}
                step="1"
                type="number"
                value={loyaltyPoints}
              />
            </label>
            <p className="checkout-note">Use a coupon code or FoodCoins on an order, not both.</p>
            {couponMessage && (
              <p className="form-message" role="status">
                {couponMessage}
              </p>
            )}
            <fieldset className="cart-option-group checkout-tip-options">
              <legend>Courier tip</legend>
              <label>
                <input
                  checked={tipBasisPoints === null && !customTip}
                  name="courier-tip"
                  onChange={() => {
                    setTipBasisPoints(null);
                    setCustomTip('');
                    setPreview(null);
                  }}
                  type="radio"
                />
                No tip
              </label>
              {[
                { label: '5%', basisPoints: 500 },
                { label: '10%', basisPoints: 1000 },
                { label: '15%', basisPoints: 1500 },
              ].map(({ label, basisPoints }) => (
                <label key={basisPoints}>
                  <input
                    checked={tipBasisPoints === basisPoints}
                    name="courier-tip"
                    onChange={() => {
                      setTipBasisPoints(basisPoints);
                      setCustomTip('');
                      setPreview(null);
                    }}
                    type="radio"
                  />
                  {label}
                </label>
              ))}
              <label className="form-field">
                Custom amount ({cart.currency})
                <input
                  inputMode="decimal"
                  min="0"
                  onChange={(event) => {
                    setCustomTip(event.target.value);
                    setTipBasisPoints(null);
                    setPreview(null);
                  }}
                  step={1 / 10 ** currencyFractionDigits(cart.currency)}
                  type="number"
                  value={customTip}
                />
              </label>
            </fieldset>
            <form onSubmit={previewCheckout}>
              <button
                className="button checkout-preview-button"
                type="submit"
                disabled={pending || cart.items.length === 0}
              >
                {pending ? 'Calculating…' : 'Recalculate total'}
              </button>
            </form>
            {preview && (
              <dl className="checkout-totals">
                <div>
                  <dt>Items</dt>
                  <dd>{money(preview.subtotalMinor, preview.currency)}</dd>
                </div>
                {preview.discountMinor > 0 && (
                  <div>
                    <dt>
                      {preview.coupon
                        ? `Coupon (${preview.coupon.code})`
                        : `${preview.loyaltyRedemption?.points ?? 0} FoodCoins`}
                    </dt>
                    <dd>-{money(preview.discountMinor, preview.currency)}</dd>
                  </div>
                )}
                {preview.charges
                  .filter((charge) =>
                    ['DELIVERY_FEE', 'PACKAGING_FEE', 'SERVICE_FEE', 'COURIER_TIP'].includes(
                      charge.type,
                    ),
                  )
                  .map((charge) => (
                    <div key={charge.type}>
                      <dt>{charge.type.replaceAll('_', ' ').toLowerCase()}</dt>
                      <dd>{money(charge.amountMinor, preview.currency)}</dd>
                    </div>
                  ))}
                <div>
                  <dt>Tax</dt>
                  <dd>{money(preview.taxMinor, preview.currency)}</dd>
                </div>
                <div className="checkout-grand-total">
                  <dt>Total</dt>
                  <dd>{money(preview.totalMinor, preview.currency)}</dd>
                </div>
              </dl>
            )}
            {sandboxCheckoutEnabled && preview && (
              <>
                <p className="checkout-note">
                  Local sandbox only: this simulates successful payment and does not charge money.
                </p>
                <button
                  className="button"
                  type="button"
                  disabled={pending}
                  onClick={() => void placeTestOrder()}
                >
                  {pending ? 'Placing test order…' : 'Place test order'}
                </button>
              </>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
