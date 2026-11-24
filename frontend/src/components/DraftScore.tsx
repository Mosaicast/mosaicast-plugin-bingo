// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { countLines, hitGrid, lineCount, type DraftView } from '../types';
import { BingoGrid } from './BingoGrid';
import { nameOf } from './common';

/**
 * A finished round's cards with what came true on them, and the standings that follow.
 *
 * Before the bingo is resolved this is for podcasters and admins only: they tick squares off while recording,
 * before the episode is out, and see who's ahead right away. Each tick is a decision in the episode's
 * resolution, so the real resolution later starts from it. Once the bingo is resolved everyone in the round
 * sees the same thing, read-only.
 */
export function DraftScore({
  i18n,
  view,
  me,
  people,
  act,
  onError,
}: {
  i18n: PluginI18n;
  view: DraftView;
  me: string;
  people: Record<string, UserRef>;
  act: (name: string, payload: Record<string, unknown>) => Promise<string | null>;
  onError: (code: string) => void;
}) {
  const [marking, setMarking] = useState(false);
  const [busy, setBusy] = useState(false);
  const scoring = view.scoring;
  if (!scoring || !view.game) return null;

  const size = view.size;
  const squares = size * size;
  const standings = view.game.seats
    .map((seat) => {
      const hits = scoring.hits[seat.userId] ?? [];
      const grid = hitGrid(hits, size, view.freeCentre);
      return { seat, hits, fields: grid.filter(Boolean).length, lines: countLines(grid, size) };
    })
    .sort((a, b) =>
      scoring.rankBy === 'fields'
        ? b.fields - a.fields || b.lines - a.lines
        : b.lines - a.lines || b.fields - a.fields,
    );
  const name = (id: string) => (id === me ? i18n.t('draft.yourCard') : nameOf(people[id], i18n));
  const canMark = scoring.canMark && marking;

  const toggle = async (seat: string, cell: number) => {
    if (busy) return;
    setBusy(true);
    const failure = await act('draft-mark', { seat, cell });
    setBusy(false);
    if (failure) onError(failure);
  };

  return (
    <section className="bingo__draft-score" aria-busy={busy || undefined}>
      <p className="bingo__section-title">
        {scoring.resolved ? i18n.t('draft.score.title') : i18n.t('draft.score.early')}
      </p>
      {!scoring.resolved && <p className="bingo__note">{i18n.t('draft.score.private')}</p>}
      {scoring.canMark && (
        <div className="bingo__actions">
          <button type="button" className={marking ? 'bingo__btn' : 'bingo__btn bingo__btn--quiet'}
            aria-pressed={marking} onClick={() => setMarking((m) => !m)}>
            {marking ? i18n.t('draft.score.done') : i18n.t('draft.score.mark')}
          </button>
        </div>
      )}
      {canMark && <p className="bingo__note">{i18n.t('draft.score.how')}</p>}

      <ol className="bingo__standings">
        {standings.map(({ seat, fields, lines }) => (
          <li key={seat.userId}>
            <span className="bingo__seat-name">{nameOf(people[seat.userId], i18n)}</span>
            <span className="bingo__standings-score">
              {i18n.t('draft.score.row', {
                lines: String(lines),
                ofLines: String(lineCount(size)),
                fields: String(fields),
                cells: String(squares),
              })}
            </span>
          </li>
        ))}
      </ol>

      <div className="bingo__draft-others">
        {view.game.seats.map((seat) => (
          <section key={seat.userId} className="bingo__draft-card">
            <p className="bingo__section-title">
              {seat.userId === me ? name(seat.userId) : i18n.t('draft.cardOf', { name: name(seat.userId) })}
            </p>
            <BingoGrid
              size={size}
              freeCentre={view.freeCentre}
              entries={seat.cells ?? []}
              hits={scoring.hits[seat.userId] ?? []}
              i18n={i18n}
              label={i18n.t('draft.cardOf', { name: name(seat.userId) })}
              onToggle={canMark ? (cell) => void toggle(seat.userId, cell) : undefined}
            />
          </section>
        ))}
      </div>
    </section>
  );
}
