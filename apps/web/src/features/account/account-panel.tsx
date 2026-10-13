'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roles: Array<{ role: string; scopeType: string; scopeId: string | null }>;
}

interface Address {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

interface CustomerOrder {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  restaurant: { name: string };
}

function money(minor: number, currency: string) {
  const fractionDigits =
    new Intl.NumberFormat('en-IN', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(
    minor / 10 ** fractionDigits,
  );
}

export function AccountPanel() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadAccount() {
    setLoading(true);
    setError('');
    try {
      const [profileResult, addressResult, orderResult] = await Promise.all([
        fetch(`${apiBase}/me`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${apiBase}/addresses`, { credentials: 'include', cache: 'no-store' }),
        fetch(`${apiBase}/orders`, { credentials: 'include', cache: 'no-store' }),
      ]);
      if ([profileResult, addressResult, orderResult].some(({ status }) => status === 401)) {
        setProfile(null);
        return;
      }
      if (!profileResult.ok || !addressResult.ok || !orderResult.ok)
        throw new Error('Unable to load account details.');
      const [profileEnvelope, addressEnvelope, orderEnvelope] = await Promise.all([
        profileResult.json() as Promise<{ data: Profile }>,
        addressResult.json() as Promise<{ data: Address[] }>,
        orderResult.json() as Promise<{ data: CustomerOrder[] }>,
      ]);
      setProfile(profileEnvelope.data);
      setAddresses(addressEnvelope.data);
      setOrders(orderEnvelope.data);
    } catch {
      setError('The account service could not be reached. Retry in a moment.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccount();
  }, []);

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiBase}/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.get('name') }),
      });
      if (!response.ok) throw new Error('Unable to save profile.');
      setProfile((current) => (current ? { ...current, name: String(form.get('name')) } : current));
      setMessage('Profile saved.');
    } catch {
      setError('The profile could not be saved. Retry.');
    } finally {
      setPending(false);
    }
  }

  async function addAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const addressForm = event.currentTarget;
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(addressForm);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`${apiBase}/addresses`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Unable to save address.');
      addressForm.reset();
      await loadAccount();
      setMessage('Address saved.');
    } catch {
      setError('The address could not be saved. Check the details and retry.');
    } finally {
      setPending(false);
    }
  }

  async function removeAddress(id: string) {
    setPending(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/addresses/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unable to remove address.');
      await loadAccount();
      setMessage('Address removed.');
    } catch {
      setError('The address could not be removed. Retry.');
    } finally {
      setPending(false);
    }
  }

  async function setDefaultAddress(id: string) {
    setPending(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/addresses/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (!response.ok) throw new Error('Unable to update default address.');
      await loadAccount();
      setMessage('Default address updated.');
    } catch {
      setError('The default address could not be updated. Retry.');
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.replace('/login');
  }

  if (loading) {
    return (
      <main className="account-page">
        <p role="status">Loading account…</p>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="account-page">
        <nav className="top-nav">
          <Link className="wordmark" href="/">
            Urban Spoon
          </Link>
        </nav>
        <section className="account-panel">
          <h1>Sign in to your account</h1>
          <p className="account-description">
            Your profile and addresses are available after sign-in.
          </p>
          <Link className="button" href="/login">
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="account-page">
      <nav className="top-nav" aria-label="Account navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <Link href="/restaurants">Browse restaurants</Link>
        <Link href="/cart">Your cart</Link>
        <Link href="/loyalty">FoodCoins</Link>
        <Link href="/membership">FoodPass</Link>
        <Link href="/support">Reviews & support</Link>
        <button className="secondary-button" type="button" onClick={signOut}>
          Sign out
        </button>
      </nav>
      <section className="account-panel" aria-labelledby="account-title">
        <div className="account-heading">
          <div>
            <p className="eyebrow">Your account</p>
            <h1 id="account-title">Profile and addresses</h1>
          </div>
        </div>
        {error && (
          <p className="form-message form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="form-message" role="status">
            {message}
          </p>
        )}
        <section className="account-section" aria-labelledby="profile-heading">
          <h2 id="profile-heading">Profile</h2>
          <form className="form-stack" onSubmit={updateProfile}>
            <label className="form-field">
              Name
              <input
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={80}
                defaultValue={profile.name}
                required
              />
            </label>
            <label className="form-field">
              Email
              <input type="email" value={profile.email} readOnly />
            </label>
            <button className="button" type="submit" disabled={pending}>
              Save profile
            </button>
          </form>
        </section>
        <section className="account-section" aria-labelledby="orders-heading">
          <h2 id="orders-heading">Your orders</h2>
          {orders.length ? (
            <ul className="address-list">
              {orders.map((order) => (
                <li className="address-item" key={order.id}>
                  <div>
                    <strong>{order.restaurant.name}</strong>
                    <p>
                      Order {order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div>
                    <strong>{money(order.totalMinor, order.currency)}</strong>
                    <p>{order.status.replaceAll('_', ' ').toLowerCase()}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-description">
              No orders yet. <Link href="/restaurants">Browse restaurants</Link> to get started.
            </p>
          )}
        </section>
        <section className="account-section" aria-labelledby="addresses-heading">
          <h2 id="addresses-heading">Delivery addresses</h2>
          {addresses.length ? (
            <ul className="address-list">
              {addresses.map((address) => (
                <li className="address-item" key={address.id}>
                  <div>
                    <strong>
                      {address.label}
                      {address.isDefault ? ' · Default' : ''}
                    </strong>
                    <p>
                      {address.line1}
                      {address.line2 ? `, ${address.line2}` : ''}
                      <br />
                      {address.city}, {address.state} {address.postalCode}
                    </p>
                  </div>
                  <div className="address-actions">
                    {!address.isDefault && (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={pending}
                        onClick={() => void setDefaultAddress(address.id)}
                      >
                        Make default
                      </button>
                    )}
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={pending}
                      onClick={() => void removeAddress(address.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-description">No saved addresses yet.</p>
          )}
          <form className="form-stack" onSubmit={addAddress}>
            <label className="form-field">
              Label
              <input name="label" maxLength={40} placeholder="Home" required />
            </label>
            <label className="form-field">
              Address line
              <input name="line1" maxLength={160} autoComplete="street-address" required />
            </label>
            <label className="form-field">
              Apartment or unit
              <input name="line2" maxLength={160} />
            </label>
            <label className="form-field">
              City
              <input name="city" maxLength={80} autoComplete="address-level2" required />
            </label>
            <label className="form-field">
              State
              <input name="state" maxLength={80} autoComplete="address-level1" required />
            </label>
            <label className="form-field">
              Postal code
              <input
                name="postalCode"
                pattern="[A-Za-z0-9 -]{3,12}"
                autoComplete="postal-code"
                required
              />
            </label>
            <button className="button" type="submit" disabled={pending}>
              Add address
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
