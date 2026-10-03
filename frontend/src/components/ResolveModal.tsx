// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useRef, useState } from 'react';
import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { KEY_CONTROL, KEY_GROUPING, KEY_RESOLUTION } from '../keys';
import { mergePins, pendingPins, splitPin, variantsOf } from '../regroup';
import type { Candidate, GroupingDoc, Resolution } from '../types';

/**
 * The resolving surface, as a dialog on the bingo itself.
 *
 * <p>It used to be a sidebar slot, which put the one action a podcaster comes to the page for below
 * everything else on a phone. A dialog keeps it next to the thing it acts on.
 *
 * <p>Two modes, and the difference between them is why the final resolve writes what it does:
 *
 * - **resolve** — every candidate, ticked or not, and confirming writes a decision for *all* of them.
 * - **catch up** — only candidates with no decision yet, which after the above is exactly the ones that
 *   arrived since. No timestamps needed, and it removes an old ambiguity: until now "never ticked" and
 *   "ticked, then unticked" were the same thing to the backend, so a term that appeared after the
 *   resolution silently counted as a miss.
 *
 * <p>Each candidate also opens onto the spellings grouped into it, so a podcaster can overrule the matching:
 * split a spelling off into its own group, or merge a whole candidate into another. Those are written at
 * once (they are not part of the decision being confirmed) and applied on the backend's next pass — also to
 * cards already frozen, since which group a square belongs to is a judgement, not something the card said.
 */
