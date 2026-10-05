// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The documents this plugin reads and writes, as they sit in the doc store.
 *
 * Keep these in step with the records nested on `BingoDocs` — Jackson serialises those, so the record
 * *is* the wire format and there is no generated type to lean on.
 *
 * Note what is absent: no document anywhere carries a person's name. Rows and cards carry a user id, and
 * the name and avatar are resolved through `ctx.users` at the moment they are drawn.
 */

/** Only `ARCHIVED` is terminal; everything else can still move. */
export type Phase = 'OPEN' | 'LOCKED' | 'RESOLVED' | 'ARCHIVED';

/** Grid and title. Its presence in the episode scope is what makes an episode have a bingo. */
export interface Template {
  size?: number;
  title?: string;
  /** Whether the middle square is a gift. Absent means no — every square is the player's to write. */
  freeCentre?: boolean;
}

/** One person's card, as they wrote it. */
export interface Card {
  entries?: string[];
}

/**
 * How a person wants to appear, stored in their own partition and **not** per episode.
 *
 * Two switches because the exposures differ: being listed shows a name and a score, being featured shows
 * a whole card. Absent means yes for both — the toggles sit next to the save button.
 */
export interface Prefs {
  listed?: boolean;
  showcasable?: boolean;
  /**
   * Whether the card editor offers suggestions. A choice about this person's own screen only, so it sits
   * in their partition with the rest and the backend never reads it. Absent means yes.
   */
  suggestions?: boolean;
  updatedAt?: string;
}

/** The podcaster's shared truth list, keyed by a candidate's canonical form. */
export interface Resolution {
  hits?: Record<string, boolean>;
}

/** The podcaster's stated intent. Client-written, and it beats the derived suggestion. */
export interface Control {
  phase: Phase;
  updatedAt: string;
}

/**
 * The podcaster's corrections to the grouping, keyed by an entry as written. The value is the canonical
 * form of the group it belongs in, or `''` for a group of its own. Client-written.
 */
export interface GroupingDoc {
  pins?: Record<string, string>;
  updatedAt?: string;
}

/** Whom the podcaster picked to feature. Client-written. */
export interface Showcase {
  userIds?: string[];
}

/** The lifecycle state the backend derives. Backend-owned — read-only from here. */
export interface PhaseState {
  phase: Phase;
  suggested: Phase;
  /** Sticky, decided on first sight: a bingo made for an already-published episode is not auto-locked. */
  openedBeforeRelease?: boolean;
  /** Whether a card may still be handed in after the lock. Published because there is no `ctx.config`. */
  allowLate?: boolean;
  lockedAt: string | null;
  resolvedAt: string | null;
  archiveAt: string | null;
  /** How alike two entries must be to count as one. Published because there is no `ctx.config`. */
  fuzzyThreshold?: number;
}

/** One prediction several people keep making. */
export interface Suggestion {
  label: string;
  /** How many different people wrote it — never fewer than two. */
  people: number;
  /** On how many episodes' cards it appeared. */
  episodes: number;
  /** On how many of those it came true. */
  hits: number;
}

/** Backend-owned, site scope: what the card editor offers. */
export interface Suggestions {
  items?: Suggestion[];
  computedAt?: string;
}

/** A candidate worth naming in a recap. */
export interface Highlight {
  label: string;
  /** On how many cards. */
  cards: number;
  hit: boolean;
}

/**
 * Backend-owned: one bingo in a few lines. `published` is false — and everything but `players` empty —
 * until it is resolved, because "the most predicted thing came true" is the spoiler.
 */
export interface Recap {
  published: boolean;
  players: number;
  ranked: number;
  /** Squares that came true on an average ranked card, the free centre included. */
  avgFields: number;
  /** The share of ranked cards, 0 to 1, with at least one line. */
  withLine: number;
  mostPredicted: Highlight | null;
  rarestHit: Highlight | null;
  biggestMiss: Highlight | null;
  computedAt?: string;
}

/** One distinct thing to tick off, merged across every card. */
export interface Candidate {
  canonical: string;
  label: string;
  /** How many entries landed in this group — larger than the card count when somebody wrote it twice. */
  count: number;
}

/** Backend-owned: cards are invisible to every browser but their own, so this comes from the backend. */
export interface Candidates {
  items?: Candidate[];
  /**
   * Which candidate each written entry belongs to, as the backend decided it.
   *
   * Published deliberately: without it the browser would need its own copy of the fuzzy-matching rules,
   * and two implementations of "are these the same thing" disagree sooner or later.
   */
  assignments?: Record<string, string>;
  /**
   * How many distinct cards carry each candidate, keyed by canonical form.
   *
   * Separate from `Candidate.count` because they answer different questions, and the one a podcaster is
   * asking while ticking off is "how many people predicted this", never "how many times was it typed".
   */
  cards?: Record<string, number>;
  computedAt?: string;
}

/** One card's standing. Just an id and a score — the person is drawn at render. */
export interface Row {
  author: string;
  /** Squares that came true, the free centre included. */
  fields: number;
  /** Completed rows, columns and diagonals. */
  lines: number;
  cells: number;
  ranked: boolean;
}

