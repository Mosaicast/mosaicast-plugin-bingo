// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { makeMockCtx, makeMockDocs } from '@mosaicast/plugin-sdk/testing';
import { copyClaimedCards, openSealed } from './claimCards';

/** Sealed by BingoImportTest.theSealIsPinnedForTheBrowser: same code, same parameters, a zero IV. */
const VECTOR = { iv: 'AAAAAAAAAAAAAAAA', data: 'Q9gJMEAyl/xCGRT0i0joZW1lpCdjsNu6djjrgYRsx1ylG7qYCwB14HvIGw==', episodes: ['ep'] };
const CODE = 'GOP7-K2MQ-9XD4-HTFA';
const HASH = 'b80087d0460bafadda33996223a80e9e44e963829286bdeb4701ce8d3cb845c0';
const fan = { id: 'u1', role: 'fan' as const, displayName: 'Ned', avatarUrl: '/a' };

describe('claimed cards', () => {
  it('opens what the backend sealed, with the code as typed', async () => {
    expect(await openSealed(VECTOR, 'gop7 k2mq 9xd4 htfa')).toEqual({ ep: ['Tyrion drinks', ''] });
  });

  it('opens nothing with the wrong code', async () => {
    expect(await openSealed(VECTOR, 'WRON-GCOD-E000-0000')).toBeNull();
  });

  it('writes a claimed card the partition lacks, and never overwrites one it has', async () => {
    const docs = makeMockDocs({ 'data/user/me/card:other': { entries: ['mine'] } });
    const ctx = makeMockCtx({ docs, user: fan });
    const imports = { claimed: { [HASH]: { linked: 1, skipped: 0, episodes: ['ep'], sealed: VECTOR } } };

    expect(await copyClaimedCards(ctx, imports, { codes: [CODE] })).toEqual(['ep']);
    expect(docs.stored['data/user/me/card:ep']).toEqual({ entries: ['Tyrion drinks', ''], imported: true });

    // Already there.
    expect(await copyClaimedCards(ctx, imports, { codes: [CODE] })).toEqual([]);
    expect(docs.stored['data/user/me/card:other']).toEqual({ entries: ['mine'] });
  });
}, 30_000);
