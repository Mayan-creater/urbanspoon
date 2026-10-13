'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

type VerificationProvider = 'MANUAL' | 'EXTERNAL';

interface PartnerReview {
  id: string;
  vehicleType: string;
  marketRegion: string;
  verificationStatus: string;
  createdAt: string;
  user: { name: string; email: string; phone: string | null };
  evidence: EvidenceMetadata[];
}

interface EvidenceMetadata {
  id: string;
  evidenceType: string;
  originalFilename: string;
  sizeBytes: number;
  deliveryId: string | null;
  createdAt: string;
  orderId?: string | null;
  partner?: { name: string; email: string };
}

interface PartnerPayout {
  id: string;
  amountMinor: number;
  currency: string;
  provider: string;
  status: 'REQUESTED' | 'APPROVED';
  periodStart: string;
  periodEnd: string;
  requestedAt: string;
  deliveryPartner: { user: { name: string; email: string } };
  earnings: Array<{ id: string; amountMinor: number; earningType: string }>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('Could not connect to the API. Check that the backend is running.');
  }
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Request failed.');
  return envelope.data as T;
}

async function loadOperations() {
  const [partners, requestedPayouts, approvedPayouts] = await Promise.all([
    api<PartnerReview[]>('/admin/delivery-partners?status=PENDING'),
    api<PartnerPayout[]>('/admin/partner-payouts?status=REQUESTED'),
    api<PartnerPayout[]>('/admin/partner-payouts?status=APPROVED'),
  ]);
  const [reviewPartners, deliveryProofs] = await Promise.all([
    Promise.all(
      partners.map(async (partner) => ({
        ...partner,
        evidence: await api<EvidenceMetadata[]>(`/admin/delivery-partners/${partner.id}/evidence`),
      })),
    ),
    api<EvidenceMetadata[]>('/admin/deliveries/evidence'),
  ]);
  return {
    partners: reviewPartners,
    payouts: [...requestedPayouts, ...approvedPayouts],
    deliveryProofs,
  };
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100);
}

