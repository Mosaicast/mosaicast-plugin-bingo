// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { normalise, similarity } from '../fuzzy';
import type { PluginI18n } from '../i18n';
import type { Suggestion } from '../types';

/** How many chips of each kind are drawn; a phone-width card has room for a couple of rows, not a list. */
const SHOWN = 12;

/**
 * Ideas for a card: what several people keep predicting across the site, and the site's own tags.
 *
 * Behind a switch the player owns, saved in their own partition the moment it is flipped, because some
 * people find a wall of other people's guesses spoils the fun of guessing. A suggestion already on the card
 * — or close enough that it would count as the same thing — is not offered again.
 */
export function SuggestionChips({
  i18n,
  suggestions,
  vocabulary,
  draft,
  threshold,
  shown,
  onToggle,
  onPick,
}: {
  i18n: PluginI18n;
  suggestions: Suggestion[];
  vocabulary: string[];
  /** The card as currently written, so nothing on it is offered again. */
  draft: string[];
  threshold: number;
  shown: boolean;
  onToggle: (next: boolean) => void;
  onPick: (text: string) => void;
}) {
  if (suggestions.length === 0 && vocabulary.length === 0) return null;

  const written = draft.map(normalise).filter((form) => form !== '');
  const fresh = (text: string) => {
    const form = normalise(text);
    return form !== '' && !written.some((w) => w === form || similarity(w, form) >= threshold);
  };
  const ideas = suggestions.filter((s) => fresh(s.label)).slice(0, SHOWN);
  const tags = vocabulary.filter(fresh).slice(0, SHOWN);

  return (
    <div className="bingo__suggestions">
      <label className="bingo__check">
        <input type="checkbox" checked={shown} onChange={(e) => onToggle(e.target.checked)} />
        {i18n.t('suggest.toggle')}
      </label>
      {shown && ideas.length > 0 && (
        <div className="bingo__suggest">
          <span className="bingo__note">{i18n.t('suggest.popular')}</span>
          {ideas.map((s) => (
            <button
              key={s.label}
              type="button"
              className="bingo__chip"
              title={i18n.t('suggest.meta', {
                people: String(s.people),
                hits: String(s.hits),
                episodes: String(s.episodes),
              })}
              onClick={() => onPick(s.label)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {shown && tags.length > 0 && (
        <div className="bingo__suggest">
          <span className="bingo__note">{i18n.t('episode.suggestions')}</span>
          {tags.map((tag) => (
            <button key={tag} type="button" className="bingo__chip" onClick={() => onPick(tag)}>
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