/** Backend-owned. `late` is everyone who joined after the lock; both omit anyone who opted out. */
export interface Leaderboard {
  ranked?: Row[];
  late?: Row[];
  /** How many are taking part. Shown before the board itself is, which is the part worth knowing early. */
  players?: number;
  totalPlayers?: number;
  /**
   * False until the bingo is resolved, and the row lists are empty then.
   *
   * A board that creeps upward while somebody ticks answers off tells anyone watching how much has already
   * come true — which is exactly what the spoiler cover over the grid exists to prevent.
   */
  published?: boolean;
  /**
   * How many ranked cards share each score.
   *
   * This is what lets somebody in 73rd place still learn they are 73rd: the board is capped, so their row
   * is not in it, but counting how many scored better places them exactly. It costs an entry per distinct
   * score rather than per player, and names nobody.
   */
  distribution?: Tally[];
  /**
   * Which quantity the site ranks on, published because the frontend has no `ctx.config`.
   *
   * A tile that leads with the wrong number tells people to optimise for something that decides nothing.
   */
  rankBy?: RankBy;
  computedAt?: string;
}

/** Which quantity orders the board; the other always breaks the tie. */
export type RankBy = 'lines' | 'fields';

/** How many ranked cards share one score. */
export interface Tally {
  lines: number;
  fields: number;
  count: number;
}

/** Someone a podcaster could feature. An id only; the picker resolves it. */
export interface Participant {
  userId: string;
}

/** Backend-owned: who could be featured for this episode. */
export interface Participants {
  items?: Participant[];
  computedAt?: string;
}

/** A featured card, copied out of its author's partition so anyone may read it. */
export interface ShowcasedCard {
  userId: string;
  entries?: string[];
}

/** Backend-owned: the featured cards. */
export interface Showcased {
  items?: ShowcasedCard[];
  computedAt?: string;
}

/** The grid size to use when a template does not say. Mirrors the backend's own default. */
export const DEFAULT_GRID_SIZE = 3;

/**
 * Whether the middle square is a gift rather than a square to fill in.
 *
 * Absent means **no**: a bingo says so explicitly, or every square is yours to write. The opposite default
 * quietly hands everyone a point they never earned and hides a square they meant to use.
 */
export function hasFreeCentre(template: Template | null): boolean {
  return template?.freeCentre === true && gridSize(template) % 2 === 1;
}

/** How many cells a person actually fills in: the whole grid, less the free centre if there is one. */
export function fillableCells(size: number, freeCentre: boolean): number {
  return size * size - (freeCentre && size % 2 === 1 ? 1 : 0);
}

/** How many lines an n-by-n grid has: every row, every column, both diagonals. */
export function lineCount(size: number): number {
  return 2 * size + 2;
}

/** A template's grid size, defaulted and floored the same way the backend does. */
export function gridSize(template: Template | null): number {
  const size = template?.size;
  return !size || size < 2 ? DEFAULT_GRID_SIZE : size;
}

/**
 * Whether this person may still change their card.
 *
 * Editable while predictions are open. After the lock the backend never re-reads a card that already has
 * rows, so offering an edit there would be a control that does nothing — the one exception is a card that
 * does not exist yet, which a latecomer may hand in exactly once.
 */
export function canEditCard(phase: Phase, hasCard: boolean, allowLate: boolean): boolean {
  if (phase === 'OPEN') return true;
  if (phase === 'ARCHIVED') return false;
  return allowLate && !hasCard;
}

/** Whether that edit is a one-shot: handed in after the lock, ingested once and never re-read. */
export function isFinalSubmission(phase: Phase): boolean {
  return phase !== 'OPEN';
}

/** Whether a card started now would count towards the board, or only towards its owner's amusement. */
export function countsTowardsRanking(phase: Phase): boolean {
  return phase === 'OPEN';
}

/**
 * Counts the complete lines on a grid: every row, every column, and both diagonals.
 *
 * Deliberately a second implementation of what the backend already does — unlike the fuzzy matching, which
 * is published as a decision precisely so it is never reimplemented here. Line counting is exact integer
 * geometry with no threshold and no normalisation, so two implementations cannot plausibly disagree, and
 * having one here is what lets a reader place themselves without the server publishing everybody.
 */
export function countLines(hits: boolean[], size: number): number {
  if (hits.length !== size * size) return 0;
  let lines = 0;
  for (let r = 0; r < size; r++) {
    if (hits.slice(r * size, r * size + size).every(Boolean)) lines++;
  }
  for (let c = 0; c < size; c++) {
    let whole = true;
    for (let r = 0; r < size; r++) whole = whole && hits[r * size + c];
    if (whole) lines++;
  }
  let down = true;
  let up = true;
  for (let i = 0; i < size; i++) {
    down = down && hits[i * size + i];
    up = up && hits[i * size + (size - 1 - i)];
  }
  if (down) lines++;
  if (up) lines++;
  return lines;
}

