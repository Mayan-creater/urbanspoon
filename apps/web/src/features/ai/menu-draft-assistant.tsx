'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export type MenuDraft = {
  name: string;
  description: string;
  categorySuggestion: string | null;
  searchKeywords: string[];
  dietaryTags: string[];
  nutrition: null;
};

async function createDraft(restaurantId: string, body: unknown) {
  const response = await fetch(`${apiBase}/ai/partner/restaurants/${encodeURIComponent(restaurantId)}/menu-draft`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: { draft: MenuDraft; notice: string };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(envelope.error?.message ?? 'Menu draft could not be generated.');
  return envelope.data!;
}

export function MenuDraftAssistant({
  restaurantId,
  onUseDraft,
}: {
  restaurantId: string;
  onUseDraft: (draft: MenuDraft) => void;
}) {
  const [itemInformation, setItemInformation] = useState('');
  const [category, setCategory] = useState('');
  const [claimedDietaryTags, setClaimedDietaryTags] = useState('');
  const [draft, setDraft] = useState<MenuDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await createDraft(restaurantId, {
        itemInformation,
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(claimedDietaryTags.trim()
          ? { claimedDietaryTags: claimedDietaryTags.split(',').map((tag) => tag.trim()).filter(Boolean) }
          : {}),
      });
      setDraft(response.draft);
      setNotice(response.notice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Menu draft could not be generated.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="ai-menu-draft" aria-labelledby="menu-draft-title">
      <div className="ai-menu-draft-heading">
        <div>
          <p className="eyebrow">Partner tools</p>
          <h3 id="menu-draft-title">Menu copy assistant</h3>
        </div>
        <span className="ai-draft-tag">Unpublished draft</span>
      </div>
      <form className="ai-menu-draft-form" onSubmit={(event) => void generate(event)}>
        <label className="form-field">
          Item facts
          <textarea
            maxLength={1200}
            minLength={3}
            onChange={(event) => setItemInformation(event.target.value)}
            placeholder="Ingredients, preparation, and serving details you can verify"
            required
            rows={3}
            value={itemInformation}
          />
        </label>
        <div className="ai-fields">
          <label className="form-field">
            Section (optional)
            <input maxLength={80} onChange={(event) => setCategory(event.target.value)} value={category} />
          </label>
          <label className="form-field">
            Verified dietary tags (optional)
            <input maxLength={260} onChange={(event) => setClaimedDietaryTags(event.target.value)} placeholder="vegetarian, vegan" value={claimedDietaryTags} />
          </label>
        </div>
        <button className="secondary-button" disabled={pending} type="submit">
          {pending ? 'Drafting…' : 'Generate menu copy'}
        </button>
      </form>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="ai-caveat" role="status">{notice}</p>}
      {draft && (
        <div className="ai-menu-draft-result">
          <label className="form-field">
            Draft name
            <input maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} />
          </label>
          <label className="form-field">
            Draft description
            <textarea maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} value={draft.description} />
          </label>
          <p className="ai-keywords">Suggested search terms: {draft.searchKeywords.join(', ') || 'None'}</p>
          <button className="button" disabled={!draft.name.trim() || !draft.description.trim()} onClick={() => onUseDraft(draft)} type="button">
            Use in menu form
          </button>
        </div>
      )}
    </section>
  );
}