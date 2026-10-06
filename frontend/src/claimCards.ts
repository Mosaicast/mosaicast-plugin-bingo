// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext } from '@mosaicast/plugin-sdk';
import { pbkdf2AesGcmDecrypt, sha256Hex } from './crypto';
import { CARD_PREFIX, cardKey } from './keys';
import type { ClaimDoc, Imports, Sealed } from './types';

/**
 * Copies claimed cards into the player's own partition.
 *
 * A claim moves imported rows onto an account, but the tile draws "your card" from the player's partition,
 * which only their own browser can write. So the backend hands the claimed cards over sealed with the claim
 * code — the report is public, a card is the player's own words — and this opens them with the code the
 * player entered and writes each card the partition does not have yet. The record stays the rows: after the
 * freeze the backend never reads a partition card for somebody who has rows, so this copy only feeds the
 * tile.
 *
 * Parameters must match `BingoImport.seal` exactly; `claimCards.test.ts` opens a vector the Java test pins.
 */
export const SEAL_SALT = 'mosaicast-bingo/claim';
export const SEAL_ITERATIONS = 200_000;

function cleanCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hashOf(code: string): Promise<string> {
  return sha256Hex(cleanCode(code));
}

/** The cards inside a seal, by episode slug, or `null` when the code does not open it. */
export async function openSealed(sealed: Sealed, code: string): Promise<Record<string, string[]> | null> {
  try {
    const plain = await pbkdf2AesGcmDecrypt(cleanCode(code), SEAL_SALT, SEAL_ITERATIONS, fromBase64(sealed.iv),
      fromBase64(sealed.data));
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, string[]>;
  } catch {
    return null;
  }
}

/**
 * Writes every claimed card this player's partition lacks. Never overwrites a card that is there.
 *
 * @param only when given, just this episode — what a single tile needs
 * @returns the slugs written
 */
export async function copyClaimedCards(
  ctx: PluginContext,
  imports: Imports | null,
  claim: ClaimDoc | null,
  only?: string,
): Promise<string[]> {
  if (!ctx.user || !imports?.claimed || !claim?.codes?.length) return [];
  const have = new Set(
    (await ctx.docs.list('self', { prefix: CARD_PREFIX, size: 200 })).items.map((i) => i.key.slice(CARD_PREFIX.length)),
  );
  const written: string[] = [];
  for (const code of claim.codes) {
    const result = imports.claimed[await hashOf(code)];
    const missing = (result?.episodes ?? []).filter((slug) => !have.has(slug) && (!only || slug === only));
    if (!result?.sealed || missing.length === 0) continue;
    const cards = await openSealed(result.sealed, code);
    if (!cards) continue;
    for (const slug of missing) {
      if (!cards[slug]) continue;
      await ctx.docs.put('self', cardKey(slug), { entries: cards[slug], imported: true });
      have.add(slug);
      written.push(slug);
    }
  }
  return written;
}