/** Lays a card's hits out over the grid, giving the middle square away when this bingo does. */
export function hitGrid(hits: boolean[], size: number, freeCentre: boolean): boolean[] {
  const centre = freeCentre && size % 2 === 1 ? Math.floor((size * size) / 2) : -1;
  const grid = new Array<boolean>(size * size).fill(false);
  let entry = 0;
  for (let cell = 0; cell < size * size; cell++) {
    if (cell === centre) {
      grid[cell] = true;
      continue;
    }
    grid[cell] = hits[entry++] === true;
  }
  return grid;
}

/**
 * Which place a score takes, counting how many did better.
 *
 * Standard competition ranking: everyone on the same score shares a place. Returns `null` when the tally
 * says nothing about this score, which is the honest answer rather than a made-up position.
 */
export function placeIn(
  distribution: Tally[] | undefined,
  score: { lines: number; fields: number },
  rankBy: RankBy,
): number | null {
  if (!distribution || distribution.length === 0) return null;
  const better = (t: Tally) =>
    rankBy === 'fields'
      ? t.fields > score.fields || (t.fields === score.fields && t.lines > score.lines)
      : t.lines > score.lines || (t.lines === score.lines && t.fields > score.fields);
  return 1 + distribution.filter(better).reduce((n, t) => n + t.count, 0);
}

/** Absent means yes: someone who has never touched the toggles is listed and may be featured. */
/** The grouping threshold until the backend's first pass has published the site's own. */
export const DEFAULT_FUZZY_THRESHOLD = 0.82;

export function prefOrDefault(value: boolean | undefined): boolean {
  return value !== false;
}

/** One player's cumulative standing across every resolved episode. */
export interface StandingRow {
  author: string;
  fields: number;
  lines: number;
  /** How many ranked cards it is summed over. */
  cards: number;
  cells: number;
}

/** One bingo as the site page lists it — only episodes everyone may know about. */
export interface BingoSummary {
  slug: string;
  /** The bingo's own name, if it has one; the episode's title is read live. */
  title?: string | null;
  phase: Phase;
  /** Everyone who played; absent for an archived bingo, which the backend never reads again. */
  players?: number | null;
}

/** Backend-owned, site scope: cumulative standings and the list of bingos, for the plugin's page. */
export interface Stats {
  players?: StandingRow[];
  episodes?: number;
  bingos?: BingoSummary[];
  computedAt?: string;
}


/** One card on a player's series: episode index, squares, lines, place among every ranked card (1 best). */
export interface HistoryPoint {
  e: number;
  f: number;
  l: number;
  p: number;
}

/** One resolved bingo in the history, oldest first. Aggregates count every card and name nobody. */
export interface HistoryEpisode {
  slug: string;
  /** The bingo's own name, if it has one; the episode's title is read live. */
  title?: string | null;
  feed?: string | null;
  season?: number | null;
  episodeNo?: number | null;
  publishedAt?: string | null;
  players: number;
  ranked: number;
  late: number;
  avgFields: number;
  avgLines: number;
  /** Share, 0 to 1, of ranked cards with at least one line. */
  withLine: number;
  /** Share, 0 to 1, of distinct predictions that came true. */
  hitRate: number;
  candidates: number;
  /** How many ranked cards ended with 0, 1, 2… lines, by index. */
  lineCounts?: number[];
}

/** One listed player's ranked cards, oldest first. */
export interface PlayerSeries {
  author: string;
  cards: number;
  points: HistoryPoint[];
}

/** Records over the whole history; each names a listed player or an episode, or is absent. */
export interface HistoryRecords {
  bestCard?: { author: string; slug: string; fields: number; lines: number; cells: number } | null;
  mostCards?: { author: string; count: number } | null;
  longestStreak?: { author: string; count: number } | null;
  mostPredictable?: { slug: string; hitRate: number } | null;
  leastPredictable?: { slug: string; hitRate: number } | null;
}

/** Backend-owned, site scope: how past bingos went, for the site page's charts. Resolved, public bingos only. */
export interface History {
  episodes?: HistoryEpisode[];
  /** At most fifty, best cumulative score first — which is also each player's colour slot. */
  players?: PlayerSeries[];
  distribution?: { lines: number; cards: number }[];
  records?: HistoryRecords;
  rankBy?: RankBy;
  computedAt?: string;
}

/** What one claim did. */
export interface ClaimResult {
  linked: number;
  skipped: number;
  at?: string;
}

/** Backend-owned, site scope: imports and claims, by code hash only. */
export interface Imports {
  /** Unused code hash → the pseudonym it unlocks. Present means this site has imported bingos. */
  claims?: Record<string, string>;
  /** Used code hash → what claiming it did. */
  claimed?: Record<string, ClaimResult>;
  updatedAt?: string;
}

/** A player's claim codes, in their own partition. `savedAt` lets the box tell "waiting" from "unknown". */
export interface ClaimDoc {
  codes?: string[];
  savedAt?: Record<string, string>;
}
