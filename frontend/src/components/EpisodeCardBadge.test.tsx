// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { EpisodeCardBadge } from './EpisodeCardBadge';
import { flush, makeBingoCtx } from '../test-utils';

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
});
