// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useCallback, useEffect, useRef, useState } from 'react';
import { isPluginApiError, type PluginContext, type UserRef } from '@mosaicast/plugin-sdk';
import {
  KEY_CANDIDATES,
  KEY_LEADERBOARD,
  KEY_PARTICIPANTS,
  KEY_PHASE,
  KEY_PREFS,
  KEY_RESOLUTION,
  KEY_CONTROL,
  KEY_SHOWCASE,
  KEY_SHOWCASED,
  KEY_TEMPLATE,
  cardKey,
} from '../keys';
import type {
  Candidate,
  Control,
  Candidates,
  Card,
  Leaderboard,
  Participants,
  PhaseState,
  Prefs,
  Resolution,
  Showcase,
  Showcased,
  ShowcasedCard,
  Phase,
  Template,
} from '../types';

export interface BingoData {
  loading: boolean;
  failed: boolean;
  template: Template | null;
  phase: PhaseState | null;
  /**
   * The lifecycle the podcaster has asked for, which the backend applies on its next pass.
   *
   * Read separately from `phase` on purpose: the intent lands the instant it is written, the derived state
   * up to a whole tick later. Without both, pressing a lifecycle button changes nothing on screen for as
   * long as a minute and reads as broken.
   */
  intent: Phase | null;
  candidates: Candidate[];
  /** How many distinct cards carry each candidate, keyed by canonical form. */
  cardCounts: Record<string, number>;
  assignments: Record<string, string>;
  resolution: Resolution | null;
  leaderboard: Leaderboard | null;
  /** Cards a podcaster chose to feature, copied out by the backend so anyone can read them. */
  showcased: ShowcasedCard[];
  /** Ids a podcaster may feature — only people who allow it. Empty for anyone but a podcaster's picker. */
  participants: string[];
  /** Whom the podcaster has currently picked. */
  showcasePick: string[];
  myCard: Card | null;
  /** The viewer's own standing choices. Their partition, so nobody else's is readable. */
  myPrefs: Prefs | null;
  /** The site's shared tag vocabulary, or empty when the host offers none. */
  vocabulary: string[];
  /** Everyone who needs drawing, resolved at render. Keyed by id — never index-aligned. */
  people: Record<string, UserRef>;
  reload: () => void;
}

const EMPTY: Omit<BingoData, 'reload'> = {
  loading: true,
  failed: false,
  template: null,
  phase: null,
  intent: null,
  candidates: [],
  cardCounts: {},
  assignments: {},
  resolution: null,
  leaderboard: null,
  showcased: [],
  participants: [],
  showcasePick: [],
  myCard: null,
  myPrefs: null,
  vocabulary: [],
  people: {},
};

/**
 * Reads everything one episode's bingo needs, in one pass.
 *
 * Three habits worth keeping. The episode's documents come in one fresh batch read ({@link readEpisode}),
 * never through `ctx.docs.get`, whose remembered misses would hide every document that appears later. A
 * missing document is the normal answer for a bingo nobody has written yet, so an absent key is success and
 * only a real rejection sets `failed` — the reflexive `.catch(() => undefined)` would swallow the 403 and
 * the 500 as well. And anything of the viewer's own is fetched from their partition (`'self'`), never from
 * a per-user key under the episode scope: doc keys are client input, so a key naming a user is an IDOR.
 */
