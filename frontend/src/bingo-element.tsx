// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { defineMosaicastElement } from '@mosaicast/plugin-sdk';
import { createRoot } from 'react-dom/client';
import { EpisodeBingo } from './components/EpisodeBingo';
import { EpisodeCardBadge } from './components/EpisodeCardBadge';

/**
 * Every custom element this plugin declares in `plugin.json`, defined in one entry so Vite emits a single
 * ES module.
 *
 * Each `render` returns a `MosaicastHandle` (platformApi 0.15.0) rather than a bare cleanup. With a bare
 * cleanup the SDK treats every `ctx` reassignment as a teardown: it unmounts the React root, clears the
 * shadow DOM and renders from scratch — losing a half-typed card, an open resolve dialog and every
 * in-flight read, and re-running each effect behind them. `update` instead hands the new context to the
 * same root, so React reconciles in place and only what actually depends on the change re-runs.
 * `destroy` runs on a real disconnect alone.
 */

/** `episode`/`main` — host tabs, the viewer's own card, and the results. */
defineMosaicastElement({
  tag: 'bingo-episode',
  render: ({ ctx, root }) => {
    const reactRoot = createRoot(root);
    reactRoot.render(<EpisodeBingo ctx={ctx} />);
    return {
      update: (next) => reactRoot.render(<EpisodeBingo ctx={next} />),
      destroy: () => reactRoot.unmount(),
    };
  },
});

/** `episode`/`card` — one line inside the feed card. */
defineMosaicastElement({
  tag: 'bingo-episode-card',
  render: ({ ctx, root }) => {
    const reactRoot = createRoot(root);
    reactRoot.render(<EpisodeCardBadge ctx={ctx} />);
    return {
      update: (next) => reactRoot.render(<EpisodeCardBadge ctx={next} />),
      destroy: () => reactRoot.unmount(),
    };
  },
});