export function ResolveModal({
  ctx,
  i18n,
  candidates,
  cardCounts,
  assignments,
  grouping,
  resolution,
  mode,
  onClose,
  onDone,
  onRegroup,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  candidates: Candidate[];
  /** How many cards carry each candidate, keyed by canonical form — not how many times it was typed. */
  cardCounts: Record<string, number>;
  /** Which candidate each written spelling belongs to, as the backend last decided it. */
  assignments: Record<string, string>;
  /** The podcaster's own corrections so far. */
  grouping: GroupingDoc | null;
  resolution: Resolution | null;
  mode: 'resolve' | 'catchup';
  onClose: () => void;
  onDone: () => void;
  /** A correction was written; re-read so its pending state shows. The dialog stays open. */
  onRegroup: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const decided = resolution?.hits ?? {};
  const shown = mode === 'resolve' ? candidates : candidates.filter((c) => !(c.canonical in decided));

  const [marks, setMarks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(shown.map((c) => [c.canonical, decided[c.canonical] === true])),
  );
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [mergeInto, setMergeInto] = useState<string>('');
  const pending = pendingPins(grouping, assignments);

  /** Adds pins to the ones already written; a later pin for the same spelling replaces the earlier. */
  const regroup = async (pins: Record<string, string>) => {
    setBusy(true);
    try {
      await ctx.docs.put(ctx.scope, KEY_GROUPING, {
        pins: { ...(grouping?.pins ?? {}), ...pins },
        updatedAt: new Date().toISOString(),
      });
      setOpen(null);
      onRegroup();
    } catch (error) {
      ctx.log('warn', `bingo: could not regroup (${isPluginApiError(error) ? error.status : String(error)})`);
    } finally {
      setBusy(false);
    }
  };

  /** Takes a spelling's pin away again, handing it back to the automatic matching. */
  const unpin = async (text: string) => {
    const rest = { ...(grouping?.pins ?? {}) };
    delete rest[text];
    setBusy(true);
    try {
      await ctx.docs.put(ctx.scope, KEY_GROUPING, { pins: rest, updatedAt: new Date().toISOString() });
      onRegroup();
    } catch (error) {
      ctx.log('warn', `bingo: could not regroup (${isPluginApiError(error) ? error.status : String(error)})`);
    } finally {
      setBusy(false);
    }
  };

  // `showModal` brings the focus trap, the backdrop and Escape with it — none of which is worth
  // reimplementing, and all of which works inside a shadow root.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog?.open) dialog?.showModal();
    const close = () => onClose();
    dialog?.addEventListener('close', close);
    return () => dialog?.removeEventListener('close', close);
  }, [onClose]);

  const confirm = async () => {
    setBusy(true);
    try {
      // Every candidate on screen gets a decision, not just the ticked ones. That is what makes
      // "no decision yet" mean "arrived after the resolution" from here on.
      const hits: Record<string, boolean> = { ...decided };
      for (const c of shown) hits[c.canonical] = marks[c.canonical] === true;
      await ctx.docs.put(ctx.scope, KEY_RESOLUTION, { hits });

      if (mode === 'resolve') {
        await ctx.docs.put(ctx.scope, KEY_CONTROL, {
          phase: 'RESOLVED',
          updatedAt: new Date().toISOString(),
        });
      }
      onDone();
      ref.current?.close();
    } catch (error) {
      setBusy(false);
      ctx.log(
        'warn',
        `bingo: could not resolve (${isPluginApiError(error) ? error.status : String(error)})`,
      );
    }
  };

  return (
    <dialog className="bingo__modal" ref={ref}>
      <div className="bingo">
        <div className="bingo__head">
          <h3 className="bingo__title">
            <Icon name="board" /> {i18n.t(mode === 'resolve' ? 'resolve.title' : 'resolve.catchupTitle')}
          </h3>
        </div>
        <p className="bingo__hint">
          {i18n.t(mode === 'resolve' ? 'resolve.hint' : 'resolve.catchupHint')}
        </p>

        {shown.length === 0 ? (
          <p className="bingo__note">{i18n.t('resolve.nothing')}</p>
        ) : (
          <div className="bingo__board">
            {shown.map((c) => {
              const variants = variantsOf(assignments, c.canonical);
              const expanded = open === c.canonical;
              const target = candidates.find((o) => o.canonical === mergeInto && o.canonical !== c.canonical);
              const conflict =
                target !== undefined &&
                c.canonical in decided &&
                target.canonical in decided &&
                decided[c.canonical] !== decided[target.canonical];
              return (
                <div key={c.canonical} className="bingo__cand">
                  <button
                    type="button"
                    className="bingo__tick"
                    aria-pressed={marks[c.canonical] === true}
                    onClick={() => setMarks((m) => ({ ...m, [c.canonical]: !m[c.canonical] }))}
                  >
                    <Icon name={marks[c.canonical] ? 'check' : 'dice'} />
                    <span>{c.label}</span>
                    <span className="bingo__tick-count">
                      {i18n.t('board.written', {
                        count: String(cardCounts[c.canonical] ?? c.count),
                      })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="bingo__more"
                    aria-expanded={expanded}
                    onClick={() => {
                      setOpen(expanded ? null : c.canonical);
                      setMergeInto('');
                    }}
                  >
                    {i18n.t('regroup.toggle', { count: String(variants.length) })}
                  </button>
                  {expanded && (
                    <div className="bingo__variants">
                      <ul className="bingo__variant-list">
                        {variants.map((text) => {
                          const pinned = grouping?.pins?.[text] !== undefined;
                          return (
                            <li key={text} className="bingo__variant">
                              <span>{text}</span>
                              {pending.includes(text) && (
                                <span className="bingo__role">{i18n.t('regroup.pending')}</span>
                              )}
                              {variants.length > 1 && (
                                <button
                                  type="button"
                                  className="bingo__btn bingo__btn--quiet bingo__btn--small"
                                  disabled={busy}
                                  onClick={() => regroup(splitPin(text))}
                                >
                                  {i18n.t('regroup.split')}
                                </button>
                              )}
                              {pinned && (
                                <button
                                  type="button"
                                  className="bingo__btn bingo__btn--quiet bingo__btn--small"
                                  disabled={busy}
                                  onClick={() => unpin(text)}
                                >
                                  {i18n.t('regroup.undo')}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {candidates.length > 1 && (
                        <div className="bingo__actions">
                          <label className="bingo__field">
                            {i18n.t('regroup.mergeInto')}
                            <select
                              className="bingo__select"
                              value={mergeInto}
                              onChange={(e) => setMergeInto(e.target.value)}
                            >
                              <option value="">{i18n.t('regroup.choose')}</option>
                              {candidates
                                .filter((o) => o.canonical !== c.canonical)
                                .map((o) => (
                                  <option key={o.canonical} value={o.canonical}>
                                    {o.label}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="bingo__btn bingo__btn--quiet"
                            disabled={busy || !target}
                            onClick={() => target && regroup(mergePins(assignments, c.canonical, target.canonical))}
                          >
                            {i18n.t('regroup.merge')}
                          </button>
                        </div>
                      )}
                      {conflict && target && (
                        <p className="bingo__warn">{i18n.t('regroup.conflict', { target: target.label })}</p>
                      )}
                      <p className="bingo__note">{i18n.t('regroup.hint')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {pending.length > 0 && <p className="bingo__warn">{i18n.t('regroup.waiting')}</p>}

        <div className="bingo__actions">
          <button type="button" className="bingo__btn" onClick={confirm} disabled={busy}>
            {i18n.t(mode === 'resolve' ? 'resolve.confirm' : 'resolve.catchupConfirm')}
          </button>
          <button
            type="button"
            className="bingo__btn bingo__btn--quiet"
            onClick={() => ref.current?.close()}
            disabled={busy}
          >
            {i18n.t('resolve.cancel')}
          </button>
        </div>
        <p className="bingo__note">{i18n.t('board.waiting')}</p>
      </div>
    </dialog>
  );
}

/** Candidates nobody has decided on yet — after a resolution, exactly the ones that arrived since. */
export function undecided(candidates: Candidate[], resolution: Resolution | null): Candidate[] {
  const decided = resolution?.hits ?? {};
  return candidates.filter((c) => !(c.canonical in decided));
}
