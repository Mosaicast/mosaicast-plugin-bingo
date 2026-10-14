// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DisplaySnapshot } from '@mosaicast/plugin-sdk';
import { makeMockCtx } from '@mosaicast/plugin-sdk/testing';
import { makeI18n } from '../i18n';
import type { BingoSummary, History, Phase } from '../types';
import { BingoList } from './BingoList';

/** A season of 30 resolved bingos, a second one with two resolved and one open, and a locked one. */
function site() {
  const bingos: BingoSummary[] = [];
  const snapshots: Record<string, DisplaySnapshot> = {};
  const add = (season: number, n: number, phase: Phase) => {
    const slug = `s${season}e${n}`;
    bingos.push({ slug, title: '', phase, players: n, feed: 'cast', season });
    snapshots[slug] = {
      title: `Episode ${season}.${n}`, description: '', feed: 'cast', season, episodeNo: n,
      publishedAt: new Date(Date.UTC(2025 + season, 0, n)).toISOString(),
    } as DisplaySnapshot;
  };
  for (let n = 1; n <= 30; n++) add(1, n, 'RESOLVED');
  add(2, 1, 'ARCHIVED');
  add(2, 2, 'RESOLVED');
  add(2, 3, 'OPEN');
  add(2, 4, 'LOCKED');
  return { bingos, snapshots };
}

const HISTORY: History = {
  episodes: [{ slug: 's2e2', feed: 'cast', season: 2, episodeNo: 2, players: 2, ranked: 2, late: 0, avgFields: 4,
    avgLines: 1, withLine: 1, hitRate: 0.625, candidates: 8 }],
};

describe('<BingoList>', () => {
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

  async function render(season: string | null = null) {
    const ctx = makeMockCtx();
    const { bingos, snapshots } = site();
    await act(async () => {
      root.render(<BingoList ctx={ctx} i18n={makeI18n(ctx.locale)} bingos={bingos} snapshots={snapshots}
        history={HISTORY} season={season} />);
    });
    return ctx;
  }

  it('puts the open and locked bingos first, as cards with their way in', async () => {
    await render();
    const cards = [...host.querySelectorAll('.bingo__open-card')];
    expect(cards.map((c) => c.querySelector('.bingo__code')?.textContent)).toEqual(['S2E4', 'S2E3']);
    expect(cards[1].textContent).toContain('Open');
    expect(cards[1].querySelector('a')?.getAttribute('href')).toBe('/episodes/s2e3');
    expect(cards[0].textContent).toContain('Locked');
    expect(cards[0].textContent).toContain('waiting for the answers');
  });

  it('folds past bingos by season, the newest season open and first', async () => {
    await render();
    const groups = [...host.querySelectorAll('details.bingo__group')] as HTMLDetailsElement[];
    expect(groups.map((g) => g.querySelector('.bingo__group-title')?.textContent)).toEqual(['Season 2', 'Season 1']);
    expect(groups.map((g) => g.open)).toEqual([true, false]);
    expect(groups[0].querySelector('summary')?.textContent).toContain('2 bingo(s) · 63% came true');
    const first = groups[0].querySelector('.bingo__item')!;
    expect(first.textContent).toContain('S2E2');
    expect(first.textContent).toContain('63% came true');
    expect(groups[1].querySelectorAll('.bingo__item')).toHaveLength(30);
  });

  it('offers a search once the list is long, and drops the folding while it runs', async () => {
    await render();
    const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 's1e2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('details')).toBeNull();
    // S1E2 and S1E20 to S1E29.
    expect(host.querySelectorAll('.bingo__item')).toHaveLength(11);

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'nothing like it');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('No bingo matches.');
  });

  it('names the feed in a season group once two feeds share the list', async () => {
    const ctx = makeMockCtx();
    const { bingos, snapshots } = site();
    bingos.push({ slug: 'x1', title: '', phase: 'RESOLVED', players: 3, feed: 'other-cast', season: 1 });
    snapshots.x1 = { title: 'Elsewhere', description: '', feed: 'other-cast', season: 1, episodeNo: 1,
      publishedAt: '2027-06-01T00:00:00Z' } as DisplaySnapshot;
    await act(async () => {
      root.render(<BingoList ctx={ctx} i18n={makeI18n(ctx.locale)} bingos={bingos} snapshots={snapshots}
        history={HISTORY} season={null} />);
    });
    expect([...host.querySelectorAll('.bingo__group-title')].map((t) => t.textContent)).toEqual([
      'Season 1 · Other cast', 'Season 2 · Cast', 'Season 1 · Cast',
    ]);
  });

  it('shows one season flat when the page is filtered to it', async () => {
    await render('cast:2');
    expect(host.querySelector('details')).toBeNull();
    expect(host.querySelectorAll('.bingo__item')).toHaveLength(2);
    expect(host.querySelectorAll('.bingo__open-card')).toHaveLength(2);
    expect(host.querySelector('input[type="search"]')).toBeNull();
  });
});
