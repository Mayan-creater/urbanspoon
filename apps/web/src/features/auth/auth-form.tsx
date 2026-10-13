'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

type AuthFormMode = 'register' | 'verify' | 'login' | 'recover';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

const descriptions: Record<AuthFormMode, string> = {
  register: 'Create an account to save your details and local favorites.',
  verify: 'Enter the six-digit code sent to your email address.',
  login: 'Sign in to manage your profile and delivery addresses.',
  recover: 'Receive a one-time code to choose a new password.',
};

export function AuthForm({ mode }: { mode: AuthFormMode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [resetStage, setResetStage] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');

    const values = Object.fromEntries(new FormData(event.currentTarget));
    const currentEmail = String(values.email ?? email)
      .trim()
      .toLowerCase();
    setEmail(currentEmail);

    let endpoint = '/auth/login';
    let payload: Record<string, FormDataEntryValue> = values;
    if (mode === 'register') endpoint = '/auth/register';
    if (mode === 'register' && !String(values.phone ?? '').trim()) delete payload.phone;
    if (mode === 'verify') endpoint = '/auth/verify';
    if (mode === 'recover' && !resetStage) endpoint = '/auth/forgot-password';
    if (mode === 'recover' && resetStage) endpoint = '/auth/reset-password';
    if (mode === 'recover' && !resetStage) payload = { email: currentEmail };
    if (mode === 'recover' && resetStage) payload = { ...values, email: currentEmail };

    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const envelope = (await response.json()) as {
        data?: { message?: string };
        error?: { message?: string; details?: string[] };
      };
      if (!response.ok) {
        const validationDetails = envelope.error?.details?.join(' ');
        setError(validationDetails ?? envelope.error?.message ?? 'Request failed. Try again.');
        return;
      }

      if (mode === 'register') {
        setMessage('Check your email for a verification code.');
        router.push('/verify');
        return;
      }
      if (mode === 'verify' || mode === 'login') {
        const returnTo =
          mode === 'login' ? new URLSearchParams(window.location.search).get('returnTo') : null;
        router.push(
          returnTo?.startsWith('/') && !returnTo.startsWith('//') && !returnTo.includes('\\')
            ? returnTo
            : '/account',
        );
        return;
      }
      if (!resetStage) {
        setResetStage(true);
        setMessage('If the account exists, a reset code has been sent.');
        return;
      }
      setMessage('Password updated. Sign in with your new password.');
      router.push('/login');
    } catch {
      setError('The service could not be reached. Check your connection and retry.');
    } finally {
      setPending(false);
    }
  }

  async function resendCode() {
    setError('');
    setMessage('');
    try {
      const response = await fetch(`${apiBase}/auth/verify/resend`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!response.ok) throw new Error('Unable to send a code');
      setMessage('If the account is awaiting verification, a new code has been sent.');
    } catch {
      setError('The service could not be reached. Try again.');
    }
  }

  return (
    <main className="auth-page">
      <nav className="top-nav" aria-label="Account navigation">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <Link href="/login">Sign in</Link>
      </nav>
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">Your account</p>
        <h1 id="auth-title">
          {mode === 'register' && 'Create account'}
          {mode === 'verify' && 'Verify your email'}
          {mode === 'login' && 'Welcome back'}
          {mode === 'recover' && (resetStage ? 'Choose a new password' : 'Reset password')}
        </h1>
        <p className="auth-description">{descriptions[mode]}</p>
        <form className="form-stack" onSubmit={submit}>
          {mode === 'register' && (
            <label className="form-field">
              Name
              <input name="name" autoComplete="name" minLength={2} maxLength={80} required />
            </label>
          )}
          {mode === 'register' && (
            <label className="form-field">
              Phone (optional)
              <input name="phone" type="tel" autoComplete="tel" pattern="\+?[1-9][0-9]{7,14}" />
            </label>
          )}
          {(mode !== 'recover' || !resetStage) && (
            <label className="form-field">
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
          )}
          {mode === 'verify' && (
            <label className="form-field">
              Verification code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
              />
            </label>
          )}
          {(mode === 'login' || mode === 'register' || (mode === 'recover' && resetStage)) && (
            <label className="form-field">
              {mode === 'recover' ? 'New password' : 'Password'}
              <input
                name={mode === 'recover' ? 'newPassword' : 'password'}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
          )}
          {mode === 'recover' && resetStage && (
            <label className="form-field">
              Reset code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
              />
            </label>
          )}
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
          <button className="button" type="submit" disabled={pending}>
            {pending
              ? 'Please wait…'
              : mode === 'register'
                ? 'Create account'
                : mode === 'verify'
                  ? 'Verify and continue'
                  : mode === 'login'
                    ? 'Sign in'
                    : resetStage
                      ? 'Update password'
                      : 'Send reset code'}
          </button>
        </form>
        <div className="form-links">
          {mode === 'verify' && (
            <button type="button" onClick={resendCode} disabled={!email}>
              Resend verification code
            </button>
          )}
          {mode === 'login' && <Link href="/recover">Forgot password?</Link>}
          {mode === 'register' && <Link href="/login">Already registered? Sign in</Link>}
          {mode !== 'login' && <Link href="/login">Sign in</Link>}
        </div>
      </section>
    </main>
  );
}
