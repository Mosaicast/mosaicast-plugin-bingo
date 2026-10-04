// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import {
  defaultSelection,
  episodesIn,
  niceTicks,
  seasonsOf,
  slotOf,
  standings,
  summary,
  valuesOf,
} from './history';
import type { History, HistoryEpisode } from './types';

const ep = (slug: string, season: number, extra: Partial<HistoryEpisode> = {}): HistoryEpisode => ({
  slug, feed: 'cast', season, players: 3, ranked: 3, late: 0, avgFields: 4, avgLines: 1, withLine: 0.5,
  hitRate: 0.5, candidates: 10, ...extra,
});

const HISTORY: History = {
  episodes: [ep('e1', 1), ep('e2', 1), ep('e3', 2), ep('e4', 2, { candidates: 0, hitRate: 0 })],
  players: [
    // best cumulative first: this order is also the colour order
    { author: 'ann', cards: 3, points: [{ e: 0, f: 5, l: 2, p: 1 }, { e: 1, f: 3, l: 0, p: 3 }, { e: 3, f: 6, l: 2, p: 1 }] },
    { author: 'bob', cards: 3, points: [{ e: 0, f: 4, l: 1, p: 2 }, { e: 1, f: 5, l: 1, p: 1 }, { e: 2, f: 5, l: 1, p: 1 }] },
    { author: 'cy', cards: 1, points: [{ e: 2, f: 2, l: 0, p: 2 }] },
  ],
  rankBy: 'lines',
};
const ALL = [0, 1, 2, 3];
const [ann, bob, cy] = HISTORY.players!;

describe('history transforms', () => {
  it('offers each season once, in the order played, and filters to it', () => {
    expect(seasonsOf(HISTORY)).toEqual([{ key: 'cast:1', season: 1 }, { key: 'cast:2', season: 2 }]);
    expect(episodesIn(HISTORY, 'cast:2')).toEqual([2, 3]);
    expect(episodesIn(HISTORY, null)).toEqual(ALL);
  });

  it('leaves a gap per episode and carries the running total across one sat out', () => {
    expect(valuesOf(ann, ALL, 'episode', 'lines')).toEqual([2, 0, null, 2]);
    expect(valuesOf(ann, ALL, 'total', 'lines')).toEqual([2, 2, 2, 4]);
    // Nothing before the first card.
    expect(valuesOf(cy, ALL, 'total', 'lines')).toEqual([null, null, 0, 0]);
    expect(valuesOf(ann, ALL, 'episode', 'fields')).toEqual([5, 3, null, 6]);
  });

  it('runs the total within the filter only', () => {
    expect(valuesOf(ann, [2, 3], 'total', 'lines')).toEqual([null, 2]);
  });

  it('places everyone after each episode by running total, ties sharing a place', () => {
    const places = standings(HISTORY.players!, ALL, 'lines');
    expect(places.get('ann')).toEqual([1, 1, 2, 1]);
    // Level with ann after e2, ahead after e3.
    expect(places.get('bob')).toEqual([2, 1, 1, 2]);
    expect(places.get('cy')).toEqual([null, null, 3, 3]);
    expect(valuesOf(bob, ALL, 'place', 'lines', places)).toEqual([2, 1, 1, 2]);
  });

  it('starts with the top five plus the viewer, and keeps each colour whatever is filtered', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ author: `p${i}`, cards: 1, points: [] }));
    expect(defaultSelection(many, 'p7')).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p7']);
    expect(defaultSelection(many, 'stranger')).toHaveLength(5);
    expect(slotOf(HISTORY.players!, 'cy')).toBe(2);
  });

  it('sums up the kept episodes over everyone', () => {
    const s = summary(HISTORY, [2, 3]);
    expect(s.bingos).toBe(2);
    expect(s.cards).toBe(6);
    expect(s.namedPlayers).toBe(3);
    // An episode with nothing decided says nothing about predictability.
    expect(s.hitRate).toBe(0.5);
  });

  it('ticks round numbers up to the maximum', () => {
    expect(niceTicks(8)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(2)).toEqual([0, 1, 2]);
    expect(niceTicks(1, { fractional: true })).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
});