export function useBingo(ctx: PluginContext): BingoData {
  const [state, setState] = useState<Omit<BingoData, 'reload'>>(EMPTY);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const scope = ctx.scope;
  const signedIn = Boolean(ctx.user);
  // The host re-assigns `ctx` to re-render rather than remounting, so a new object arrives for anything
  // that changes on the page — a consent choice, a language switch — none of which changes what these
  // documents say. Holding it in a ref and keying the effect on what the read actually depends on turns
  // one page life's worth of duplicate fetches back into one.
  const latest = useRef(ctx);
  latest.current = ctx;
  const scopeKey = `${scope.type}:${scope.id}`;

  useEffect(() => {
    let live = true;
    const ctx = latest.current;

    const load = async () => {
      const [episode, mine, myPrefs, vocabulary] = await Promise.all([
        readEpisode(ctx, scope, TILE_KEYS),
        // The viewer's own partition changes only through this client, whose writes forget the miss they
        // replace, so the host's remembered misses are right here and worth keeping.
        signedIn ? ctx.docs.get<Card>('self', cardKey(scope.id)) : Promise.resolve(null),
        signedIn ? ctx.docs.get<Prefs>('self', KEY_PREFS) : Promise.resolve(null),
        // `ctx.tags` is null unless the manifest declares a tags block, so this must survive its absence.
        ctx.tags ? ctx.tags.all().catch(() => []) : Promise.resolve([]),
      ]);
      const template = pick<Template>(episode, KEY_TEMPLATE);
      const phase = pick<PhaseState>(episode, KEY_PHASE);
      const control = pick<Control>(episode, KEY_CONTROL);
      const candidates = pick<Candidates>(episode, KEY_CANDIDATES);
      const resolution = pick<Resolution>(episode, KEY_RESOLUTION);
      const leaderboard = pick<Leaderboard>(episode, KEY_LEADERBOARD);
      const showcased = pick<Showcased>(episode, KEY_SHOWCASED);
      const participants = pick<Participants>(episode, KEY_PARTICIPANTS);
      const showcasePick = pick<Showcase>(episode, KEY_SHOWCASE);

      if (!live) return;
      const showcasedCards = showcased?.items ?? [];
      setState({
        loading: false,
        failed: false,
        template,
        phase,
        intent: control?.phase ?? null,
        candidates: candidates?.items ?? [],
        cardCounts: candidates?.cards ?? {},
        assignments: candidates?.assignments ?? {},
        resolution,
        leaderboard,
        showcased: showcasedCards,
        participants: (participants?.items ?? []).map((p) => p.userId),
        showcasePick: showcasePick?.userIds ?? [],
        myCard: mine,
        myPrefs,
        vocabulary: vocabulary.map((t) => t.label),
        people: await resolvePeople(ctx, [
          ...(leaderboard?.ranked ?? []).map((r) => r.author),
          ...(leaderboard?.late ?? []).map((r) => r.author),
          ...showcasedCards.map((c) => c.userId),
          ...(participants?.items ?? []).map((p) => p.userId),
        ]),
      });
    };

    load().catch((error: unknown) => {
      if (!live) return;
      ctx.log('warn', `bingo: could not read this episode (${describe(error)})`);
      setState({ ...EMPTY, loading: false, failed: true });
    });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ctx` is read through `latest`, on purpose.
  }, [scopeKey, signedIn, nonce]);

  return { ...state, reload };
}

/**
 * What a feed badge needs, and nothing else.
 *
 * A badge says one line: whether a bingo exists, and the top score once there is one. Reading it through
 * the tile's hook meant every episode card on a listing page fetched all nine episode documents plus the
 * viewer's own card, their preferences and the tag vocabulary — most of it 404, none of it drawn. Six
 * episodes with no bingo cost 126 failed requests before anything else on the page had loaded, which
 * buries any error worth seeing.
 *
 * The podcaster-only intents in particular have no business being read here: nothing in a badge can act
 * on them.
 */
export function useBingoBadge(ctx: PluginContext): BadgeData {
  const [state, setState] = useState<BadgeData>({ loading: true, template: null, phase: null, board: null });

  const latest = useRef(ctx);
  latest.current = ctx;
  const scopeKey = `${ctx.scope.type}:${ctx.scope.id}`;

  useEffect(() => {
    let live = true;
    const ctx = latest.current;
    const scope = ctx.scope;

    readEpisode(ctx, scope, BADGE_KEYS)
      .then((episode) => {
        if (live) {
          setState({
            loading: false,
            template: pick<Template>(episode, KEY_TEMPLATE),
            phase: pick<PhaseState>(episode, KEY_PHASE),
            board: pick<Leaderboard>(episode, KEY_LEADERBOARD),
          });
        }
      })
      .catch(() => {
        // A badge that cannot read its episode simply does not draw; there is nothing to report here.
        if (live) setState({ loading: false, template: null, phase: null, board: null });
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ctx` is read through `latest`, on purpose.
  }, [scopeKey]);

  return state;
}

