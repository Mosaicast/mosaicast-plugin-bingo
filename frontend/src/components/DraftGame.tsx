// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import type { UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { bankLeft, checkSquare, formatClock, seatOf, timeLeft } from '../draft';
import type { DraftSeat, DraftView } from '../types';
import { BingoGrid, cellsFor } from './BingoGrid';
import { nameOf } from './common';

const MAX_TEXT = 140;

/**
 * A running or finished round: whose turn it is, everyone's clock, the vote, and every card.
 *
 * Nothing here judges a move. A square is placed by asking the backend (`draft-move`), and what it answers,
 * or the event that follows, is what the screen shows.
 */
export function DraftGame({
  i18n,
  view,
  me,
  people,
  serverNow,
  act,
  onError,
}: {
  i18n: PluginI18n;
  view: DraftView;
  me: string;
  people: Record<string, UserRef>;
  /** The server's clock, ticking. */
  serverNow: number;
  act: (name: string, payload: Record<string, unknown>) => Promise<string | null>;
  onError: (code: string) => void;
}) {
  const game = view.game;
  const [picked, setPicked] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const myTurn = view.status === 'RUNNING' && game?.current === me && !game.vote;

  // A turn handed on, or a square turned down, starts the box over. The text stays when the same square is
  // still free: a disallowed square is the writer's to rephrase, not to type again from nothing.
  const mine = seatOf(view, me);
  useEffect(() => {
    if (!myTurn) {
      setPicked(null);
      return;
    }
    if (picked !== null && mine?.cells?.[picked]) setPicked(null);
  }, [myTurn, mine, picked]);

  if (!game) return null;
  const name = (id: string | null | undefined) => (id === me ? i18n.t('draft.yourCard') : nameOf(people[id ?? ''], i18n));
  const host = view.host === me;
  const left = timeLeft(view, serverNow);
  const vote = game.vote;

  const stageLabel =
    game.stage === 'SOLO'
      ? i18n.t('draft.stage.SOLO', { name: nameOf(people[game.current ?? ''], i18n) })
      : game.overtime > 0 && game.stage === 'REGULAR'
        ? i18n.t('draft.stage.overtime', { n: String(game.overtime) })
        : game.stage
          ? i18n.t(`draft.stage.${game.stage}`)
          : '';

  const place = async () => {
    if (picked === null || !text.trim()) return;
    setBusy(true);
    const failure = await act('draft-move', { cell: picked, text: text.trim() });
    setBusy(false);
    if (failure) onError(failure);
    else {
      setText('');
      setPicked(null);
    }
  };

  const check = myTurn && text.trim() ? checkSquare(view, me, text) : { repeat: false, close: [] };

  return (
    <div className="bingo__draft-game">
      {view.status === 'RUNNING' && (
        <div className={myTurn ? 'bingo__turn bingo__turn--mine' : 'bingo__turn'} aria-live="polite">
          <span className="bingo__turn-who">
            {game.current === me ? i18n.t('draft.turn.yours') : i18n.t('draft.turn.theirs', { name: name(game.current) })}
          </span>
          <span className="bingo__note">{stageLabel}</span>
          {left !== null && !vote && (
            <span className="bingo__turn-clock">{i18n.t('draft.turn.left', { time: formatClock(left) })}</span>
          )}
        </div>
      )}

      <ul className="bingo__seats">
        {game.seats.map((seat) => (
          <SeatRow key={seat.userId} i18n={i18n} view={view} seat={seat} name={nameOf(people[seat.userId], i18n)}
            current={game.current === seat.userId} online={(view.online ?? []).includes(seat.userId)}
            serverNow={serverNow} squares={seat.cells?.length ?? 0} />
        ))}
      </ul>

      {game.turnedDown && !vote && (
        <p className="bingo__warn">
          {i18n.t('draft.turnedDown', { text: game.turnedDown.text, name: nameOf(people[game.turnedDown.by], i18n) })}
        </p>
      )}

      {vote && <VotePanel i18n={i18n} view={view} me={me} people={people} serverNow={serverNow} act={act} onError={onError} />}

      {mine?.cells && (
        <section className="bingo__draft-mine">
          <p className="bingo__section-title">{i18n.t('draft.yourCard')}</p>
          {myTurn && <p className="bingo__note">{i18n.t('draft.turn.pick')}</p>}
          <PickGrid
            size={view.size}
            freeCentre={view.freeCentre}
            cells={mine.cells}
            picked={picked}
            pending={text}
            i18n={i18n}
            onPick={myTurn ? setPicked : undefined}
          />
          {myTurn && picked !== null && (
            <div className="bingo__draft-entry">
              <label className="bingo__field">
                {i18n.t('draft.turn.square', { n: String(picked + 1) })}
                <input
                  className="bingo__input"
                  value={text}
                  maxLength={MAX_TEXT}
                  placeholder={i18n.t('draft.turn.placeholder')}
                  autoFocus
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !check.repeat) void place();
                  }}
                />
              </label>
              <button type="button" className="bingo__btn" disabled={busy || !text.trim() || check.repeat}
                onClick={() => void place()}>
                {busy ? i18n.t('draft.turn.placing') : i18n.t('draft.turn.place')}
              </button>
              {check.repeat && <p className="bingo__warn">{i18n.t('draft.turn.repeat')}</p>}
              {!check.repeat && check.close[0] && (
                <p className="bingo__note">
                  {i18n.t('draft.turn.close', { name: nameOf(people[check.close[0].userId], i18n), text: check.close[0].text })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <div className="bingo__draft-others">
        {game.seats
          .filter((s) => s.userId !== me)
          .map((seat) => (
            <section key={seat.userId} className="bingo__draft-card">
              <p className="bingo__section-title">{i18n.t('draft.cardOf', { name: nameOf(people[seat.userId], i18n) })}</p>
              <BingoGrid size={view.size} freeCentre={view.freeCentre} entries={seat.cells ?? []} i18n={i18n}
                label={i18n.t('draft.cardOf', { name: nameOf(people[seat.userId], i18n) })} />
            </section>
          ))}
      </div>

      {host && view.status === 'RUNNING' && (
        <div className="bingo__actions">
          {game.stage === 'SOLO' && (
            <button type="button" className="bingo__btn bingo__btn--quiet" onClick={async () => {
              if (!window.confirm(i18n.t('draft.endConfirm'))) return;
              const failure = await act('draft-end', {});
              if (failure) onError(failure);
            }}>
              {i18n.t('draft.end')}
            </button>
          )}
          <button type="button" className="bingo__btn bingo__btn--quiet" onClick={async () => {
            if (!window.confirm(i18n.t('draft.lobby.cancelConfirm'))) return;
            const failure = await act('draft-cancel', {});
            if (failure) onError(failure);
          }}>
            {i18n.t('draft.lobby.cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

/** One player: name, whether they're here, their bank, how far they are. */
function SeatRow({
  i18n,
  view,
  seat,
  name,
  current,
  online,
  serverNow,
  squares,
}: {
  i18n: PluginI18n;
  view: DraftView;
  seat: DraftSeat;
  name: string;
  current: boolean;
  online: boolean;
  serverNow: number;
  squares: number;
}) {
  const bank = bankLeft(view, seat, serverNow);
  return (
    <li className={current ? 'bingo__seat bingo__seat--current' : 'bingo__seat'}>
      <span className={online ? 'bingo__dot bingo__dot--on' : 'bingo__dot'} aria-hidden="true" />
      <span className="bingo__seat-name">
        {name}
        <span className="bingo__sr">{online ? i18n.t('draft.online') : i18n.t('draft.away')}</span>
      </span>
      <span className="bingo__note">
        {seat.filled}/{squares || seat.filled}
        {seat.out && ` · ${i18n.t('draft.seat.out')}`}
        {seat.done && ` · ${i18n.t('draft.seat.done')}`}
        {seat.skipped > 0 && ` · ${i18n.t('draft.seat.skipped', { count: String(seat.skipped) })}`}
      </span>
      {bank !== null && view.status === 'RUNNING' && (
        <span className="bingo__seat-clock">{i18n.t('draft.seat.bank', { time: formatClock(bank) })}</span>
      )}
    </li>
  );
}

/** The vote on a square close to another card's: the writer waits, the others decide, the host breaks a silence. */
function VotePanel({
  i18n,
  view,
  me,
  people,
  serverNow,
  act,
  onError,
}: {
  i18n: PluginI18n;
  view: DraftView;
  me: string;
  people: Record<string, UserRef>;
  serverNow: number;
  act: (name: string, payload: Record<string, unknown>) => Promise<string | null>;
  onError: (code: string) => void;
}) {
  const vote = view.game!.vote!;
  const [busy, setBusy] = useState(false);
  const canVote = vote.awaitingHost
    ? view.host === me
    : vote.voters.includes(me) && !vote.voted.includes(me);
  const cast = async (allow: boolean) => {
    setBusy(true);
    const failure = await act('draft-vote', { allow });
    setBusy(false);
    if (failure) onError(failure);
  };
  const left = timeLeft(view, serverNow);
  const counts = { voted: String(vote.voted.length), voters: String(vote.voters.length) };

  return (
    <section className="bingo__vote" aria-live="polite">
      <p className="bingo__title">{i18n.t('draft.vote.title')}</p>
      <p>{i18n.t('draft.vote.body', { name: nameOf(people[vote.by], i18n), text: vote.text })}</p>
      <ul className="bingo__vote-matches">
        {vote.matches.map((m) => (
          <li key={`${m.userId}-${m.cell}`}>{i18n.t('draft.vote.match', { name: nameOf(people[m.userId], i18n), text: m.text })}</li>
        ))}
      </ul>
      {vote.awaitingHost ? (
        <p className="bingo__note">
          {view.host === me ? i18n.t('draft.vote.host') : i18n.t('draft.vote.awaitingHost', { name: nameOf(people[view.host], i18n) })}
        </p>
      ) : (
        <p className="bingo__note">
          {vote.voted.includes(me) ? i18n.t('draft.vote.youVoted', counts) : i18n.t('draft.vote.waiting', counts)}
          {left !== null && ` · ${i18n.t('draft.vote.timeLeft', { time: formatClock(left) })}`}
        </p>
      )}
      {canVote && (
        <div className="bingo__actions">
          <button type="button" className="bingo__btn" disabled={busy} onClick={() => void cast(true)}>
            {i18n.t('draft.vote.allow')}
          </button>
          <button type="button" className="bingo__btn bingo__btn--quiet" disabled={busy} onClick={() => void cast(false)}>
            {i18n.t('draft.vote.disallow')}
          </button>
        </div>
      )}
      <p className="bingo__note">{i18n.t('draft.vote.rule')}</p>
    </section>
  );
}

/** The player's own card: an empty square is a button while it's their turn, and the picked one previews the text. */
function PickGrid({
  size,
  freeCentre,
  cells,
  picked,
  pending,
  i18n,
  onPick,
}: {
  size: number;
  freeCentre: boolean;
  cells: string[];
  picked: number | null;
  pending: string;
  i18n: PluginI18n;
  onPick?: (index: number) => void;
}) {
  return (
    <div className="bingo__grid-wrap">
      <div className="bingo__grid" role="group" aria-label={i18n.t('draft.yourCard')}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
        {cellsFor(size, freeCentre).map((cell, i) => {
          if (cell.kind === 'free') {
            return (
              <div key={`free-${i}`} className="bingo__cell bingo__cell--free bingo__cell--hit">
                <span className="bingo__cell-text">{i18n.t('episode.freeCentre')}</span>
              </div>
            );
          }
          const value = cells[cell.index] ?? '';
          const isPicked = picked === cell.index;
          if (!value && onPick) {
            return (
              <button
                key={cell.index}
                type="button"
                className={isPicked ? 'bingo__cell bingo__cell--pick bingo__cell--picked' : 'bingo__cell bingo__cell--pick'}
                aria-pressed={isPicked}
                aria-label={i18n.t('draft.turn.square', { n: String(cell.index + 1) })}
                onClick={() => onPick(cell.index)}
              >
                <span className="bingo__cell-text">{isPicked ? pending : ''}</span>
              </button>
            );
          }
          return (
            <div key={cell.index} className={value ? 'bingo__cell' : 'bingo__cell bingo__cell--empty'}>
              <span className="bingo__cell-text">{value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
