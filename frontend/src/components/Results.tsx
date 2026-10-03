// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { lineCount, placeIn, type Leaderboard, type RankBy, type Row, type Tally } from '../types';
import { nameOf } from './common';

/** How many rows a reader sees before the list is folded away. */
const VISIBLE_ROWS = 5;

/**
 * The results.
 *
 * Nothing is shown until the bingo is resolved — the backend does not even publish rows before then, so
 * this is a second lock on the same door rather than the only one.
 */
export function Results({
  i18n,
  people,
  me,
  board,
  size,
  hidden,
  mine,
  rankBy,
}: {
  i18n: PluginI18n;
  people: Record<string, UserRef>;
  me: string | undefined;
  board: Leaderboard | null;
  size: number;
  hidden: boolean;
  /** The reader's own score, worked out here — the board may well not carry their row. */
  mine?: { fields: number; lines: number };
  rankBy: RankBy;
}) {
  const players = board?.players ?? 0;

  if (!board?.published) {
    return (
      <p className="bingo__note">
        {players > 0 ? i18n.t('leaderboard.playing', { count: String(players) }) : i18n.t('leaderboard.empty')}
      </p>
    );
  }

  const ranked = board.ranked ?? [];
  const late = board.late ?? [];
  if (ranked.length === 0 && late.length === 0) {
    return <p className="bingo__note">{i18n.t('leaderboard.empty')}</p>;
  }

  return (
    <>
      {ranked.length > 0 && (
        <>
          <p className="bingo__section-title">
            <Icon name="trophy" /> {i18n.t('leaderboard.ranked')}
          </p>
          <RowList
            rows={ranked}
            people={people}
            me={me}
            i18n={i18n}
            size={size}
            mine={mine}
            distribution={board.distribution}
            rankBy={rankBy}
          />
        </>
      )}
      {late.length > 0 && (
        <>
          <p className="bingo__section-title">{i18n.t('leaderboard.late')}</p>
          <RowList rows={late} people={people} me={me} i18n={i18n} size={size} />
        </>
      )}
      {hidden && <p className="bingo__note">{i18n.t('leaderboard.youAreHidden')}</p>}
    </>
  );
}

/**
 * One side of the board, folded to the first few places.
 *
 * The viewer's own row is always drawn, with its real position, however far down it is. A leaderboard that
 * hides the reader from themselves is the one thing people complain about.
 */
function RowList({
  rows,
  people,
  me,
  i18n,
  size,
  mine,
  distribution,
  rankBy,
}: {
  rows: Row[];
  people: Record<string, UserRef>;
  me: string | undefined;
  i18n: PluginI18n;
  size: number;
  mine?: { fields: number; lines: number };
  distribution?: Tally[];
  rankBy?: RankBy;
}) {
  const top = rows.slice(0, VISIBLE_ROWS);
  const mineIndex = rows.findIndex((r) => r.author === me);
  const mineIsBelow = mineIndex >= VISIBLE_ROWS;
  const rest = rows.length - top.length - (mineIsBelow ? 1 : 0);

  // The board is capped, so a reader past the cap is in no row at all. Their own score plus how many did
  // better places them exactly, which is the whole reason the tally is published.
  const myPlace =
    mineIndex === -1 && mine && me ? placeIn(distribution, mine, rankBy ?? 'lines') : null;

  const draw = (row: Row, place: number) => {
    const person = people[row.author];
    // A row outlives its author: an erased account resolves to nothing, and the score stays.
    const name = nameOf(person, i18n);
    return (
      <li key={row.author} className="bingo__row">
        <span className="bingo__place">{place}</span>
        {person ? (
          <img className="bingo__avatar" src={person.avatarUrl} alt="" width={24} height={24} loading="lazy" />
        ) : (
          <span className="bingo__avatar bingo__avatar--none" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span>{name}</span>
        {row.author === me && <span className="bingo__role">{i18n.t('leaderboard.you')}</span>}
        <span className="bingo__row-score">
          {i18n.t('leaderboard.score', {
            lines: String(row.lines),
            ofLines: String(lineCount(size)),
            fields: String(row.fields),
            cells: String(row.cells),
          })}
        </span>
      </li>
    );
  };

  return (
    <>
      <ul className="bingo__rows">
        {top.map((row, i) => draw(row, i + 1))}
        {mineIsBelow && draw(rows[mineIndex], mineIndex + 1)}
        {myPlace !== null && mine && me &&
          draw({ author: me, fields: mine.fields, lines: mine.lines, cells: size * size, ranked: true },
            myPlace)}
      </ul>
      {rest > 0 && <p className="bingo__note">{i18n.t('leaderboard.more', { count: String(rest) })}</p>}
    </>
  );
}
