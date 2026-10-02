// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { makeBingoCtx } from './test-utils';
import './bingo-element';

/**
 * The custom elements themselves, as the host drives them: by assigning `ctx`, and assigning it again.
 *
 * Before platformApi 0.15.0 a render could only return a cleanup, and the SDK answered every new context by
 * running it, clearing the shadow DOM and rendering from scratch — a half-typed card, an open dialog and
 * every in-flight read went with it. Returning a `MosaicastHandle` hands the new context to the same React
 * root instead. The one observable difference is whether the rendered nodes survive, so that is what is
 * asserted.
 */
describe('bingo custom elements', () => {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    mounted.splice(0).forEach((el) => el.remove());
  });

  /** Lets React commit and the badge's reads resolve. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

  it('keeps its rendered DOM when the host hands it a new ctx', async () => {
    const id = 'element-handle-ep';
    const first = makeBingoCtx({
      scope: { type: 'episode', id },
      docs: makeMockDocs({ [`data/episode/${id}/template`]: { size: 3 } }),
    });

    const el = document.createElement('bingo-episode-card') as HTMLElement & { ctx?: unknown };
    document.body.appendChild(el);
    mounted.push(el);

    await act(async () => {
      el.ctx = first;
    });
    await settle();

    const badge = el.shadowRoot?.querySelector('.bingo__badge');
    expect(badge, 'the badge rendered from the first context').toBeTruthy();

    // A different object for the same episode — what a host produces when it re-renders for any reason.
    // An identical object would be filtered out by the SDK and prove nothing.
    await act(async () => {
      el.ctx = { ...first };
    });
    await settle();

    expect(
      el.shadowRoot?.querySelector('.bingo__badge'),
      'the same node, updated in place rather than torn down and rebuilt',
    ).toBe(badge);
  });
});
