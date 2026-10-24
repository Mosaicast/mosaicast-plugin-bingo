// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { normalise, similarity } from './fuzzy';
import type { DraftMatch, DraftSeat, DraftUpdate, DraftView } from './types';

/**
 * Pure helpers for a draft round in the browser: applying the backend's events, the clocks, the turn order.
 *
 * The backend is the only judge of a round (`BingoDraft`); nothing here decides anything. It only keeps the
 * screen in step with what the backend said, between one `draft-state` and the next.
 */

/** Every rejection code the backend sends, so each has its own sentence. Anything else gets a general one. */
export const DRAFT_ERRORS = [
  'bad-cell',
  'bad-request',
  'bad-settings',
  'cell-taken',
  'closed',
  'empty',
  'full',
  'has-card',
  'host-cannot-leave',
  'no-bingo',
  'no-vote',
  'not-a-voter',
  'not-an-episode',
  'not-found',
  'not-host',
  'not-invited',
  'not-solo',
  'not-started',
  'not-your-turn',
  'over',
  'quiet',
  'repeat',
  'stale-order',
  'too-few',
  'too-long',
  'too-many',
  'vote-open',
  'voted',
] as const;

/** The locale key for a rejection code. */
export function draftErrorKey(code: string): string {
  return (DRAFT_ERRORS as readonly string[]).includes(code) ? `draft.error.${code}` : 'draft.error.generic';
}

/**
 * Applies one `update` event to the round on screen.
 *
 * @returns the new view; the same view for an event already seen; or `null` when one went missing in between,
 *          which means fetching the whole round again
 */
export function applyUpdate(view: DraftView, update: DraftUpdate): DraftView | null {
  if (update.version <= view.version) return view;
  if (update.version !== view.version + 1) return null;
  const before = new Map((view.game?.seats ?? []).map((s) => [s.userId, s.cells]));
  const seats: DraftSeat[] = (update.game?.seats ?? []).map((seat) => {
    const cells = [...(before.get(seat.userId) ?? emptyCells(view))];
    if (update.written && update.written.userId === seat.userId) {
      cells[update.written.cell] = update.written.text;
    }
    return { ...seat, cells };
  });
  const { written: _written, ...rest } = update;
  return {
    ...rest,
    code: view.code,
    online: view.online,
    quiet: view.quiet,
    quietEpisode: view.quietEpisode,
    hostHasCard: view.hostHasCard,
    episode: update.episode ?? view.episode,
    game: update.game ? { ...update.game, seats } : undefined,
  };
}

function emptyCells(view: DraftView): string[] {
  const squares = view.size * view.size - (view.freeCentre && view.size % 2 === 1 ? 1 : 0);
  return Array.from({ length: squares }, () => '');
}

/** One seat, by user. */
export function seatOf(view: DraftView, userId: string | undefined): DraftSeat | undefined {
  return view.game?.seats.find((s) => s.userId === userId);
}

/**
 * What is left on a player's bank right now, in milliseconds, or `null` without a bank. The current player's
 * runs down while it's their turn; a vote pauses it.
 *
 * @param serverNow the server's clock now, from `view.now` plus the time since it was received
 */
export function bankLeft(view: DraftView, seat: DraftSeat, serverNow: number): number | null {
  if (seat.bankMs === null) return null;
  const game = view.game;
  if (!game || game.current !== seat.userId || game.vote || game.stage === 'SOLO' || view.status !== 'RUNNING') {
    return seat.bankMs;
  }
  return Math.max(0, seat.bankMs - game.usedMs - Math.max(0, serverNow - game.turnStartedAt));
}

/** How long until the turn or the vote runs out, in milliseconds, or `null` when nothing will. */
export function timeLeft(view: DraftView, serverNow: number): number | null {
  const game = view.game;
  const due = game?.deadline;
  if (!game || due === null || due === undefined) return null;
  // Never more than the whole turn or vote: a device clock a little behind the server's would otherwise
  // show 0:16 on a 15 second turn.
  const whole = game.vote ? VOTE_MS : due - game.turnStartedAt;
  return Math.max(0, Math.min(due - serverNow, whole));
}

/** How long a vote runs, as `BingoDraft.VOTE_MS`. */
export const VOTE_MS = 30_000;

/** `m:ss`, or `h:mm:ss` from an hour. Rounded up, so a clock never shows 0:00 while time is left. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The list with one item moved from one place to another. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The link anyone signed in can join with. */
export function inviteLink(origin: string, id: string, code: string): string {
  return `${origin}/p/bingo/draft/${id}?code=${encodeURIComponent(code)}`;
}

/**
 * What the backend will most likely say about a square before it is placed: a repeat of the writer's own
 * square (refused outright), or squares on other cards close enough to go to a vote. Only a hint; the
 * backend's own check decides (`BingoFuzzy`, the same rules).
 */
export function checkSquare(
  view: DraftView,
  me: string,
  text: string,
): { repeat: boolean; close: DraftMatch[] } {
  const form = normalise(text);
  if (!form) return { repeat: false, close: [] };
  const mine = seatOf(view, me)?.cells ?? [];
  const repeat = mine.some((c) => c && normalise(c) === form);
  const close: DraftMatch[] = [];
  if (view.settings.duplicateCheck) {
    for (const seat of view.game?.seats ?? []) {
      if (seat.userId === me) continue;
      (seat.cells ?? []).forEach((c, cell) => {
        const other = c ? normalise(c) : '';
        if (other && similarity(form, other) >= view.threshold) close.push({ userId: seat.userId, cell, text: c });
      });
    }
  }
  return { repeat, close };
}