/** Every episode document the tile draws, in one request. */
const TILE_KEYS = [
  KEY_TEMPLATE, KEY_PHASE, KEY_CONTROL, KEY_CANDIDATES, KEY_RESOLUTION,
  KEY_LEADERBOARD, KEY_SHOWCASED, KEY_PARTICIPANTS, KEY_SHOWCASE,
];

/** The three a feed badge draws, in one request. */
const BADGE_KEYS = [KEY_TEMPLATE, KEY_PHASE, KEY_LEADERBOARD];

/**
 * One episode's documents, read fresh through the host's batch endpoint (ARCHITECTURE §7.6).
 *
 * Not `ctx.docs.get`: since core 0.7.3 the host's doc client remembers every "not set" for the life of the
 * page, on the reasoning that an unset key does not change by itself. Every key here does. The template
 * appears when a podcaster creates the bingo in another session, and `phase`, `candidates`, `participants`,
 * `showcased` and the leaderboard appear when the backend's tick first writes them. Read through
 * `ctx.docs.get`, a visitor who had seen an episode before any of that saw none of it again until a full
 * reload — navigating away and back asked nobody. `ctx.docs.getMany` feeds that memory too, and is only
 * guaranteed to be batched, not fresh.
 *
 * `ctx.api` is uncached by contract, and one batch read costs one request where the per-key reads cost
 * nine for the tile and three for each badge. The answer is `{ scopeId: { key: value } }`, misses absent.
 *
 * Core 0.7.5 fixed the worst of it (core#237): a miss is now remembered for 30 s and forgotten on every
 * navigation. That is still not a reason to switch: the `reload()` after a podcaster's action lands inside
 * the window, so a `phase` or `candidates` the tick wrote meanwhile would stay hidden. This tile only ever
 * wants fresh, and the batch read costs the same one request.
 */
async function readEpisode(
  ctx: PluginContext,
  scope: PluginContext['scope'],
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  const found = await ctx.api.get<Record<string, Record<string, unknown>> | undefined>(
    `data/${scope.type}?ids=${encodeURIComponent(scope.id)}&keys=${keys.join(',')}`,
  );
  return found?.[scope.id] ?? {};
}

/** A key from a batch answer, `null` when absent — the shape the per-key reads used to hand over. */
function pick<T>(episode: Record<string, unknown>, key: string): T | null {
  return (episode[key] ?? null) as T | null;
}

/** The three documents a feed badge draws from. */
export interface BadgeData {
  loading: boolean;
  template: Template | null;
  phase: PhaseState | null;
  board: Leaderboard | null;
}

/**
 * Turns the user ids on this page into people.
 *
 * `resolve` omits ids it cannot answer for — unknown, erased or pseudonymised, all one shape so the answer
 * cannot be used to tell them apart — so the result is **not** index-aligned with the request. Hence a map
 * keyed on id, and callers that cope with a missing entry.
 */
async function resolvePeople(
  ctx: PluginContext,
  ids: string[],
): Promise<Record<string, UserRef>> {
  const directory = ctx.users;
  if (!directory || ids.length === 0) return {}; // no `identity` block in the manifest

  try {
    const found = await directory.resolve([...new Set(ids)]);
    return Object.fromEntries(found.map((u) => [u.id, u]));
  } catch (error) {
    // A board that renders without names beats one that does not render.
    ctx.log('warn', `bingo: could not resolve players (${describe(error)})`);
    return {};
  }
}

/** Structural, never `instanceof`: the error crosses a bundle boundary from the host. */
function describe(error: unknown): string {
  return isPluginApiError(error) ? `${error.status} ${error.problem?.type ?? ''}`.trim() : String(error);
}
