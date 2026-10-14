// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useState } from 'react';
import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { copyClaimedCards } from '../claimCards';
import { sha256Hex } from '../crypto';
import { KEY_CLAIM } from '../keys';
import type { ClaimDoc, Imports } from '../types';

/** How long after saving a code the box keeps saying "waiting" before it says "not recognised". */
const PATIENCE_MS = 3 * 60_000;

/** A code as the backend hashes it: letters and digits only, upper-cased (BingoImport.hashOf). */
export function cleanCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** SHA-256, hex — the only form a claim code is ever known by on the server. */
export async function hashCode(code: string): Promise<string> {
  return sha256Hex(cleanCode(code));
}

/**
 * "Played before this site existed?" — where somebody enters the claim code a podcaster gave them, and the
 * bingos imported under that code become theirs.
 *
 * The code goes into the player's own partition and the backend applies it on its next pass, so the box
 * reads the result back rather than assuming it: the public `imports` report holds code hashes only, and
 * hashing the code here finds this player's own line without anybody else being able to.
 *
 * Almost nobody has a code, so the box is one closed line at the foot of the page, for everybody. Somebody
 * who saved a code sees how it went in that line, without opening it.
 */
export function ClaimBox({ ctx, i18n, imports }: { ctx: PluginContext; i18n: PluginI18n; imports: Imports | null }) {
  const [doc, setDoc] = useState<ClaimDoc | null>(null);
  const [draft, setDraft] = useState('');
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // A visitor has no partition: the USER scope answers 401, so read it only once somebody is signed in.
  const userId = ctx.user?.id;
  useEffect(() => {
    if (!userId) {
      setDoc(null);
      return;
    }
    let live = true;
    ctx.docs
      .get<ClaimDoc>('self', KEY_CLAIM)
      .then((found) => live && setDoc(found ?? { codes: [] }))
      .catch(() => live && setDoc({ codes: [] }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the viewer's own partition, once per sign-in
  }, [userId]);

  const codes = doc?.codes ?? [];
  useEffect(() => {
    let live = true;
    Promise.all(codes.map(async (c) => [c, await hashCode(c)] as const)).then(
      (pairs) => live && setHashes(Object.fromEntries(pairs)),
    );
    return () => {
      live = false;
    };
  }, [codes.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Linked cards go into the player's own partition, where the tile draws "your card" from (claimCards.ts).
  const linkedCount = Object.values(hashes).filter((h) => imports?.claimed?.[h]).length;
  useEffect(() => {
    if (!ctx.user || linkedCount === 0 || !doc) return;
    copyClaimedCards(ctx, imports, doc).catch((error: unknown) =>
      ctx.log('warn', `bingo: could not copy claimed cards (${String(error)})`),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per newly linked code
  }, [linkedCount]);

  // Only on a site that has imported past bingos; elsewhere there is nothing to claim.
  if (!ctx.user || !imports || (!imports.claims && !imports.claimed)) return null;

  const save = async () => {
    const code = draft.trim();
    if (cleanCode(code).length < 12 || codes.some((c) => cleanCode(c) === cleanCode(code))) return;
    const next: ClaimDoc = {
      codes: [...codes, code],
      savedAt: { ...(doc?.savedAt ?? {}), [code]: new Date().toISOString() },
    };
    setBusy(true);
    try {
      await ctx.docs.put('self', KEY_CLAIM, next);
      setDoc(next);
      setDraft('');
    } catch (error) {
      ctx.log('warn', `bingo: could not save a claim code (${isPluginApiError(error) ? error.status : String(error)})`);
    } finally {
      setBusy(false);
    }
  };

  const status = (code: string) => {
    const result = hashes[code] ? imports.claimed?.[hashes[code]] : undefined;
    if (result) {
      return result.skipped > 0
        ? i18n.t('claim.linkedSkipped', { linked: String(result.linked), skipped: String(result.skipped) })
        : i18n.t('claim.linked', { linked: String(result.linked) });
    }
    const saved = doc?.savedAt?.[code];
    const waiting = saved !== undefined && Date.now() - Date.parse(saved) < PATIENCE_MS;
    return i18n.t(waiting ? 'claim.waiting' : 'claim.unknown');
  };

  return (
    <details className="bingo__claim">
      <summary className="bingo__claim-summary">
        {i18n.t('claim.title')}
        {linkedCount > 0
          ? ` · ${i18n.t('claim.summaryLinked', { count: String(linkedCount) })}`
          : codes.length > 0 && ` · ${i18n.t('claim.summarySaved', { count: String(codes.length) })}`}
      </summary>
      <p className="bingo__note">{i18n.t('claim.hint')}</p>
      <div className="bingo__actions">
        <label className="bingo__field">
          {i18n.t('claim.code')}
          <input
            className="bingo__input"
            value={draft}
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button type="button" className="bingo__btn" onClick={save} disabled={busy || cleanCode(draft).length < 12}>
          {i18n.t('claim.save')}
        </button>
      </div>
      {codes.length > 0 && (
        <ul className="bingo__list">
          {codes.map((code) => (
            <li key={code} className="bingo__note">
              <code>{code}</code> · {status(code)}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
