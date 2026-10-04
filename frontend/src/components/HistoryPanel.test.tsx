// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockCtx } from '@mosaicast/plugin-sdk/testing';
import { makeI18n } from '../i18n';
import type { History, HistoryEpisode } from '../types';
import { EpisodeScores, HistoryPanel } from './HistoryPanel';

const ep = (slug: string, season: number, episodeNo: number, extra: Partial<HistoryEpisode> = {}): HistoryEpisode => ({
  slug, feed: 'cast', season, episodeNo, players: 4, ranked: 3, late: 1, avgFields: 4, avgLines: 1,
  withLine: 0.5, hitRate: 0.4, candidates: 10, lineCounts: [1, 1, 1], ...extra,
});

const HISTORY: History = {
  rankBy: 'lines',
  episodes: [ep('e1', 1, 1), ep('e2', 1, 2, { hitRate: 0.8 }), ep('e3', 2, 1), ep('e4', 2, 2)],
  players: [
    { author: 'u1', cards: 4, points: [0, 1, 2, 3].map((e) => ({ e, f: 5, l: 2, p: 1 })) },
    { author: 'u2', cards: 3, points: [0, 1, 3].map((e) => ({ e, f: 4, l: 1, p: 2 })) },
    { author: 'u3', cards: 1, points: [{ e: 2, f: 2, l: 0, p: 3 }] },
  ],
  records: {
    bestCard: { author: 'u1', slug: 'e1', fields: 5, lines: 2, cells: 9 },
    longestStreak: { author: 'u1', count: 4 },
    mostPredictable: { slug: 'e2', hitRate: 0.8 },
    leastPredictable: { slug: 'e1', hitRate: 0.4 },
  },
};

describe('<HistoryPanel>', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const people = {
    u1: { id: 'u1', displayName: 'Ned', avatarUrl: '/a', role: 'fan' as const },
    u2: { id: 'u2', displayName: 'Alice', avatarUrl: '/b', role: 'fan' as const },
    u3: { id: 'u3', displayName: 'Bob', avatarUrl: '/c', role: 'fan' as const },
  };

  async function render(history: History | null = HISTORY, user: { id: string } | null = null) {
    const ctx = makeMockCtx(user ? { user: { ...people.u2, ...user, role: 'fan' } } : {});
    await act(async () => {
      root.render(
        <HistoryPanel ctx={ctx} i18n={makeI18n(ctx.locale)} history={history} suggestions={{
          items: [{ label: 'Kraken', people: 4, episodes: 3, hits: 2 }],
        }} snapshots={{ e1: { title: 'The Pilot', description: '' } as never }} people={people} />,
      );
    });
    return ctx;
  }
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;
  const lines = () => [...host.querySelectorAll('.bingo__series path')];

  it('says so when nothing has been resolved yet', async () => {
    await render({ episodes: [] });
    expect(host.textContent).toContain('once a bingo has been resolved');
  });

  it('sums the history up in tiles and draws one line per player', async () => {
    await render();
    expect(host.querySelector('.bingo__tiles')?.textContent).toContain('Bingos4');
    expect(lines()).toHaveLength(3);
    expect(host.querySelector('.bingo__legend')?.textContent).toContain('Ned');
    expect(host.textContent).toContain('Best single card');
    expect(host.textContent).toContain('2 line(s), 5 square(s) · Ned');
    expect(host.textContent).toContain('The Pilot');
    expect(host.textContent).toContain('“Kraken”');
  });

  it('filters every part to a season, without repainting anyone', async () => {
    await render();
    const colour = () => lines().map((p) => p.getAttribute('stroke'));
    const before = colour();

    await act(async () => button('Season 2').click());

    expect(host.querySelector('.bingo__tiles')?.textContent).toContain('Bingos2');
    expect(colour()).toEqual(before);
  });

  it('switches between per episode, running total and place, and offers a table', async () => {
    await render();
    await act(async () => button('Place').click());
    expect(host.textContent).toContain('Standing after each bingo');

    await act(async () => button('Show as table').click());
    const rows = [...host.querySelectorAll('.bingo__table tbody tr')];
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('#1');
  });

  it('marks the viewer as You and lets players be toggled', async () => {
    await render(HISTORY, { id: 'u2' });
    expect(host.querySelector('.bingo__series--me')).not.toBeNull();

    const chip = [...host.querySelectorAll<HTMLButtonElement>('.bingo__chip--player')].find((b) =>
      b.textContent?.includes('Bob'),
    )!;
    await act(async () => chip.click());
    expect(lines()).toHaveLength(2);
  });

  it('shows a tooltip for an episode on keyboard focus', async () => {
    await render();
    const band = host.querySelector<SVGRectElement>('.bingo__series ~ .bingo__hit, .bingo__hit')!;
    await act(async () => band.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(host.querySelector('.bingo__tip')?.textContent).toContain('The Pilot');
  });
});

describe('<EpisodeScores>', () => {
  it('draws how cards scored and compares predictability with the rest', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const ctx = makeMockCtx();
    await act(async () => {
      root.render(
        <EpisodeScores i18n={makeI18n(ctx.locale)} slug="e2" history={HISTORY} board={{
          published: true, distribution: [{ lines: 0, fields: 2, count: 3 }, { lines: 2, fields: 6, count: 1 }],
        }} />,
      );
    });
    expect(host.querySelectorAll('.bingo__chart path')).toHaveLength(2);
    expect(host.textContent).toContain('80% of the predictions on this bingo came true; across all bingos it is 50%.');
    act(() => root.unmount());
  });
});
