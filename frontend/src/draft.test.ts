// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { applyUpdate, bankLeft, checkSquare, draftErrorKey, formatClock, moveItem } from './draft';
import type { DraftUpdate, DraftView } from './types';
import en from '../locales/en.json';
import de from '../locales/de.json';
import draftJava from '../../backend/src/main/java/dev/mosaicast/plugin/bingo/BingoDraft.java?raw';
import draftsJava from '../../backend/src/main/java/dev/mosaicast/plugin/bingo/BingoDrafts.java?raw';

const base = (): DraftView => ({
  id: 'r',
  version: 4,
  now: 100_000,
  status: 'RUNNING',
  episode: 'ep',
  host: 'a',
  size: 2,
  freeCentre: false,
  threshold: 0.85,
  settings: { clock: true, turnSeconds: 30, bankSeconds: 600, incrementSeconds: 0, duplicateCheck: true },
  invited: [],
  order: ['a', 'b'],
  createdAt: 0,
  code: 'secret',
  online: ['a'],
  game: {
    stage: 'REGULAR',
    overtime: 0,
    current: 'a',
    turnStartedAt: 90_000,
    usedMs: 0,
    turnLimitMs: 30_000,
    deadline: 120_000,
    seats: [
      { userId: 'a', bankMs: 600_000, out: false, done: false, skipped: 0, filled: 1, cells: ['Rain', '', '', ''] },
      { userId: 'b', bankMs: 600_000, out: false, done: false, skipped: 0, filled: 0, cells: ['', '', '', ''] },
    ],
  },
});

const update = (version: number, written?: DraftUpdate['written']): DraftUpdate => {
  const { code: _c, online: _o, quiet: _q, quietEpisode: _e, ...rest } = base();
  return {
    ...rest,
    version,
    game: { ...rest.game!, current: 'b', seats: rest.game!.seats.map(({ cells: _cells, ...s }) => s) },
    written,
  };
};

describe('applyUpdate', () => {
  it('applies the next version and the square it wrote, keeping the cards it left out', () => {
    const next = applyUpdate(base(), update(5, { userId: 'b', cell: 2, text: 'Sun' }))!;
    expect(next.version).toBe(5);
    expect(next.game?.current).toBe('b');
    expect(next.game?.seats[0].cells).toEqual(['Rain', '', '', '']);
    expect(next.game?.seats[1].cells).toEqual(['', '', 'Sun', '']);
    expect(next.code).toBe('secret');
    expect(next.online).toEqual(['a']);
  });

  it('ignores what it has already seen', () => {
    const view = base();
    expect(applyUpdate(view, update(4))).toBe(view);
  });

  it('asks for a fetch when a version went missing', () => {
    expect(applyUpdate(base(), update(6))).toBeNull();
  });
});

describe('clocks', () => {
  it('runs the current player\'s bank down and pauses it for a vote', () => {
    const view = base();
    expect(bankLeft(view, view.game!.seats[0], 100_000)).toBe(590_000);
    expect(bankLeft(view, view.game!.seats[1], 100_000)).toBe(600_000);
    const voting = { ...view, game: { ...view.game!, vote: { by: 'a' } as never } };
    expect(bankLeft(voting, view.game!.seats[0], 100_000)).toBe(600_000);
  });

  it('formats a clock, rounding up', () => {
    expect(formatClock(59_001)).toBe('1:00');
    expect(formatClock(5_000)).toBe('0:05');
    expect(formatClock(3_600_000)).toBe('1:00:00');
  });
});

describe('moveItem', () => {
  it('moves one item and leaves an out-of-range move alone', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});

describe('checkSquare', () => {
  it('flags a repeat of your own square and one close to somebody else\'s', () => {
    const view = base();
    expect(checkSquare(view, 'a', 'rain!').repeat).toBe(true);
    const close = checkSquare(view, 'b', 'rain');
    expect(close.repeat).toBe(false);
    expect(close.close).toEqual([{ userId: 'a', cell: 0, text: 'Rain' }]);
  });

  it('says nothing about others when the check is off', () => {
    const view = base();
    view.settings.duplicateCheck = false;
    expect(checkSquare(view, 'b', 'rain').close).toEqual([]);
  });
});

it('maps every known code to its own sentence and the rest to a general one', () => {
  expect(draftErrorKey('not-your-turn')).toBe('draft.error.not-your-turn');
  expect(draftErrorKey('something-new')).toBe('draft.error.generic');
});

describe('rejection codes', () => {
  it('has a sentence in every language for every code the backend sends', () => {
    const java = `${draftJava}\n${draftsJava}`;
    const sent = [...java.matchAll(/Refused\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);
    expect(sent.length).toBeGreaterThan(10);
    for (const code of sent) {
      expect(draftErrorKey(code), code).not.toBe('draft.error.generic');
      expect((en as Record<string, string>)[`draft.error.${code}`], code).toBeTruthy();
      expect((de as Record<string, string>)[`draft.error.${code}`], code).toBeTruthy();
    }
  });
});
