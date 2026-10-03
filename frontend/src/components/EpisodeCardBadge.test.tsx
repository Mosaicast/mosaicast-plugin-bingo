// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockDocs, makeMockEpisode } from '@mosaicast/plugin-sdk/testing';
import { EpisodeCardBadge } from './EpisodeCardBadge';
import { flush, makeBingoCtx } from '../test-utils';
import { forgetOwnCards } from './useBingo';

describe('<EpisodeCardBadge>', () => {
  let host: HTMLDivElement;
  let root: Root;
  let episode = 0;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    // A fresh episode id per test: reads are shared across mounts by scope, which is the whole point of
    // the cache, and would otherwise carry one test's documents into the next.
    episode += 1;
    forgetOwnCards();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = async (docs: Record<string, unknown>) => {
    const scope = { type: 'episode' as const, id: `badge-ep-${episode}` };
    const withKeys = Object.fromEntries(
      Object.entries(docs).map(([k, v]) => [`data/episode/${scope.id}/${k}`, v]),
    );
    const ctx = makeBingoCtx({ scope, docs: makeMockDocs(withKeys) });
    await act(async () => {
      root.render(<EpisodeCardBadge ctx={ctx} />);
    });
    await flush(ctx);
    return ctx;
  };

  it('draws nothing at all for an episode with no bingo', async () => {
    await render({});

    expect(host.querySelector('.bingo__badge')).toBeNull();
  });

  it('never says there is no bingo on an episode that plainly has one', async () => {
    // The badge does not render without a template, so "No bingo" could only ever appear on a bingo that
    // exists — which is exactly what a locked one used to say about itself.
    await render({
      template: { size: 3 },
      phase: { phase: 'LOCKED', suggested: 'LOCKED' },
    });

    const badge = host.querySelector('.bingo__badge');
    expect(badge?.textContent).toContain('Predictions closed');
    expect(host.textContent).not.toContain('No bingo');
  });

  it('says a resolved bingo is resolved even when nobody agreed to be named', async () => {
    await render({
      template: { size: 3 },
      phase: { phase: 'RESOLVED', suggested: 'LOCKED' },
      leaderboard: { published: true, players: 2, ranked: [], late: [] },
    });

    expect(host.querySelector('.bingo__badge')?.textContent).toContain('Bingo resolved');
  });

  it('leads with the top score once there is a published board', async () => {
    await render({
      template: { size: 3 },
      phase: { phase: 'RESOLVED', suggested: 'LOCKED' },
      leaderboard: {
        published: true,
        players: 1,
        rankBy: 'lines',
        ranked: [{ author: 'u2', fields: 6, lines: 2, cells: 9, ranked: true }],
        late: [],
      },
    });

    expect(host.querySelector('.bingo__badge')?.textContent).toContain('2/8 lines');
  });

  it('reads its three documents in one fresh request', async () => {
    // A listing page mounts one of these per episode card, so anything read here is multiplied by the
    // length of the page: one batch per card, three keys, and none of the podcaster-only intents. And not
    // through `ctx.docs.get`, whose remembered misses kept a bingo created after the first visit off every
    // badge until a full reload.
    const scope = { type: 'episode' as const, id: `badge-ep-${episode}-reads` };
    const docs = makeMockDocs({ [`data/episode/${scope.id}/template`]: { size: 3 } });

    const ctx = makeBingoCtx({ scope, docs });
    await act(async () => {
      root.render(<EpisodeCardBadge ctx={ctx} />);
    });
    await flush(ctx);

    expect(ctx.api.calls).toEqual([
      { method: 'get', path: `data/episode?ids=${scope.id}&keys=template,phase,leaderboard` },
    ]);
    expect(docs.calls.filter((c) => c.method === 'get')).toEqual([]);
  });

  // ---------------------------------------------------------------- the viewer's own card

  const fan = { id: 'u1', role: 'fan' as const, displayName: 'Ned', avatarUrl: '/a' };

  const renderFor = async (
    docs: Record<string, unknown>,
    extra: { mine?: boolean; user?: typeof fan | null; phase?: 'planned' | 'upcoming' | 'released' } = {},
  ) => {
    const scope = { type: 'episode' as const, id: `badge-ep-${episode}` };
    const stored: Record<string, unknown> = Object.fromEntries(
      Object.entries(docs).map(([k, v]) => [`data/episode/${scope.id}/${k}`, v]),
    );
    if (extra.mine) stored[`data/user/me/card:${scope.id}`] = { entries: ['kraken'] };
    stored['data/user/me/card:some-other-episode'] = { entries: ['merch'] };
    const mockDocs = makeMockDocs(stored);
    const ctx = makeBingoCtx({
      scope,
      docs: mockDocs,
      user: extra.user === undefined ? fan : extra.user,
      episode: extra.phase ? makeMockEpisode(extra.phase) : undefined,
    });
    await act(async () => {
      root.render(<EpisodeCardBadge ctx={ctx} />);
    });
    await flush(ctx);
    return { ctx, docs: mockDocs };
  };
  const OPEN = { template: { size: 3 }, phase: { phase: 'OPEN', suggested: 'OPEN' } };
  const badge = () => host.querySelector('.bingo__badge')?.textContent;

  it('asks a player who has not filled in a card to, and urges it before the episode airs', async () => {
    await renderFor(OPEN);
    expect(badge()).toContain('Fill in your card');

    forgetOwnCards();
    await renderFor(OPEN, { phase: 'upcoming' });
    expect(badge()).toContain('Predict before it airs');
  });

  it('tells a player their card is in', async () => {
    await renderFor(OPEN, { mine: true, phase: 'upcoming' });
    expect(badge()).toContain('Your card is in');
  });

  it('leads with the player’s own score once the published board carries it', async () => {
    await renderFor(
      {
        template: { size: 3 },
        phase: { phase: 'RESOLVED', suggested: 'LOCKED' },
        leaderboard: {
          published: true, players: 2, rankBy: 'lines',
          ranked: [
            { author: 'u2', fields: 6, lines: 2, cells: 9, ranked: true },
            { author: 'u1', fields: 3, lines: 1, cells: 9, ranked: true },
          ],
          late: [],
        },
      },
      { mine: true },
    );
    expect(badge()).toContain('Your card: 1/8 lines');
  });

  it('marks a quiet bingo for the podcaster who can see it', async () => {
    await renderFor(OPEN, { user: { ...fan, role: 'podcaster' as never }, phase: 'planned' });
    expect(badge()).toContain('not announced yet');
  });

  it('asks nothing of an anonymous visitor’s partition', async () => {
    const { docs } = await renderFor(OPEN, { user: null, phase: 'upcoming' });
    expect(badge()).toContain('Predict before it airs');
    expect(docs.calls.filter((c) => c.method === 'list')).toHaveLength(0);
  });

  it('lists the viewer’s own cards once for every badge on the page', async () => {
    const { docs } = await renderFor(OPEN);
    // A second badge on the same page, for another episode.
    episode += 1;
    const second = document.createElement('div');
    document.body.appendChild(second);
    const secondRoot = createRoot(second);
    const ctx = makeBingoCtx({ scope: { type: 'episode', id: `badge-ep-${episode}` }, docs, user: fan });
    await act(async () => secondRoot.render(<EpisodeCardBadge ctx={ctx} />));
    await flush(ctx);

    expect(docs.calls.filter((c) => c.method === 'list')).toHaveLength(1);
    act(() => secondRoot.unmount());
    second.remove();
  });
});
