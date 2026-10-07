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
  KEY_RECAP,
  KEY_RESOLUTION,
  KEY_ANSWERS,
  KEY_CONTROL,
  KEY_GROUPING,
  KEY_SHOWCASE,
  KEY_SHOWCASED,
  KEY_SUGGESTIONS,
  KEY_TEMPLATE,
  CARD_PREFIX,
  cardKey,
} from '../keys';
import type {
  Candidate,
  Control,
  Candidates,
  Card,
  GroupingDoc,
  Leaderboard,
  Participants,
  PhaseState,
  Prefs,
  Recap,
  Resolution,
  Answers,
  Showcase,
  Showcased,
  ShowcasedCard,
  Suggestion,
  Suggestions,
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
  /** The podcaster's working list; `null` for everyone else, whom the host does not hand it to. */
  resolution: Resolution | null;
  /** What came true, once the bingo is resolved. */
  answers: Answers | null;
  /** The podcaster's corrections to the grouping; read so one not applied yet can say so. */
  grouping: GroupingDoc | null;
  leaderboard: Leaderboard | null;
  /** What happened, once it is resolved. */
  recap: Recap | null;
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
  /** Predictions several people keep making across the site. Only read for someone who can fill a card. */
  suggestions: Suggestion[];
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
  answers: null,
  grouping: null,
  leaderboard: null,
  recap: null,
  showcased: [],
  participants: [],
  showcasePick: [],
  myCard: null,
  myPrefs: null,
  vocabulary: [],
  suggestions: [],
  people: {},
};

/**
 * Reads everything one episode's bingo needs, in one pass.
 *
 * Three habits worth keeping. The episode's documents come in one fresh batch read ({@link readScope}),
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
      const [episode, mine, myPrefs, vocabulary, suggestions] = await Promise.all([
        readScope(ctx, scope, TILE_KEYS),
        // The viewer's own partition changes only through this client, whose writes forget the miss they
        // replace, so the host's remembered misses are right here and worth keeping.
        signedIn ? ctx.docs.get<Card>('self', cardKey(scope.id)) : Promise.resolve(null),
        signedIn ? ctx.docs.get<Prefs>('self', KEY_PREFS) : Promise.resolve(null),
        // `ctx.tags` is null unless the manifest declares a tags block, so this must survive its absence.
        ctx.tags ? ctx.tags.all().catch(() => []) : Promise.resolve([]),
        // Through `ctx.docs`, unlike the episode: a site-wide list that changes on the backend's slow roll-up,
        // shared by every tile on the page, where a remembered miss costs nothing worse than no chips for a
        // while. Optional all the way — a failure here must not cost anyone their card.
        signedIn
          ? ctx.docs.get<Suggestions>('site', KEY_SUGGESTIONS).catch(() => null)
          : Promise.resolve(null),
      ]);
      const template = pick<Template>(episode, KEY_TEMPLATE);
      const phase = pick<PhaseState>(episode, KEY_PHASE);
      const control = pick<Control>(episode, KEY_CONTROL);
      const candidates = pick<Candidates>(episode, KEY_CANDIDATES);
      const resolution = pick<Resolution>(episode, KEY_RESOLUTION);
      const answers = pick<Answers>(episode, KEY_ANSWERS);
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
        answers,
        grouping: pick<GroupingDoc>(episode, KEY_GROUPING),
        leaderboard,
        recap: pick<Recap>(episode, KEY_RECAP),
        showcased: showcasedCards,
        participants: (participants?.items ?? []).map((p) => p.userId),
        showcasePick: showcasePick?.userIds ?? [],
        myCard: mine,
        myPrefs,
        vocabulary: vocabulary.map((t) => t.label),
        suggestions: suggestions?.items ?? [],
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
  const [state, setState] = useState<BadgeData>(EMPTY_BADGE);

  const latest = useRef(ctx);
  latest.current = ctx;
  const scopeKey = `${ctx.scope.type}:${ctx.scope.id}`;
  const viewer = ctx.user?.id ?? null;

  useEffect(() => {
    let live = true;
    const ctx = latest.current;
    const scope = ctx.scope;

    Promise.all([
      readScope(ctx, scope, BADGE_KEYS),
      viewer ? ownCardSlugs(ctx, viewer).catch(() => null) : Promise.resolve(null),
    ])
      .then(([episode, mine]) => {
        if (live) {
          setState({
            loading: false,
            template: pick<Template>(episode, KEY_TEMPLATE),
            phase: pick<PhaseState>(episode, KEY_PHASE),
            board: pick<Leaderboard>(episode, KEY_LEADERBOARD),
            hasCard: mine === null ? null : mine.has(scope.id),
          });
        }
      })
      .catch(() => {
        // A badge that cannot read its episode simply does not draw; there is nothing to report here.
        if (live) setState({ ...EMPTY_BADGE, loading: false });
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ctx` is read through `latest`, on purpose.
  }, [scopeKey, viewer]);

  return state;
}

const EMPTY_BADGE: BadgeData = { loading: true, template: null, phase: null, board: null, hasCard: null };

/** How long one listing of the viewer's own cards serves every badge on the page. */
const OWN_CARDS_TTL_MS = 15_000;
let ownCards: { viewer: string; at: number; slugs: Promise<Set<string>> } | null = null;

