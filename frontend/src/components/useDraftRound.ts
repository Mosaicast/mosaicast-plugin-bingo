// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isActionRejected,
  isRateLimited,
  type ChannelStatus,
  type PluginContext,
  type Scope,
} from '@mosaicast/plugin-sdk';
import { applyUpdate } from '../draft';
import { draftChannel, seatKey } from '../keys';
import type { DraftPreview, DraftUpdate, DraftView } from '../types';

/** Every draft action is called in the site scope, whatever page the call comes from. */
export const SITE: Scope = { type: 'site', id: 'main' };

export interface DraftRound {
  view: DraftView | null;
  /** What somebody holding the link's code sees before they join. */
  preview: DraftPreview | null;
  /** Why the round couldn't be read, as a rejection code; `generic` for anything else. */
  failure: string | null;
  loading: boolean;
  /** The channel's state; `connecting` after `open` means the connection dropped and is coming back. */
  connection: ChannelStatus | null;
  /** The server's clock minus this device's, from the last view. */
  offset: number;
  /** Calls an action and takes its answer as the new view. Resolves to the rejection code, or `null`. */
  act: (name: string, payload: Record<string, unknown>) => Promise<string | null>;
  reload: () => void;
}

/**
 * One draft round, kept live: subscribe first, then fetch, then apply each `update` in version order.
 *
 * The order matters. Fetching first would lose whatever was published between the answer and the
 * subscription. An event that skips a version, or the host saying it can't replay (`onReset`), means
 * fetching the whole round again. Events at or below the version on screen are ones the fetch already had.
 *
 * Keyed on the round and the signed-in person, never on `ctx`, which the host replaces for unrelated reasons.
 */
export function useDraftRound(ctx: PluginContext, id: string, code: string | null): DraftRound {
  const [view, setView] = useState<DraftView | null>(null);
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ChannelStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const [joined, setJoined] = useState(0);
  // Who has the round open, from the latest `presence` event. Kept apart from the view: the event can land
  // before the first fetch answers, and the view's own list is only as fresh as that fetch.
  const [online, setOnline] = useState<string[] | null>(null);
  const latest = useRef(ctx);
  latest.current = ctx;
  const current = useRef<DraftView | null>(null);

  const take = useCallback((next: DraftView) => {
    if (current.current && current.current.id === next.id && next.version < current.current.version) return;
    current.current = next;
    setView(next);
    setOffset(next.now - Date.now());
  }, []);

  const load = useCallback(async () => {
    const actions = latest.current.actions;
    if (!actions) return;
    try {
      const answer = await actions.call<DraftView | DraftPreview>('draft-state', { id, code }, { scope: SITE });
      if (answer && 'preview' in answer) {
        setPreview(answer);
      } else if (answer) {
        setPreview(null);
        take(answer);
      }
      setFailure(null);
    } catch (error) {
      setFailure(isActionRejected(error) ? error.problem.code : 'generic');
    } finally {
      setLoading(false);
    }
  }, [id, code, take]);

  const signedIn = Boolean(ctx.user);
  useEffect(() => {
    const { actions, channels } = latest.current;
    if (!signedIn || !actions || !channels) {
      setLoading(false);
      return;
    }
    const sub = channels.subscribe(
      draftChannel(id),
      (event) => {
        if (event.event === 'presence') {
          setOnline((event.data as { online?: string[] }).online ?? []);
          return;
        }
        if (event.event !== 'update' || !current.current) return;
        const next = applyUpdate(current.current, event.data as DraftUpdate);
        if (next === null) void load();
        else if (next !== current.current) take(next);
      },
      { scope: SITE, onReset: () => void load(), onStatus: setConnection },
    );
    void load();
    return () => sub.close();
  }, [id, signedIn, joined, load, take]);

  const act = useCallback(
    async (name: string, payload: Record<string, unknown>): Promise<string | null> => {
      const actions = latest.current.actions;
      if (!actions) return 'generic';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const answer = await actions.call<DraftView>(name, { id, ...payload }, { scope: SITE });
          if (answer) take(answer);
          if (name === 'draft-join') setJoined((n) => n + 1); // a member now: subscribe again
          return null;
        } catch (error) {
          if (isRateLimited(error)) {
            await new Promise((r) => setTimeout(r, error.problem.retryAfterMs ?? 1000));
            continue;
          }
          if (isActionRejected(error)) return error.problem.code;
          latest.current.log('warn', `bingo: draft round action ${name} failed (${String(error)})`);
          return 'generic';
        }
      }
      return 'generic';
    },
    [id, take],
  );

  // This tab is online the moment its own subscription is: the `presence` event announcing it can be sent
  // before the stream delivers anything, and the fetch may have answered before the subscription counted.
  const me = ctx.user?.id;
  const listed = online ?? view?.online ?? [];
  const here = connection === 'open' && me && !listed.includes(me) ? [...listed, me] : listed;
  const shown = view ? { ...view, online: here } : view;
  return { view: shown, preview, failure, loading, connection, offset, act, reload: () => void load() };
}

/** Ticks while something is counting down, so clocks redraw without a request. */
export function useTicker(active: boolean, every = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

/**
 * The round a tile's viewer sits in for this episode, from the seat their partition holds: their card in it,
 * read-only, in place of the editor. A seat whose round was cancelled, or is gone, is dropped, so the tile
 * goes back to the ordinary editor.
 */
export function useDraftSeat(
  ctx: PluginContext,
  draftId: string | null,
  episode: string,
): DraftView | null {
  const [view, setView] = useState<DraftView | null>(null);
  const latest = useRef(ctx);
  latest.current = ctx;
  useEffect(() => {
    setView(null);
    const actions = latest.current.actions;
    if (!draftId || !actions) return;
    let live = true;
    actions
      .call<DraftView>('draft-state', { id: draftId }, { scope: SITE })
      .then((answer) => {
        if (!live) return;
        if (!answer || answer.status === 'CANCELLED') {
          void latest.current.docs.remove('self', seatKey(episode)).catch(() => undefined);
          return;
        }
        setView(answer);
      })
      .catch((error: unknown) => {
        if (live && isActionRejected(error)) {
          void latest.current.docs.remove('self', seatKey(episode)).catch(() => undefined);
        }
      });
    return () => {
      live = false;
    };
  }, [draftId, episode]);
  return view;
}
