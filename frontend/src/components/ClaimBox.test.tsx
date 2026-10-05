// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { makeI18n } from '../i18n';
import { flush, makeBingoCtx } from '../test-utils';
import type { Imports } from '../types';
import { ClaimBox, hashCode } from './ClaimBox';

/** The same code and hash BingoImportTest and the script's tests pin: all three must agree. */
const CODE = 'GOP7-K2MQ-9XD4-HTFA';
const HASH = 'b80087d0460bafadda33996223a80e9e44e963829286bdeb4701ce8d3cb845c0';
const fan = { id: 'u1', role: 'fan' as const, displayName: 'Ned', avatarUrl: '/a' };

describe('<ClaimBox>', () => {
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

  async function render(imports: Imports | null, stored: Record<string, unknown> = {}, user: typeof fan | null = fan) {
    const docs = makeMockDocs(stored);
    const ctx = makeBingoCtx({ scope: { type: 'site', id: 'main' }, docs, user });
    await act(async () => {
      root.render(<ClaimBox ctx={ctx} i18n={makeI18n(ctx.locale)} imports={imports} />);
    });
    await flush(ctx);
    // Hashing goes through SubtleCrypto, which settles on a later turn than the mock API.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    return { ctx, docs };
  }

  it('hashes a code exactly as the backend does', async () => {
    expect(await hashCode('gop7 k2mq-9xd4 htfa')).toBe(HASH);
  });

  it('stays away from sites that never imported anything, and from visitors', async () => {
    await render(null);
    expect(host.textContent).toBe('');
    await render({ claims: { [HASH]: 'import:x' } }, {}, null);
    expect(host.textContent).toBe('');
  });

  it('saves a code to the player’s own partition and says it is waiting', async () => {
    const { ctx, docs } = await render({ claims: { [HASH]: 'import:x' } });
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, CODE);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('.bingo__btn')!.click());
    await flush(ctx);

    expect(docs.stored['data/user/me/claim']).toMatchObject({ codes: [CODE] });
    expect(host.textContent).toContain('linked on the next update');
  });

  it('reads its own result back by hash', async () => {
    await render(
      { claimed: { [HASH]: { linked: 12, skipped: 1 } } },
      { 'data/user/me/claim': { codes: [CODE] } },
    );
    expect(host.textContent).toContain('linked 12 bingo(s); 1 skipped because you already have a card there');
  });

  it('says so when a code was never recognised', async () => {
    await render(
      { claims: { other: 'import:x' } },
      { 'data/user/me/claim': { codes: [CODE], savedAt: { [CODE]: '2020-01-01T00:00:00Z' } } },
    );
    expect(host.textContent).toContain('not recognised');
  });
});
