'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MenuDraftAssistant } from '../ai/menu-draft-assistant';
import type { MenuDraft } from '../ai/menu-draft-assistant';
import { RestaurantInsights } from '../ai/restaurant-insights';
import { CateringProvider } from '../catering/catering-provider';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface Restaurant {
  id: string;
  name: string;
  city: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  supportsCatering: boolean;
  isAcceptingOrders: boolean;
  description: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string;
  state: string;
  postalCode: string;
  cuisineTypes: string[];
  latitude: number | null;
  longitude: number | null;
  serviceRadiusKm: number;
  estimatedEtaMinMinutes: number | null;
  estimatedEtaMaxMinutes: number | null;
  hours: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }>;
}

interface RestaurantOffer {
  id: string;
  title: string;
  description: string;
  terms: string | null;
  redemptionInstructions: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}

interface MenuItem {
  id: string;
  name: string;
  priceMinor: number;
  isAvailable: boolean;
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Category {
  id: string;
  name: string;
  isActive: boolean;
  items: MenuItem[];
}

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
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Request failed.');
  return envelope.data as T;
}

export function PartnerPanel() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [offers, setOffers] = useState<RestaurantOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemDietaryTags, setItemDietaryTags] = useState('');
  const selected = restaurants.find((restaurant) => restaurant.id === selectedId);

  async function loadRestaurants() {
    try {
      const results = await api<Restaurant[]>('/partner/restaurants');
      setRestaurants(results);
      setSelectedId((current) => current || results[0]?.id || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in to manage a restaurant.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMenu(id: string) {
    try {
      setCategories(await api<Category[]>(`/partner/restaurants/${id}/menu`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load menu.');
    }
  }

  async function loadOffers(id: string) {
    try {
      setOffers(await api<RestaurantOffer[]>(`/partner/restaurants/${id}/offers`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load restaurant offers.');
    }
  }

  useEffect(() => {
    void loadRestaurants();
  }, []);
  useEffect(() => {
    if (selectedId) {
      void loadMenu(selectedId);
      void loadOffers(selectedId);
    }
  }, [selectedId]);

  async function onboard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries(form.entries());
    body.cuisineTypes = String(body.cuisineTypes ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    for (const field of ['description', 'phone', 'email']) {
      if (!String(body[field] ?? '').trim()) delete body[field];
    }
    for (const field of ['latitude', 'longitude']) {
      if (!String(body[field] ?? '').trim()) delete body[field];
      else body[field] = Number(body[field]);
    }
    for (const field of ['estimatedEtaMinMinutes', 'estimatedEtaMaxMinutes']) {
      if (!String(body[field] ?? '').trim()) delete body[field];
      else body[field] = Number(body[field]);
    }
    body.serviceRadiusKm = Number(body.serviceRadiusKm || 10);
    try {
      const created = await api<Restaurant>('/partner/restaurants', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await loadRestaurants();
      setSelectedId(created.id);
      setMessage('Restaurant submitted for review. You can prepare its menu while it is pending.');
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit restaurant.');
    } finally {
      setPending(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${selected.id}/menu/categories`, {
        method: 'POST',
        body: JSON.stringify({ name: new FormData(form).get('name') }),
      });
      form.reset();
      await loadMenu(selected.id);
      setMessage('Menu section added.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add section.');
    } finally {
      setPending(false);
    }
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const categoryId = String(values.get('categoryId') ?? '');
    const body = {
      name: values.get('name'),
      description: values.get('description'),
      priceMinor: Math.round(Number(values.get('price')) * 100),
      categoryId: categoryId || undefined,
      dietaryTags: String(values.get('dietaryTags') ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      optionGroups: (() => {
        const groupName = String(values.get('optionGroup') ?? '').trim();
        const options = String(values.get('options') ?? '')
          .split(',')
          .map((entry) => {
            const [name, priceMinor = '0'] = entry.split(':');
            return { name: name.trim(), priceDeltaMinor: Number(priceMinor.trim()) || 0 };
          })
          .filter((option) => option.name);
        return groupName && options.length
          ? [
              {
                name: groupName,
                minSelections: Number(values.get('optionRequired')),
                maxSelections: 1,
                options,
              },
            ]
          : [];
      })(),
    };
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${selected.id}/menu/items`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      form.reset();
      setItemName('');
      setItemDescription('');
      setItemDietaryTags('');
      await loadMenu(selected.id);
      setMessage('Menu item added.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add item.');
    } finally {
      setPending(false);
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    const optional = (name: string) => String(values.get(name) ?? '').trim() || undefined;
    setPending(true);
    setError('');
    try {
      const updated = await api<Restaurant>(`/partner/restaurants/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: values.get('name'),
          description: optional('description'),
          phone: optional('phone'),
          email: optional('email'),
          addressLine1: values.get('addressLine1'),
          city: values.get('city'),
          state: values.get('state'),
          postalCode: values.get('postalCode'),
          cuisineTypes: String(values.get('cuisineTypes') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          latitude: optional('latitude') ? Number(values.get('latitude')) : undefined,
          longitude: optional('longitude') ? Number(values.get('longitude')) : undefined,
          serviceRadiusKm: Number(values.get('serviceRadiusKm')),
          estimatedEtaMinMinutes: optional('estimatedEtaMinMinutes')
            ? Number(values.get('estimatedEtaMinMinutes'))
            : null,
          estimatedEtaMaxMinutes: optional('estimatedEtaMaxMinutes')
            ? Number(values.get('estimatedEtaMaxMinutes'))
            : null,
          isAcceptingOrders: values.get('isAcceptingOrders') === 'on',
        }),
      });
      setRestaurants((current) =>
        current.map((restaurant) =>
          restaurant.id === updated.id ? { ...updated, hours: selected.hours } : restaurant,
        ),
      );
      setMessage('Restaurant profile saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update profile.');
    } finally {
      setPending(false);
    }
  }

  async function createOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${selected.id}/offers`, {
        method: 'POST',
        body: JSON.stringify({
          title: values.get('title'),
          description: values.get('description'),
          terms: String(values.get('terms') ?? '').trim() || undefined,
          redemptionInstructions: values.get('redemptionInstructions'),
          validFrom: new Date(String(values.get('validFrom'))).toISOString(),
          validUntil: new Date(String(values.get('validUntil'))).toISOString(),
        }),
      });
      form.reset();
      await loadOffers(selected.id);
      setMessage('Offer published. It will appear while its validity window is active.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish offer.');
    } finally {
      setPending(false);
    }
  }

  async function disableOffer(offerId: string) {
    if (!selected) return;
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${selected.id}/offers/${offerId}/disable`, {
        method: 'POST',
      });
      await loadOffers(selected.id);
      setMessage('Offer disabled.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to disable offer.');
    } finally {
      setPending(false);
    }
  }

  async function updateHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const values = new FormData(event.currentTarget);
    const days = weekdays.map((_, dayOfWeek) => ({
      dayOfWeek,
      openTime: String(values.get(`open-${dayOfWeek}`)),
      closeTime: String(values.get(`close-${dayOfWeek}`)),
      isClosed: values.get(`closed-${dayOfWeek}`) === 'on',
    }));
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${selected.id}/hours`, {
        method: 'PUT',
        body: JSON.stringify({ days }),
      });
      await loadRestaurants();
      setMessage('Opening hours saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update opening hours.');
    } finally {
      setPending(false);
    }
  }

  async function setAvailability(item: MenuItem, isAvailable: boolean) {
    if (!selected) return;
    setPending(true);
    setError('');
    try {
      await api(`/partner/restaurants/${selected.id}/menu/items/${item.id}/availability`, {
        method: 'PUT',
        body: JSON.stringify({ isAvailable }),
      });
      await loadMenu(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change availability.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="partner-page">
      <nav className="top-nav" aria-label="Partner navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <Link href="/restaurants">Browse restaurants</Link>
      </nav>
      <header className="partner-heading">
        <p className="eyebrow">Restaurant workspace</p>
        <h1>Manage your kitchen.</h1>
        <p>Submit your restaurant, shape the menu, and keep availability current.</p>
      </header>
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
      {!loading && restaurants.length > 0 && (
        <label className="form-field partner-select">
          Restaurant
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {restaurants.map((restaurant) => (
              <option value={restaurant.id} key={restaurant.id}>
                {restaurant.name} · {restaurant.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <>
          <section className="partner-section">
            <h2>Restaurant profile</h2>
            <form className="partner-profile-form" key={selected.id} onSubmit={updateProfile}>
              <label className="form-field">
                Name
                <input name="name" defaultValue={selected.name} required maxLength={120} />
              </label>
              <label className="form-field">
                Contact email
                <input
                  name="email"
                  type="email"
                  defaultValue={selected.email ?? ''}
                  maxLength={254}
                />
              </label>
              <label className="form-field">
                Phone
                <input name="phone" defaultValue={selected.phone ?? ''} maxLength={30} />
              </label>
              <label className="form-field">
                Cuisine types
                <input name="cuisineTypes" defaultValue={selected.cuisineTypes.join(', ')} />
              </label>
              <label className="form-field">
                Street address
                <input
                  name="addressLine1"
                  defaultValue={selected.addressLine1}
                  required
                  maxLength={180}
                />
              </label>
              <label className="form-field">
                City
                <input name="city" defaultValue={selected.city} required maxLength={80} />
              </label>
              <label className="form-field">
                State
                <input name="state" defaultValue={selected.state} required maxLength={80} />
              </label>
              <label className="form-field">
                Postal code
                <input
                  name="postalCode"
                  defaultValue={selected.postalCode}
                  required
                  maxLength={12}
                />
              </label>
              <label className="form-field">
                Latitude
                <input
                  name="latitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any"
                  defaultValue={selected.latitude ?? ''}
                />
              </label>
              <label className="form-field">
                Longitude
                <input
                  name="longitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
                  defaultValue={selected.longitude ?? ''}
                />
              </label>
              <label className="form-field">
                Delivery radius (km)
                <input
                  name="serviceRadiusKm"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  defaultValue={selected.serviceRadiusKm ?? 10}
                  required
                />
              </label>
              <label className="form-field">
                Restaurant ETA minimum (minutes)
                <input
                  name="estimatedEtaMinMinutes"
                  type="number"
                  min="1"
                  max="240"
                  defaultValue={selected.estimatedEtaMinMinutes ?? ''}
                />
              </label>
              <label className="form-field">
                Restaurant ETA maximum (minutes)
                <input
                  name="estimatedEtaMaxMinutes"
                  type="number"
                  min="1"
                  max="240"
                  defaultValue={selected.estimatedEtaMaxMinutes ?? ''}
                />
              </label>
              <label className="form-field">
                Description
                <textarea
                  name="description"
                  defaultValue={selected.description ?? ''}
                  maxLength={1000}
                />
              </label>
              <label className="partner-toggle">
                <input
                  type="checkbox"
                  name="isAcceptingOrders"
                  defaultChecked={selected.isAcceptingOrders}
                  disabled={selected.status !== 'ACTIVE'}
                />{' '}
                Accepting orders
              </label>
              <button className="button" type="submit" disabled={pending}>
                Save profile
              </button>
            </form>
          </section>
          <section className="partner-section">
            <h2>Offers</h2>
            <form className="partner-offer-form" onSubmit={createOffer}>
              <label className="form-field">
                Offer title
                <input name="title" required minLength={3} maxLength={100} />
              </label>
              <label className="form-field">
                Redemption instructions
                <input
                  name="redemptionInstructions"
                  required
                  minLength={5}
                  maxLength={300}
                  placeholder="Show this offer when ordering"
                />
              </label>
              <label className="form-field">
                Description
                <textarea name="description" required minLength={5} maxLength={500} />
              </label>
              <label className="form-field">
                Terms
                <textarea name="terms" maxLength={500} />
              </label>
              <label className="form-field">
                Starts
                <input name="validFrom" type="datetime-local" required />
              </label>
              <label className="form-field">
                Ends
                <input name="validUntil" type="datetime-local" required />
              </label>
              <button className="button" type="submit" disabled={pending}>
                Publish offer
              </button>
            </form>
            <ul className="partner-offer-list">
              {offers.map((offer) => (
                <li className="partner-offer-row" key={offer.id}>
                  <span>
                    <strong>{offer.title}</strong>
                    <small>{offer.description}</small>
                    <small>
                      {new Date(offer.validFrom).toLocaleString()} to{' '}
                      {new Date(offer.validUntil).toLocaleString()} ·{' '}
                      {offer.isActive ? 'Enabled' : 'Disabled'}
                    </small>
                  </span>
                  {offer.isActive && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={pending}
                      onClick={() => void disableOffer(offer.id)}
                    >
                      Disable
                    </button>
                  )}
                </li>
              ))}
              {offers.length === 0 && <li className="market-empty">No offers configured.</li>}
            </ul>
          </section>
          <RestaurantInsights key={selected.id} restaurantId={selected.id} />
          <CateringProvider
            key={`catering-${selected.id}`}
            restaurantId={selected.id}
            enabled={selected.supportsCatering}
            active={selected.status === 'ACTIVE'}
            onEnabledChange={(enabled) => setRestaurants((current) => current.map((restaurant) =>
              restaurant.id === selected.id ? { ...restaurant, supportsCatering: enabled } : restaurant,
            ))}
          />
          <section className="partner-section">
            <h2>Opening hours</h2>
            <form className="partner-hours-form" onSubmit={updateHours}>
              {weekdays.map((weekday, dayOfWeek) => {
                const hours = selected.hours.find((entry) => entry.dayOfWeek === dayOfWeek);
                return (
                  <div className="partner-hours-row" key={weekday}>
                    <strong>{weekday}</strong>
                    <label className="form-field">
                      Opens
                      <input
                        type="time"
                        name={`open-${dayOfWeek}`}
                        defaultValue={hours?.openTime ?? '09:00'}
                      />
                    </label>
                    <label className="form-field">
                      Closes
                      <input
                        type="time"
                        name={`close-${dayOfWeek}`}
                        defaultValue={hours?.closeTime ?? '21:00'}
                      />
                    </label>
                    <label className="partner-toggle">
                      <input
                        type="checkbox"
                        name={`closed-${dayOfWeek}`}
                        defaultChecked={hours?.isClosed ?? true}
                      />{' '}
                      Closed
                    </label>
                  </div>
                );
              })}
              <button className="button" type="submit" disabled={pending}>
                Save hours
              </button>
            </form>
          </section>
          <section className="partner-section">
            <h2>Menu</h2>
            <form className="partner-inline-form" onSubmit={createCategory}>
              <label className="form-field">
                New section
                <input name="name" required maxLength={80} />
              </label>
              <button className="secondary-button" type="submit" disabled={pending}>
                Add section
              </button>
            </form>
            <MenuDraftAssistant
              key={selected.id}
              restaurantId={selected.id}
              onUseDraft={(draft: MenuDraft) => {
                setItemName(draft.name);
                setItemDescription(draft.description);
                setItemDietaryTags(draft.dietaryTags.join(', '));
                setMessage('Draft copied into the menu form. Review all details before adding it.');
              }}
            />
            <form className="partner-item-form" onSubmit={createItem}>
              <label className="form-field">
                Item name
                <input name="name" required maxLength={120} onChange={(event) => setItemName(event.target.value)} value={itemName} />
              </label>
              <label className="form-field">
                Price (INR)
                <input name="price" type="number" min="0" step="0.01" required />
              </label>
              <label className="form-field">
                Section
                <select name="categoryId" defaultValue="">
                  <option value="">Uncategorized</option>
                  {categories
                    .filter((category) => category.isActive)
                    .map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="form-field">
                Dietary tags
                <input name="dietaryTags" onChange={(event) => setItemDietaryTags(event.target.value)} placeholder="vegetarian, vegan" value={itemDietaryTags} />
              </label>
              <label className="form-field">
                Option group
                <input name="optionGroup" placeholder="Choose a size" />
              </label>
              <label className="form-field">
                Options
                <input
                  name="options"
                  placeholder="Regular:0, Large:250"
                  aria-label="Options with extra price in paise"
                />
              </label>
              <label className="form-field">
                Selection requirement
                <select name="optionRequired" defaultValue="0">
                  <option value="0">Optional</option>
                  <option value="1">Required</option>
                </select>
              </label>
              <label className="form-field partner-item-description">
                Description
                <textarea name="description" maxLength={1000} onChange={(event) => setItemDescription(event.target.value)} value={itemDescription} />
              </label>
              <button className="button" type="submit" disabled={pending}>
                Add menu item
              </button>
            </form>
            <div className="partner-menu-list">
              {categories.map((category) => (
                <section className="partner-category" key={category.id}>
                  <h3>{category.name}</h3>
                  {category.items.map((item) => (
                    <div className="partner-menu-item" key={item.id}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {(item.priceMinor / 100).toLocaleString('en-IN', {
                            style: 'currency',
                            currency: 'INR',
                          })}{' '}
                          · {item.isAvailable ? 'Available' : 'Unavailable'}
                        </small>
                      </span>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={pending}
                        onClick={() => void setAvailability(item, !item.isAvailable)}
                      >
                        {item.isAvailable ? 'Mark unavailable' : 'Mark available'}
                      </button>
                    </div>
                  ))}
                  {category.items.length === 0 && (
                    <p className="market-empty">No items in this section yet.</p>
                  )}
                </section>
              ))}
            </div>
          </section>
        </>
      )}
      <section className="partner-section onboarding-section">
        <h2>{restaurants.length ? 'Add another restaurant' : 'Submit your restaurant'}</h2>
        <form className="partner-onboarding-form" onSubmit={onboard}>
          <label className="form-field">
            Restaurant name
            <input name="name" required minLength={2} maxLength={120} />
          </label>
          <label className="form-field">
            Contact email
            <input name="email" type="email" maxLength={254} />
          </label>
          <label className="form-field">
            Phone
            <input name="phone" type="tel" maxLength={30} />
          </label>
          <label className="form-field">
            Cuisine types
            <input name="cuisineTypes" placeholder="Indian, South Indian" required />
          </label>
          <label className="form-field">
            Street address
            <input name="addressLine1" required maxLength={180} />
          </label>
          <label className="form-field">
            City
            <input name="city" required maxLength={80} />
          </label>
          <label className="form-field">
            State
            <input name="state" required maxLength={80} />
          </label>
          <label className="form-field">
            Postal code
            <input name="postalCode" required minLength={3} maxLength={12} />
          </label>
          <label className="form-field">
            Latitude
            <input name="latitude" type="number" min="-90" max="90" step="any" />
          </label>
          <label className="form-field">
            Longitude
            <input name="longitude" type="number" min="-180" max="180" step="any" />
          </label>
          <label className="form-field">
            Delivery radius (km)
            <input
              name="serviceRadiusKm"
              type="number"
              min="1"
              max="100"
              defaultValue="10"
              required
            />
          </label>
          <label className="form-field">
            Restaurant ETA minimum (minutes)
            <input name="estimatedEtaMinMinutes" type="number" min="1" max="240" />
          </label>
          <label className="form-field">
            Restaurant ETA maximum (minutes)
            <input name="estimatedEtaMaxMinutes" type="number" min="1" max="240" />
          </label>
          <label className="form-field">
            ETA minimum (minutes)
            <input name="estimatedEtaMinMinutes" type="number" min="1" max="240" />
          </label>
          <label className="form-field">
            ETA maximum (minutes)
            <input name="estimatedEtaMaxMinutes" type="number" min="1" max="240" />
          </label>
          <label className="form-field partner-item-description">
            Description
            <textarea name="description" maxLength={1000} />
          </label>
          <button className="button" type="submit" disabled={pending}>
            Submit for review
          </button>
        </form>
      </section>
    </main>
  );
}
