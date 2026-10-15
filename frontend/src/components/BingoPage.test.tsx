// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockDocs, makeMockFeeds, makeMockUsers } from '@mosaicast/plugin-sdk/testing';
import { BingoPage } from './BingoPage';
import { flush, makeBingoCtx } from '../test-utils';

describe('<BingoPage>', () => {
  const site = { type: 'site' as const, id: 'main' };
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

  const feeds = () =>
    makeMockFeeds()
      .withDisplay('ep-1', { title: 'The Kraken', description: '', feed: 'cast', season: 1, episodeNo: 1 })
      .withDisplay('ep-2', { title: 'Merch Special', description: '', feed: 'cast', season: 2, episodeNo: 1 });

  const STATS = {
    players: [{ author: 'u1', fields: 9, lines: 3, cards: 2, cells: 18 }],
    episodes: 2,
    bingos: [
      { slug: 'ep-1', title: 'Bingo', phase: 'RESOLVED', players: 4, feed: 'cast', season: 1 },
      { slug: 'ep-2', title: '', phase: 'OPEN', players: 1, feed: 'cast', season: 2 },
      // Absent from the feeds double, as an episode this visitor may not see is absent from the host.
      { slug: 'hidden', title: '', phase: 'OPEN', players: 2 },
    ],
  };

  const BOARD = {
    published: true, players: 2, totalPlayers: 2, rankBy: 'lines',
    ranked: [{ author: 'u1', fields: 3, lines: 1, cells: 9, ranked: true }],
    late: [],
  };

  async function render(path: string, docs: Record<string, unknown>) {
    const ctx = makeBingoCtx({
      scope: site,
      docs: makeMockDocs(docs),
      feeds: feeds(),
      users: makeMockUsers({ u1: 'Ned' }),
      route: { path },
    });
    await act(async () => {
      root.render(<BingoPage ctx={ctx} />);
    });
    await flush(ctx);
    await flush(ctx);
    return ctx;
  }

  /** The all-time standings come from the history's "all" scope, like every other ranking on the page. */
  const HISTORY = {
    episodes: [{ slug: 'ep-1', feed: 'cast', season: 1, episodeNo: 1, players: 4, ranked: 4, late: 0, avgFields: 4,
      avgLines: 1, withLine: 0.5, hitRate: 0.5, candidates: 10 }],
    scopes: {
      all: { bar: 3, belowBar: 0, bingos: 2, byTotal: [{ author: 'u1', fields: 9, lines: 3, cards: 2, cells: 18 }] },
      'cast:1': { bar: 1, belowBar: 0, bingos: 1, byTotal: [{ author: 'u1', fields: 4, lines: 1, cards: 1, cells: 9 }] },
    },
  };

  it('lists the standings and every bingo the visitor may see', async () => {
    const ctx = await render('', { 'data/site/main/stats': STATS, 'data/site/main/history': HISTORY });

    expect(host.textContent).toContain('Ned');
    expect(host.textContent).toContain('3 line(s), 9 square(s) over 2 card(s)');
    expect(host.textContent).toContain('The Kraken');
    expect(host.textContent).toContain('Merch Special');
    expect(host.querySelectorAll('.bingo__open-card')).toHaveLength(1);
    expect(host.querySelector('.bingo__open-card')!.textContent).toContain('Open');
    expect(host.querySelectorAll('.bingo__item')).toHaveLength(1);

    await act(async () => host.querySelector<HTMLAnchorElement>('.bingo__item-link')!.click());
    expect(ctx.navigations).toEqual([{ subpath: 'e/ep-1', replace: false }]);
  });

  it('filters the whole page by season, open seasons included, behind a real address', async () => {
    const docs = { 'data/site/main/stats': STATS, 'data/site/main/history': HISTORY };
    const ctx = await render('', docs);
    const tabs = () => [...host.querySelectorAll<HTMLAnchorElement>('.bingo__tab-link')];
    expect(tabs().map((t) => t.textContent)).toEqual(['All', 'Season 1', 'Season 2']);
    expect(tabs()[0].getAttribute('aria-current')).toBe('page');
    expect(tabs()[1].getAttribute('href')).toBe('/p/bingo/season/1');

    await act(async () => tabs()[1].click());
    expect(ctx.navigations).toEqual([{ subpath: 'season/1', replace: false }]);

    await render('season/1', docs);
    expect(host.textContent).toContain('Standings · Season 1');
    expect(host.textContent).toContain('1 line(s), 4 square(s) over 1 card(s)');
    expect(host.querySelectorAll('.bingo__item')).toHaveLength(1);
    expect(host.querySelector('.bingo__open-card')).toBeNull();

    await render('season/2', docs);
    expect(host.querySelectorAll('.bingo__open-card')).toHaveLength(1); // a season with only an open bingo has a tab

    await render('season/9', docs);
    expect(host.textContent).toContain('There is no bingo here.');
  });

  it('shows one bingo with a way into the episode', async () => {
    await render('e/ep-1', {
      'data/episode/ep-1/template': { size: 3, title: 'Kraken bingo' },
      'data/episode/ep-1/phase': { phase: 'RESOLVED', suggested: 'LOCKED' },
      'data/episode/ep-1/leaderboard': BOARD,
    });

    expect(host.textContent).toContain('Kraken bingo');
    expect(host.querySelector<HTMLAnchorElement>('a.bingo__btn')?.getAttribute('href')).toBe('/episodes/ep-1');
    expect(host.textContent).toContain('Ned');
  });

  it('opens a shared link on the named player’s result', async () => {
    await render('e/ep-1/u/u1', {
      'data/episode/ep-1/template': { size: 3 },
      'data/episode/ep-1/phase': { phase: 'RESOLVED', suggested: 'LOCKED' },
      'data/episode/ep-1/leaderboard': BOARD,
    });

    expect(host.textContent).toContain('Ned: 1 of 8 lines, 3 of 9 squares');
  });

  it('says there is nothing at an address it does not know', async () => {
    await render('nonsense/path', {});
    expect(host.textContent).toContain('There is no bingo here.');

    await render('e/hidden', { 'data/episode/hidden/template': { size: 3 } });
    expect(host.textContent).toContain('There is no bingo here.');
  });
});