export function DeliveryOperations() {
  const [partners, setPartners] = useState<PartnerReview[]>([]);
  const [payouts, setPayouts] = useState<PartnerPayout[]>([]);
  const [deliveryProofs, setDeliveryProofs] = useState<EvidenceMetadata[]>([]);
  const [providers, setProviders] = useState<Record<string, VerificationProvider>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    const result = await loadOperations();
    setPartners(result.partners);
    setPayouts(result.payouts);
    setDeliveryProofs(result.deliveryProofs);
    setLoaded(true);
  }

  useEffect(() => {
    let mounted = true;
    void loadOperations()
      .then((result) => {
        if (!mounted) return;
        setPartners(result.partners);
        setPayouts(result.payouts);
        setDeliveryProofs(result.deliveryProofs);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (mounted)
          setError(cause instanceof Error ? cause.message : 'Could not load operations.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function downloadEvidence(path: string, filename: string) {
    try {
      const response = await fetch(`${apiBase}${path}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Evidence could not be downloaded.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evidence could not be downloaded.');
    }
  }

  async function reviewPartner(partner: PartnerReview, verified: boolean) {
    const provider = providers[partner.id] ?? 'MANUAL';
    const reference = references[partner.id]?.trim() ?? '';
    const reason = reasons[partner.id]?.trim() ?? '';
    if (verified && provider === 'EXTERNAL' && reference.length < 4) {
      setError('Enter the external verification reference before approving.');
      return;
    }
    if (!verified && reason.length < 3) {
      setError('Enter a reason of at least three characters before rejecting.');
      return;
    }
    setBusyId(partner.id);
    setError('');
    setNotice('');
    try {
      await api(`/admin/delivery-partners/${partner.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          verified,
          verificationProvider: provider,
          ...(verified && provider === 'EXTERNAL' ? { verificationReference: reference } : {}),
          ...(!verified ? { reason } : {}),
        }),
      });
      await refresh();
      setNotice(verified ? 'Partner approved for dispatch.' : 'Partner application rejected.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not review the partner.');
    } finally {
      setBusyId('');
    }
  }

  async function decidePayout(
    payout: PartnerPayout,
    action: 'approve' | 'reject' | 'mark-paid' | 'sandbox-transfer',
  ) {
    const reason = reasons[payout.id]?.trim() ?? '';
    const reference = references[payout.id]?.trim() ?? '';
    if (action === 'reject' && reason.length < 3) {
      setError('Enter a rejection reason of at least three characters.');
      return;
    }
    if (action === 'mark-paid' && reference.length < 4) {
      setError('Enter the external transfer reference to reconcile this payout.');
      return;
    }
    setBusyId(payout.id);
    setError('');
    setNotice('');
    try {
      const endpoint =
        action === 'sandbox-transfer'
          ? `/admin/partner-payouts/${payout.id}/sandbox-transfer`
          : `/admin/partner-payouts/${payout.id}/${action}`;
      await api(endpoint, {
        method: 'POST',
        ...(action === 'reject'
          ? { body: JSON.stringify({ reason }) }
          : action === 'mark-paid'
            ? { body: JSON.stringify({ providerReference: reference }) }
            : {}),
      });
      await refresh();
      setNotice(
        action === 'sandbox-transfer'
          ? 'Sandbox payout completed for workflow testing; no funds were moved.'
          : action === 'mark-paid'
            ? 'Payout marked as transferred. No transfer was initiated by Urban Spoon.'
            : action === 'approve'
              ? 'Payout approved for external transfer.'
              : 'Payout rejected and earnings released.',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the payout.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <main className="delivery-page">
      <header className="delivery-topbar">
        <Link className="wordmark" href="/">
          Urban Spoon
        </Link>
        <nav aria-label="Admin navigation" className="delivery-nav">
          <span>Delivery operations</span>
          <Link href="/account">Account</Link>
        </nav>
      </header>

      <section className="delivery-header m6-admin-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Delivery review</h1>
          <p className="delivery-muted">Partner verification and payout reconciliation</p>
        </div>
        <button
          className="button button-outline"
          disabled={loading || Boolean(busyId)}
          onClick={() => {
            setError('');
            void refresh().catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : 'Could not refresh operations.'),
            );
          }}
          type="button"
        >
          Refresh queue
        </button>
      </section>

      {(error || notice) && (
        <p
          className={`delivery-notice ${error ? 'form-error' : ''}`}
          role={error ? 'alert' : 'status'}
        >
          {error || notice}
        </p>
      )}

      {loading ? (
        <p className="delivery-loading">Loading operations…</p>
      ) : (
        <div className="m6-admin-layout">
          <section aria-labelledby="partner-queue-heading" className="m6-admin-section">
            <div className="delivery-section-heading">
              <div>
                <p className="eyebrow">Partner onboarding</p>
                <h2 id="partner-queue-heading">Pending verification</h2>
              </div>
              <span className="delivery-count">{loaded ? partners.length : '—'}</span>
            </div>
            {partners.length ? (
              <div className="m6-admin-list">
                {partners.map((partner) => {
                  const provider = providers[partner.id] ?? 'MANUAL';
                  return (
                    <article className="m6-admin-item" key={partner.id}>
                      <div className="m6-admin-item-heading">
                        <div>
                          <h3>{partner.user.name}</h3>
                          <p>
                            {partner.user.email}
                            {partner.user.phone ? ` · ${partner.user.phone}` : ''}
                          </p>
                        </div>
                        <span className="delivery-status">{partner.vehicleType.toLowerCase()}</span>
                      </div>
                      <p className="m6-admin-meta">
                        {partner.marketRegion} market · submitted{' '}
                        {new Date(partner.createdAt).toLocaleDateString()}
                      </p>
                      <div className="m6-admin-evidence">
                        <strong>Submitted documents</strong>
                        {partner.evidence.length ? (
                          partner.evidence.map((item) => (
                            <button
                              className="delivery-text-button"
                              key={item.id}
                              onClick={() =>
                                void downloadEvidence(
                                  `/admin/delivery-partners/${partner.id}/evidence/${item.id}/content`,
                                  item.originalFilename,
                                )
                              }
                              type="button"
                            >
                              {item.evidenceType.toLowerCase()} · {item.originalFilename}
                            </button>
                          ))
                        ) : (
                          <span className="m6-admin-meta">No documents submitted</span>
                        )}
                      </div>
                      <div className="m6-admin-controls">
                        <label className="form-field">
                          Verification source
                          <select
                            onChange={(event) =>
                              setProviders((current) => ({
                                ...current,
                                [partner.id]: event.target.value as VerificationProvider,
                              }))
                            }
                            value={provider}
                          >
                            <option value="MANUAL">Manual review</option>
                            <option value="EXTERNAL">External provider</option>
                          </select>
                        </label>
                        {provider === 'EXTERNAL' && (
                          <label className="form-field">
                            Provider reference
                            <input
                              maxLength={120}
                              minLength={4}
                              onChange={(event) =>
                                setReferences((current) => ({
                                  ...current,
                                  [partner.id]: event.target.value,
                                }))
                              }
                              value={references[partner.id] ?? ''}
                            />
                          </label>
                        )}
                        <label className="form-field">
                          Rejection reason
                          <input
                            maxLength={240}
                            onChange={(event) =>
                              setReasons((current) => ({
                                ...current,
                                [partner.id]: event.target.value,
                              }))
                            }
                            placeholder="Required only when rejecting"
                            value={reasons[partner.id] ?? ''}
                          />
                        </label>
                      </div>
                      <div className="m6-admin-actions">
                        <button
                          className="button"
                          disabled={Boolean(busyId)}
                          onClick={() => void reviewPartner(partner, true)}
                          type="button"
                        >
                          Approve partner
                        </button>
                        <button
                          className="delivery-text-button"
                          disabled={Boolean(busyId)}
                          onClick={() => void reviewPartner(partner, false)}
                          type="button"
                        >
                          Reject application
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="delivery-muted m6-admin-empty">
                {loaded
                  ? 'No pending partner reviews.'
                  : 'Partner queue unavailable until the API responds.'}
              </p>
            )}
          </section>

          <section aria-labelledby="delivery-proof-heading" className="m6-admin-section">
            <div className="delivery-section-heading">
              <div>
                <p className="eyebrow">Delivery evidence</p>
                <h2 id="delivery-proof-heading">Recent proof uploads</h2>
              </div>
              <span className="delivery-count">{deliveryProofs.length}</span>
            </div>
            {deliveryProofs.length ? (
              <div className="m6-admin-list">
                {deliveryProofs.map((item) => (
                  <article className="m6-admin-item m6-admin-proof" key={item.id}>
                    <div>
                      <h3>{item.evidenceType.replaceAll('_', ' ').toLowerCase()}</h3>
                      <p>
                        {item.partner?.name} · {item.partner?.email}
                      </p>
                      <p className="m6-admin-meta">
                        Order {item.orderId} · {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      className="button button-small"
                      onClick={() =>
                        void downloadEvidence(
                          `/admin/deliveries/${item.deliveryId}/evidence/${item.id}/content`,
                          item.originalFilename,
                        )
                      }
                      type="button"
                    >
                      Download proof
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="delivery-muted m6-admin-empty">No delivery proof uploaded.</p>
            )}
          </section>

          <section aria-labelledby="payout-queue-heading" className="m6-admin-section">
            <div className="delivery-section-heading">
              <div>
                <p className="eyebrow">Partner earnings</p>
                <h2 id="payout-queue-heading">Payout requests</h2>
              </div>
              <span className="delivery-count">{loaded ? payouts.length : '—'}</span>
            </div>
            {payouts.length ? (
              <div className="m6-admin-list">
                {payouts.map((payout) => (
                  <article className="m6-admin-item" key={payout.id}>
                    <div className="m6-admin-item-heading">
                      <div>
                        <h3>{payout.deliveryPartner.user.name}</h3>
                        <p>{payout.deliveryPartner.user.email}</p>
                      </div>
                      <span className="delivery-status">{payout.status.toLowerCase()}</span>
                    </div>
                    <div className="m6-admin-payout-summary">
                      <strong>{money(payout.amountMinor, payout.currency)}</strong>
                      <span>{payout.earnings.length} earning(s)</span>
                      <span>{payout.provider.replaceAll('_', ' ')}</span>
                      <span>
                        {new Date(payout.periodStart).toLocaleDateString()} –{' '}
                        {new Date(payout.periodEnd).toLocaleDateString()}
                      </span>
                    </div>
                    {payout.status === 'REQUESTED' ? (
                      <>
                        <label className="form-field">
                          Rejection reason
                          <input
                            maxLength={240}
                            onChange={(event) =>
                              setReasons((current) => ({
                                ...current,
                                [payout.id]: event.target.value,
                              }))
                            }
                            placeholder="Required only when rejecting"
                            value={reasons[payout.id] ?? ''}
                          />
                        </label>
                        <div className="m6-admin-actions">
                          <button
                            className="button"
                            disabled={Boolean(busyId)}
                            onClick={() => void decidePayout(payout, 'approve')}
                            type="button"
                          >
                            Approve payout
                          </button>
                          <button
                            className="delivery-text-button"
                            disabled={Boolean(busyId)}
                            onClick={() => void decidePayout(payout, 'reject')}
                            type="button"
                          >
                            Reject request
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="m6-admin-sandbox-note">
                          Test transfer settles the workflow only. It does not move money.
                        </p>
                        {process.env.NODE_ENV !== 'production' && (
                          <div className="m6-admin-actions">
                            <button
                              className="button button-outline"
                              disabled={Boolean(busyId)}
                              onClick={() => void decidePayout(payout, 'sandbox-transfer')}
                              type="button"
                            >
                              Simulate sandbox transfer
                            </button>
                          </div>
                        )}
                        <label className="form-field">
                          External transfer reference
                          <input
                            maxLength={160}
                            minLength={4}
                            onChange={(event) =>
                              setReferences((current) => ({
                                ...current,
                                [payout.id]: event.target.value,
                              }))
                            }
                            value={references[payout.id] ?? ''}
                          />
                        </label>
                        <div className="m6-admin-actions">
                          <button
                            className="button"
                            disabled={Boolean(busyId)}
                            onClick={() => void decidePayout(payout, 'mark-paid')}
                            type="button"
                          >
                            Record transfer complete
                          </button>
                          <span className="m6-admin-meta">
                            Records an external transfer; does not send funds.
                          </span>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="delivery-muted m6-admin-empty">
                {loaded
                  ? 'No open payout requests.'
                  : 'Payout queue unavailable until the API responds.'}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
