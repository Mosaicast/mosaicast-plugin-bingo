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
      .withDisplay('ep-1', { title: 'The Kraken', description: '' })
      .withDisplay('ep-2', { title: 'Merch Special', description: '' });

  const STATS = {
    players: [{ author: 'u1', fields: 9, lines: 3, cards: 2, cells: 18 }],
    episodes: 2,
    bingos: [
      { slug: 'ep-1', title: 'Bingo', phase: 'RESOLVED', players: 4 },
      { slug: 'ep-2', title: '', phase: 'OPEN', players: 1 },
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

  it('lists the standings and every bingo the visitor may see', async () => {
    const ctx = await render('', { 'data/site/main/stats': STATS });

    expect(host.textContent).toContain('Ned');
    expect(host.textContent).toContain('3 lines, 9 squares over 2 card(s)');
    expect(host.textContent).toContain('The Kraken');
    expect(host.textContent).toContain('Merch Special');
    expect(host.querySelectorAll('.bingo__list li')).toHaveLength(2);

    await act(async () => (host.querySelector('.bingo__list a') as HTMLAnchorElement).click());
    expect(ctx.navigations).toEqual([{ subpath: 'e/ep-1', replace: false }]);
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
