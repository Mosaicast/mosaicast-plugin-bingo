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

describe('<ResolveModal> correcting', () => {
  const scope = { type: 'episode' as const, id: 'ep-1' };
  const candidates = [
    { canonical: 'kraken', label: 'kraken', count: 1 },
    { canonical: 'giant squid', label: 'giant squid', count: 1 },
  ];
  let host: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
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

  it('shows every decision, flips one and leaves the phase alone', async () => {
    // `octopus` was ticked off elsewhere (a draft round's page) after the dialog read the resolution.
    const docs = makeMockDocs({
      'data/episode/ep-1/resolution': { hits: { kraken: true, 'giant squid': false, octopus: true } },
    });
    const ctx = makeBingoCtx({ scope, docs });
    let done = 0;
    await act(async () => {
      root.render(
        <ResolveModal
          ctx={ctx}
          i18n={makeI18n(ctx.locale)}
          candidates={candidates}
          cardCounts={{}}
          assignments={{ kraken: 'kraken', 'giant squid': 'giant squid' }}
          grouping={null}
          resolution={{ hits: { kraken: true, 'giant squid': false } }}
          mode="correct"
          onClose={() => {}}
          onDone={() => done++}
          onRegroup={() => {}}
        />,
      );
    });
    expect(host.textContent).toContain('Correct the resolution');
    const ticks = [...host.querySelectorAll<HTMLButtonElement>('.bingo__tick')];
    expect(ticks.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false']);

    await act(async () => ticks[0].click());
    const save = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save the correction')!;
    await act(async () => save.click());
    await flush(ctx);

    expect(docs.stored['data/episode/ep-1/resolution']).toEqual({
      hits: { kraken: false, 'giant squid': false, octopus: true },
    });
    expect(docs.stored['data/episode/ep-1/control']).toBeUndefined();
    expect(done).toBe(1);
  });
});
