// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import type { RankBy, ScopeStats } from '../types';
import { nameOf } from './common';

/** How many places a ranking draws; the backend publishes up to fifty. */
const SHOWN = 10;

/**
 * One ranking with its own *Total* / *Per card* switch.
 *
 * Per card divides a player's score by the cards they played, so somebody who joined late can lead — but
 * only once they have played the scope's `bar` of cards (the `minCardsPerCard` setting, or every bingo of a
 * shorter season). Everybody below it is counted in a sentence, never named.
 */
export function RankingPanel({
  i18n,
  stats,
  people,
  me,
  rankBy,
  label,
}: {
  i18n: PluginI18n;
  stats: ScopeStats | undefined;
  people: Record<string, UserRef>;
  me: string | undefined;
  rankBy: RankBy;
  /** What the ranking covers, for assistive tech and the empty state. */
  label: string;
}) {
  const [mode, setMode] = useState<'total' | 'average'>('total');
  const num = (v: number) => v.toLocaleString(i18n.locale, { maximumFractionDigits: 2 });
  const byTotal = (stats?.byTotal ?? []).slice(0, SHOWN);
  const byAverage = (stats?.byAverage ?? []).slice(0, SHOWN);

  const row = (author: string, place: number, score: string) => {
    const person = people[author];
    const name = nameOf(person, i18n);
    return (
      <li key={author} className="bingo__row">
        <span className="bingo__place">{place}</span>
        {person ? (
          <img className="bingo__avatar" src={person.avatarUrl} alt="" width={24} height={24} loading="lazy" />
        ) : (
          <span className="bingo__avatar bingo__avatar--none" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span>{name}</span>
        {author === me && <span className="bingo__role">{i18n.t('leaderboard.you')}</span>}
        <span className="bingo__row-score">{score}</span>
      </li>
    );
  };

  return (
    <div className="bingo__ranking" aria-label={label}>
      <div className="bingo__pills" role="group" aria-label={label}>
        {(['total', 'average'] as const).map((m) => (
          <button key={m} type="button" className="bingo__pill bingo__pill--small" aria-pressed={mode === m}
            onClick={() => setMode(m)}>
            {i18n.t(`ranking.${m}`)}
          </button>
        ))}
      </div>
      {mode === 'total' ? (
        byTotal.length === 0 ? (
          <p className="bingo__note">{i18n.t('stats.empty')}</p>
        ) : (
          <ol className="bingo__rows">
            {byTotal.map((r, i) =>
              row(r.author, i + 1, i18n.t('stats.score', {
                lines: String(r.lines), fields: String(r.fields), cards: String(r.cards),
              })),
            )}
          </ol>
        )
      ) : (
        <>
          {byAverage.length === 0 ? (
            <p className="bingo__note">{i18n.t('ranking.nobodyYet', { bar: String(stats?.bar ?? 0) })}</p>
          ) : (
            <ol className="bingo__rows">
              {byAverage.map((r, i) =>
                row(r.author, i + 1, i18n.t(rankBy === 'fields' ? 'ranking.perCardFields' : 'ranking.perCardLines', {
                  value: num(rankBy === 'fields' ? r.fields : r.lines),
                  cards: String(r.cards),
                })),
              )}
            </ol>
          )}
          {(stats?.belowBar ?? 0) > 0 && (
            <p className="bingo__note">
              {i18n.t('ranking.belowBar', { count: String(stats!.belowBar), bar: String(stats!.bar) })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
