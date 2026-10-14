// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { PluginI18n } from '../i18n';
import type { PredictionRow, PredictionStats } from '../types';

type ListKey = 'best' | 'worst' | 'popular';
const LISTS: ListKey[] = ['best', 'worst', 'popular'];

/**
 * Which predictions come true, which never do, and which everybody writes — within the season pill's scope.
 *
 * The backend already ranks the lists (a long record before a lucky streak, by the Wilson bound) and leaves
 * out anything fewer than two people wrote, so this only draws them. One list at a time keeps the page short
 * on a phone. The rate is a meter with its numbers beside it: the bar never carries a value on its own.
 */
export function PredictionsPanel({ i18n, stats }: { i18n: PluginI18n; stats: PredictionStats | null | undefined }) {
  const [list, setList] = useState<ListKey>('best');
  if (!stats) return null;
  const rows: PredictionRow[] = stats[list] ?? [];
  const floor = String(stats.floor);
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <section aria-label={i18n.t('predictions.title')}>
      <div className="bingo__chart-head">
        <h3 className="bingo__chart-title">{i18n.t('predictions.title')}</h3>
        <div className="bingo__pills" role="group" aria-label={i18n.t('predictions.title')}>
          {LISTS.map((key) => (
            <button key={key} type="button" className="bingo__pill bingo__pill--small" aria-pressed={list === key}
              onClick={() => setList(key)}>
              {i18n.t(`predictions.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="bingo__note">
        {i18n.t(list === 'popular' ? 'predictions.popularHint' : 'predictions.ratedHint', { floor })}
      </p>
      {rows.length === 0 ? (
        <p className="bingo__note">
          {i18n.t(list === 'popular' ? 'predictions.nonePopular' : 'predictions.noneRated', { floor })}
        </p>
      ) : (
        <ol className="bingo__predictions">
          {rows.map((row) => {
            const rate = row.bingos > 0 ? row.hits / row.bingos : 0;
            const detail = i18n.t('predictions.cameTrue', { hits: String(row.hits), bingos: String(row.bingos) });
            return (
              <li key={row.label} className="bingo__prediction">
                <div className="bingo__prediction-head">
                  <span className="bingo__prediction-label">“{row.label}”</span>
                  <span className="bingo__prediction-rate">{pct(rate)}</span>
                </div>
                <div className="bingo__meter" role="meter" aria-valuemin={0} aria-valuemax={100}
                  aria-valuenow={Math.round(rate * 100)} aria-label={`${row.label}: ${detail}`}>
                  <span className="bingo__meter-fill" style={{ width: `${rate * 100}%` }} />
                </div>
                <div className="bingo__tile-sub">
                  {list === 'popular'
                    ? i18n.t('predictions.onCards', { cards: String(row.cards), people: String(row.people) }) + ' · ' + detail
                    : detail}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
