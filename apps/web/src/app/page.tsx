import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="home-page">
      <nav className="top-nav" aria-label="Main navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <div className="top-nav-actions">
          <Link href="/restaurants">Browse restaurants</Link>
          <Link href="/ai">Food assistant</Link>
          <Link href="/events">Event catering</Link>
          <Link href="/membership">FoodPass</Link>
          <Link href="/partner">Restaurant partners</Link>
          <Link href="/login">Sign in</Link>
          <Link className="button button-small" href="/register">
            Create account
          </Link>
        </div>
      </nav>
      <section className="home-content">
        <p className="eyebrow">A local food marketplace</p>
        <h1>Good food, close to home.</h1>
        <p>Discover neighborhood kitchens and keep your favorite places close.</p>
        <div className="home-actions">
          <Link className="button" href="/restaurants">
            Browse restaurants
          </Link>
          <Link className="button" href="/register">
            Create your account
          </Link>
          <Link className="text-link" href="/login">
            I already have an account
          </Link>
        </div>
      </section>
    </main>
  );
}
