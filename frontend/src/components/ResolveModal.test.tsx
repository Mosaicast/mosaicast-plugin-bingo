// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { makeI18n } from '../i18n';
import type { GroupingDoc, Resolution } from '../types';
import { flush, makeBingoCtx } from '../test-utils';
import { ResolveModal } from './ResolveModal';

describe('<ResolveModal> regrouping', () => {
  const scope = { type: 'episode' as const, id: 'ep-1' };
  const candidates = [
    { canonical: 'alex says damn it', label: 'Alex says damn it', count: 2 },
    { canonical: 'kraken', label: 'kraken', count: 1 },
    { canonical: 'giant squid', label: 'giant squid', count: 1 },
  ];
  const assignments = {
    'Alex says damn it': 'alex says damn it',
    'alex says damn': 'alex says damn it',
    kraken: 'kraken',
    'giant squid': 'giant squid',
  };

  let host: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    // jsdom has no modal dialogs; the component only needs `open` to flip.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function open(grouping: GroupingDoc | null = null, resolution: Resolution | null = null) {
    const docs = makeMockDocs();
    const ctx = makeBingoCtx({ scope, docs });
    let regrouped = 0;
    await act(async () => {
      root.render(
        <ResolveModal
          ctx={ctx}
          i18n={makeI18n(ctx.locale)}
          candidates={candidates}
          cardCounts={{}}
          assignments={assignments}
          grouping={grouping}
          resolution={resolution}
          mode="resolve"
          onClose={() => {}}
          onDone={() => {}}
          onRegroup={() => regrouped++}
        />,
      );
    });
    return { ctx, docs, regrouped: () => regrouped };
  }

  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

  it('shows the spellings behind a candidate and splits one off', async () => {
    const { ctx, docs, regrouped } = await open();

    await act(async () => button('Spellings (2)').click());
    expect(host.textContent).toContain('alex says damn');

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.bingo__variant button')][0].click());
    await flush(ctx);

    expect(await docs.get(scope, 'grouping')).toMatchObject({ pins: { 'alex says damn': '' } });
    expect(regrouped()).toBe(1);
  });

  it('merges every spelling of a candidate into another, keeping earlier pins', async () => {
    const { ctx, docs } = await open({ pins: { 'alex says damn': '' } });

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.bingo__more')][2].click());
    const select = host.querySelector<HTMLSelectElement>('.bingo__variants select')!;
    await act(async () => {
      select.value = 'kraken';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('Merge').click());
    await flush(ctx);

    expect(await docs.get(scope, 'grouping')).toMatchObject({
      pins: { 'alex says damn': '', 'giant squid': 'kraken' },
    });
  });

  it('warns before merging two candidates that were decided differently', async () => {
    await open(null, { hits: { kraken: true, 'giant squid': false } });

    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.bingo__more')][2].click());
    const select = host.querySelector<HTMLSelectElement>('.bingo__variants select')!;
    await act(async () => {
      select.value = 'kraken';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(host.textContent).toContain('the decision on “kraken” counts for both');
  });

  it('says a correction is still on its way instead of looking ignored', async () => {
    await open({ pins: { 'giant squid': 'kraken' } });

    expect(host.textContent).toContain('Your corrections are applied on the next update.');
  });
});