/**
 * Which episodes the viewer has a card for, from one listing of their own partition shared by every badge
 * on the page.
 *
 * A badge per episode card asking for its own `card:<slug>` would be one request per card on a listing
 * page — the pattern `useBingoBadge` exists to avoid. One `list` by prefix answers all of them, and the
 * partition is the viewer's own: nobody else's cards are, or could be, in it.
 */
function ownCardSlugs(ctx: PluginContext, viewer: string): Promise<Set<string>> {
  const now = Date.now();
  if (ownCards && ownCards.viewer === viewer && now - ownCards.at < OWN_CARDS_TTL_MS) {
    return ownCards.slugs;
  }
  const slugs = ctx.docs
    .list<Card>('self', { prefix: CARD_PREFIX, size: 200 })
    .then((page) => new Set(page.items.map((item) => item.key.slice(CARD_PREFIX.length))));
  ownCards = { viewer, at: now, slugs };
  // A failed listing must not stand in for the next fifteen seconds.
  slugs.catch(() => {
    if (ownCards?.slugs === slugs) ownCards = null;
  });
  return slugs;
}

/** Forgets the shared listing — for tests, which each bring their own partition. */
export function forgetOwnCards(): void {
  ownCards = null;
}

/** Every episode document the tile draws, in one request. */
const TILE_KEYS = [
  KEY_TEMPLATE, KEY_PHASE, KEY_CONTROL, KEY_CANDIDATES, KEY_RESOLUTION, KEY_ANSWERS,
  KEY_LEADERBOARD, KEY_SHOWCASED, KEY_PARTICIPANTS, KEY_SHOWCASE, KEY_GROUPING, KEY_RECAP,
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
 * one per key — eleven for the tile, three for each badge. The answer is `{ scopeId: { key: value } }`,
 * misses absent.
 *
 * Core 0.7.5 fixed the worst of it (core#237): a miss is now remembered for 30 s and forgotten on every
 * navigation. That is still not a reason to switch: the `reload()` after a podcaster's action lands inside
 * the window, so a `phase` or `candidates` the tick wrote meanwhile would stay hidden. This tile only ever
 * wants fresh, and the batch read costs the same one request.
 */
export async function readScope(
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
export function pick<T>(episode: Record<string, unknown>, key: string): T | null {
  return (episode[key] ?? null) as T | null;
}

/** The three documents a feed badge draws from, and whether the viewer has played. */
export interface BadgeData {
  loading: boolean;
  template: Template | null;
  phase: PhaseState | null;
  board: Leaderboard | null;
  /** Whether the viewer has a card for this episode; `null` for an anonymous visitor or an unknown answer. */
  hasCard: boolean | null;
}

/**
 * Turns the user ids on this page into people.
 *
 * `resolve` omits ids it cannot answer for — unknown, erased or pseudonymised, all one shape so the answer
 * cannot be used to tell them apart — so the result is **not** index-aligned with the request. Hence a map
 * keyed on id, and callers that cope with a missing entry.
 */
export async function resolvePeople(
  ctx: PluginContext,
  ids: string[],
): Promise<Record<string, UserRef>> {
  const directory = ctx.users;
  if (!directory || ids.length === 0) return {}; // no `identity` block in the manifest

  try {
    // The host answers at most 500 ids a call; a page of rankings per season can ask for more.
    const unique = [...new Set(ids)];
    const found: UserRef[] = [];
    for (let i = 0; i < unique.length; i += 500) found.push(...(await directory.resolve(unique.slice(i, i + 500))));
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
