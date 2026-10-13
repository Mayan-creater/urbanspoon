'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface Restaurant {
  id: string;
  name: string;
  description: string | null;
  cuisineTypes: string[];
  city: string;
  state: string;
  isAcceptingOrders: boolean;
  distanceKm: number | null;
  minimumPriceMinor: number | null;
  matchedItems: Array<{ name: string; priceMinor: number; currency: string }>;
  ratingAverage: number | null;
  ratingCount: number;
  ratingSource: string | null;
  estimatedEtaMinMinutes: number | null;
  estimatedEtaMaxMinutes: number | null;
  activeOffers: Array<{
    id: string;
    title: string;
    description: string;
    terms: string | null;
    redemptionInstructions: string;
    validUntil: string;
  }>;
  isFavorite?: boolean;
}

interface DiscoveryFacets {
  cuisines: string[];
  categories: string[];
  dietaryTags: string[];
}

export function RestaurantBrowser() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [facets, setFacets] = useState<DiscoveryFacets>({
    cuisines: [],
    categories: [],
    dietaryTags: [],
  });
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filters, setFilters] = useState({
    query: '',
    city: '',
    cuisine: '',
    category: '',
    dietary: '',
    minPrice: '',
    maxPrice: '',
    minRating: '',
    maxEtaMinutes: '',
    availability: 'all',
    hasOffer: 'all',
    sort: 'relevance',
    maxDistanceKm: '10',
  });
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationMessage, setLocationMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingFavorite, setPendingFavorite] = useState('');
  const visibleRestaurants = favoritesOnly
    ? restaurants.filter((restaurant) => favorites.has(restaurant.id))
    : restaurants;

  async function loadRestaurants(params = new URLSearchParams()) {
    setLoading(true);
    setError('');
    try {
      const query = params.size ? `?${params.toString()}` : '';
      const response = await fetch(`${apiBase}/restaurants${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load restaurants.');
      const result = (await response.json()) as { data: Restaurant[] };
      setRestaurants(result.data);
    } catch {
      setError('Restaurants are unavailable right now. Try again shortly.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRestaurants();
    void fetch(`${apiBase}/discovery/facets`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((result: { data?: DiscoveryFacets }) => {
        if (result.data) setFacets(result.data);
      })
      .catch(() => undefined);
    void fetch(`${apiBase}/favorites/restaurants`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { data: string[] };
        setFavorites(new Set(result.data));
      })
      .catch(() => undefined);
  }, []);

  function updateFilter(name: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (filters.sort === 'distance' && !location) {
      setError('Share your location to sort by distance.');
      return;
    }
    const params = new URLSearchParams();
    for (const name of [
      'query',
      'city',
      'cuisine',
      'category',
      'dietary',
      'availability',
      'hasOffer',
      'sort',
    ] as const) {
      const value = filters[name].trim();
      if (value && value !== 'all' && value !== 'relevance') params.set(name, value);
    }
    for (const [name, value] of [
      ['minPriceMinor', filters.minPrice],
      ['maxPriceMinor', filters.maxPrice],
      ['minRating', filters.minRating],
      ['maxEtaMinutes', filters.maxEtaMinutes],
    ] as const) {
      if (value !== '') {
        params.set(
          name,
          name === 'minPriceMinor' || name === 'maxPriceMinor'
            ? String(Math.round(Number(value) * 100))
            : value,
        );
      }
    }
    if (location) {
      params.set('latitude', String(location.latitude));
      params.set('longitude', String(location.longitude));
      params.set('maxDistanceKm', filters.maxDistanceKm);
    }
    void loadRestaurants(params);
  }

  function locate() {
    setLocationMessage('');
    if (!navigator.geolocation) {
      setLocationMessage('Location is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationMessage('Nearby restaurants will be limited to their delivery radius.');
      },
      () => setLocationMessage('Location permission was not granted.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function toggleFavorite(restaurantId: string) {
    setPendingFavorite(restaurantId);
    setError('');
    const currentlySaved = favorites.has(restaurantId);
    try {
      const response = await fetch(`${apiBase}/favorites/restaurants/${restaurantId}`, {
        method: currentlySaved ? 'DELETE' : 'POST',
        credentials: 'include',
      });
      if (response.status === 401) {
        setError('Sign in to save restaurants to your favorites.');
        return;
      }
      if (!response.ok) throw new Error('Unable to update saved restaurants.');
      setFavorites((current) => {
        const updated = new Set(current);
        if (currentlySaved) updated.delete(restaurantId);
        else updated.add(restaurantId);
        return updated;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update saved restaurants.');
    } finally {
      setPendingFavorite('');
    }
  }

  return (
    <main className="market-page">
      <nav className="top-nav" aria-label="Main navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <div className="top-nav-actions">
          <Link href="/partner">Restaurant partners</Link>
          <Link href="/cart">Your cart</Link>
          <Link href="/account">Your account</Link>
        </div>
      </nav>
      <header className="market-heading">
        <div>
          <p className="eyebrow">Neighborhood kitchens</p>
          <h1>Find your next favorite.</h1>
          <p>Browse neighborhood restaurants and see who is open.</p>
        </div>
        <form className="discovery-filters" onSubmit={search}>
          <label className="form-field discovery-query">
            Search restaurants and food
            <input
              value={filters.query}
              onChange={(event) => updateFilter('query', event.target.value)}
              maxLength={120}
              placeholder="Dish, cuisine, or restaurant"
            />
          </label>
          <label className="form-field">
            City
            <input
              value={filters.city}
              onChange={(event) => updateFilter('city', event.target.value)}
              placeholder="Any city"
            />
          </label>
          <label className="form-field">
            Cuisine
            <select
              value={filters.cuisine}
              onChange={(event) => updateFilter('cuisine', event.target.value)}
            >
              <option value="">All cuisines</option>
              {facets.cuisines.map((cuisine) => (
                <option key={cuisine} value={cuisine}>
                  {cuisine}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Menu section
            <select
              value={filters.category}
              onChange={(event) => updateFilter('category', event.target.value)}
            >
              <option value="">All sections</option>
              {facets.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Dietary
            <select
              value={filters.dietary}
              onChange={(event) => updateFilter('dietary', event.target.value)}
            >
              <option value="">Any</option>
              {facets.dietaryTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Min price (INR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={filters.minPrice}
              onChange={(event) => updateFilter('minPrice', event.target.value)}
            />
          </label>
          <label className="form-field">
            Max price (INR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={filters.maxPrice}
              onChange={(event) => updateFilter('maxPrice', event.target.value)}
            />
          </label>
          <label className="form-field">
            Availability
            <select
              value={filters.availability}
              onChange={(event) => updateFilter('availability', event.target.value)}
            >
              <option value="all">Open and closed</option>
              <option value="open">Taking orders</option>
              <option value="closed">Not taking orders</option>
            </select>
          </label>
          <label className="form-field">
            Rating
            <select
              value={filters.minRating}
              onChange={(event) => updateFilter('minRating', event.target.value)}
            >
              <option value="">Any rating</option>
              <option value="3">3+ stars</option>
              <option value="4">4+ stars</option>
              <option value="4.5">4.5+ stars</option>
            </select>
          </label>
          <label className="form-field">
            Restaurant ETA up to (minutes)
            <input
              type="number"
              min="1"
              max="240"
              value={filters.maxEtaMinutes}
              onChange={(event) => updateFilter('maxEtaMinutes', event.target.value)}
            />
          </label>
          <label className="form-field">
            Offers
            <select
              value={filters.hasOffer}
              onChange={(event) => updateFilter('hasOffer', event.target.value)}
            >
              <option value="all">All restaurants</option>
              <option value="true">Current offers</option>
              <option value="false">No current offers</option>
            </select>
          </label>
          <label className="form-field">
            Sort by
            <select
              value={filters.sort}
              onChange={(event) => updateFilter('sort', event.target.value)}
            >
              <option value="relevance">Recommended</option>
              <option value="name">Name</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="rating">Rating</option>
              <option value="eta">ETA</option>
              <option value="distance" disabled={!location}>
                Distance
              </option>
            </select>
          </label>
          <div className="location-filter">
            <button className="secondary-button" type="button" onClick={locate}>
              Use my location
            </button>
            {location && (
              <label className="form-field">
                Within
                <select
                  value={filters.maxDistanceKm}
                  onChange={(event) => updateFilter('maxDistanceKm', event.target.value)}
                >
                  <option value="5">5 km</option>
                  <option value="10">10 km</option>
                  <option value="20">20 km</option>
                  <option value="50">50 km</option>
                </select>
              </label>
            )}
            {locationMessage && (
              <span className="location-message" role="status">
                {locationMessage}
              </span>
            )}
          </div>
          <button className="button discovery-submit" type="submit" disabled={loading}>
            {loading ? 'Searching…' : 'Apply filters'}
          </button>
        </form>
      </header>
      <section className="restaurant-results" aria-label="Restaurants">
        <div className="discovery-result-controls">
          <label className="partner-toggle">
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(event) => setFavoritesOnly(event.target.checked)}
            />
            Saved only
          </label>
          {!loading && <span>{visibleRestaurants.length} restaurants</span>}
        </div>
        {loading && <p role="status">Loading restaurants…</p>}
        {error && (
          <p className="form-message form-error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && visibleRestaurants.length === 0 && (
          <p className="market-empty">No approved restaurants are listed here yet.</p>
        )}
        {!loading &&
          !error &&
          visibleRestaurants.map((restaurant) => (
            <article className="restaurant-row" key={restaurant.id}>
              <span className="restaurant-mark" aria-hidden="true">
                {restaurant.name.slice(0, 1).toUpperCase()}
              </span>
              <Link className="restaurant-copy" href={`/restaurants/${restaurant.id}`}>
                <strong>{restaurant.name}</strong>
                <span>
                  {restaurant.cuisineTypes.join(' · ') || 'Neighborhood restaurant'} ·{' '}
                  {restaurant.city}, {restaurant.state}
                </span>
                {restaurant.description && <span>{restaurant.description}</span>}
                <span
                  className={
                    restaurant.isAcceptingOrders ? 'availability-open' : 'availability-closed'
                  }
                >
                  {restaurant.isAcceptingOrders ? 'Taking orders' : 'Not taking orders right now'}
                </span>
                {restaurant.distanceKm !== null && <span>{restaurant.distanceKm} km away</span>}
                {restaurant.minimumPriceMinor !== null && (
                  <span>
                    From{' '}
                    {(restaurant.minimumPriceMinor / 100).toLocaleString('en-IN', {
                      style: 'currency',
                      currency: 'INR',
                    })}
                  </span>
                )}
                {restaurant.matchedItems.length > 0 && (
                  <span>
                    Matches: {restaurant.matchedItems.map((item) => item.name).join(', ')}
                  </span>
                )}
                {restaurant.ratingAverage !== null && restaurant.ratingCount > 0 && (
                  <span>
                    {restaurant.ratingAverage.toFixed(1)} / 5 · {restaurant.ratingCount} ratings
                    {restaurant.ratingSource ? ` · ${restaurant.ratingSource}` : ''}
                  </span>
                )}
                {restaurant.estimatedEtaMinMinutes !== null &&
                  restaurant.estimatedEtaMaxMinutes !== null && (
                    <span>
                      Restaurant estimate: {restaurant.estimatedEtaMinMinutes}-
                      {restaurant.estimatedEtaMaxMinutes} min
                    </span>
                  )}
                {restaurant.activeOffers.map((offer) => (
                  <span className="restaurant-offer" key={offer.id}>
                    <strong>{offer.title}</strong> · {offer.description} ·{' '}
                    {offer.redemptionInstructions} · Ends{' '}
                    {new Date(offer.validUntil).toLocaleDateString()}
                  </span>
                ))}
                <span className="restaurant-menu-cta">View menu to choose dishes</span>
              </Link>
              <button
                className="favorite-button"
                type="button"
                aria-pressed={favorites.has(restaurant.id)}
                disabled={pendingFavorite === restaurant.id}
                onClick={() => void toggleFavorite(restaurant.id)}
              >
                {favorites.has(restaurant.id) ? 'Saved' : 'Save'}
              </button>
            </article>
          ))}
      </section>
    </main>
  );
}
