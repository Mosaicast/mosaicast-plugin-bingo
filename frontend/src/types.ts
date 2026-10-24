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

/** What came true, by canonical form: the resolution, copied out by the backend at RESOLVED. */
export interface Answers {
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
  return completedLines(hits, size).length;
}

/** One completed line: the grid squares it runs between, first to last. */
export interface CompletedLine {
  from: number;
  to: number;
}

/**
 * Every complete row, column and diagonal on a grid of hits, by its two end squares. What the card draws a
 * stroke through, and — counted — the score in lines, so the two cannot disagree.
 */
export function completedLines(hits: boolean[], size: number): CompletedLine[] {
  if (hits.length !== size * size) return [];
  const lines: CompletedLine[] = [];
  const whole = (cells: number[]) => cells.every((c) => hits[c]);
  const range = (f: (i: number) => number) => Array.from({ length: size }, (_, i) => f(i));
  for (let r = 0; r < size; r++) {
    const cells = range((c) => r * size + c);
    if (whole(cells)) lines.push({ from: cells[0], to: cells[size - 1] });
  }
  for (let c = 0; c < size; c++) {
    const cells = range((r) => r * size + c);
    if (whole(cells)) lines.push({ from: cells[0], to: cells[size - 1] });
  }
  const down = range((i) => i * size + i);
  if (whole(down)) lines.push({ from: down[0], to: down[size - 1] });
  const up = range((i) => i * size + (size - 1 - i));
  if (whole(up)) lines.push({ from: up[0], to: up[size - 1] });
  return lines;
}

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
  /** The grid's edge, as the template states it. */
  size?: number | null;
  freeCentre?: boolean | null;
  /** The episode's feed and season (0.8.0): what the page's season tabs are built from. */
  feed?: string | null;
  season?: number | null;
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

export interface CardRecord { author: string; slug: string; fields: number; lines: number; cells: number }
export interface PlayerCount { author: string; count: number }
export interface EpisodeRate { slug: string; hitRate: number }

/**
 * A record's ranking: the holder first, then up to nine runners-up. A `history` document written before 0.8.0
 * holds the holder alone, as an object — read every record through `rankingOf`.
 */
export type Ranked<T> = T[] | T | null;

/** Records within a scope; each row names a listed player or an episode. */
export interface HistoryRecords {
  bestCard?: Ranked<CardRecord>;
  mostCards?: Ranked<PlayerCount>;
  longestStreak?: Ranked<PlayerCount>;
  mostPredictable?: Ranked<EpisodeRate>;
  leastPredictable?: Ranked<EpisodeRate>;
  /** Most predictions that came true and that no other card of that bingo had. */
  loneHits?: Ranked<PlayerCount>;
  /** Most cards without a line that were one square short of one. */
  nearMisses?: Ranked<PlayerCount>;
}

/** One prediction across the bingos of a scope. Only text at least two people wrote is ever published. */
export interface PredictionRow {
  /** The first spelling of it anyone used. */
  label: string;
  /** On how many bingos' ranked cards it appeared. */
  bingos: number;
  /** On how many of those it came true. */
  hits: number;
  people: number;
  cards: number;
}

/** Which predictions came true most and least often, and which were made most, within one scope. */
export interface PredictionStats {
  /** How many bingos a prediction needs before `best` or `worst` rate it. */
  floor: number;
  /** True in more than half its bingos; most reliable first, so a long record beats a lucky streak (Wilson). */
  best?: PredictionRow[];
  /** True in fewer than half; least reliable first. */
  worst?: PredictionRow[];
  /** On the most cards first. */
  popular?: PredictionRow[];
}

/** How often each square of one grid size came true; `cells` in reading order, a free centre with nothing predicted. */
export interface SquareStats {
  size: number;
  cells: { predicted: number; hits: number }[];
}

/** One player's score per card within a scope. */
export interface AverageRow {
  author: string;
  cards: number;
  fields: number;
  lines: number;
}

/** Rankings and records within one scope. Listed players only; those below the card bar are counted, never named. */
export interface ScopeStats {
  byTotal?: StandingRow[];
  byAverage?: AverageRow[];
  /** How many cards the per-card ranking asks for in this scope. */
  bar: number;
  belowBar: number;
  records?: HistoryRecords;
  bingos: number;
  predictions?: PredictionStats | null;
  /** One entry per grid size, smallest first. */
  squares?: SquareStats[];
}

/** Backend-owned, site scope: how past bingos went, for the site page's charts. Resolved, public bingos only. */
export interface History {
  episodes?: HistoryEpisode[];
  /** At most fifty, best cumulative score first — which is also each player's colour slot. */
  players?: PlayerSeries[];
  distribution?: { lines: number; cards: number }[];
  /** Rankings and records per scope: `"all"`, or one season as `<feed>:<season>` (see `scopeKey`). */
  scopes?: Record<string, ScopeStats>;
  rankBy?: RankBy;
  computedAt?: string;
}

/** The claimed cards, encrypted with the claim code; see `claimCards.ts`. */
export interface Sealed {
  iv: string;
  data: string;
  episodes: string[];
}

/** What one claim did. */
export interface ClaimResult {
  linked: number;
  skipped: number;
  at?: string;
  /** The episodes whose imported card moved to the claimant. */
  episodes?: string[];
  sealed?: Sealed | null;
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

// ---------------------------------------------------------------- draft rounds (BingoDraft / BingoDrafts)

/** What the person running a draft round chose. Seconds; `null` means no limit. */
export interface DraftSettings {
  clock: boolean;
  turnSeconds: number | null;
  bankSeconds: number | null;
  incrementSeconds: number | null;
  duplicateCheck: boolean;
}

export type DraftStatus = 'LOBBY' | 'RUNNING' | 'FINISHED' | 'CANCELLED';
export type DraftStage = 'REGULAR' | 'MAKEUP' | 'SOLO';

/** One player in a running round. `cells` only comes with `draft-state`; an update leaves it out. */
export interface DraftSeat {
  userId: string;
  bankMs: number | null;
  out: boolean;
  done: boolean;
  skipped: number;
  filled: number;
  cells?: string[];
}

/** A square on somebody else's card that a new one came close to. */
export interface DraftMatch {
  userId: string;
  cell: number;
  text: string;
}

/** A square waiting on the other players. Who voted is public, how they voted never is. */
export interface DraftVote {
  by: string;
  cell: number;
  text: string;
  matches: DraftMatch[];
  voters: string[];
  voted: string[];
  deadline: number | null;
  awaitingHost: boolean;
}

/** The turn, the clocks, the vote. Times are the server's epoch milliseconds. */
export interface DraftGame {
  stage: DraftStage | null;
  overtime: number;
  current: string | null;
  turnStartedAt: number;
  usedMs: number;
  turnLimitMs: number | null;
  deadline: number | null;
  seats: DraftSeat[];
  vote?: DraftVote;
  turnedDown?: { by: string; text: string };
}

/** One round as a member sees it, through `draft-state`. */
export interface DraftView {
  id: string;
  version: number;
  /** The server's clock when this was sent, so countdowns don't depend on the device's clock. */
  now: number;
  status: DraftStatus;
  /** Absent while the episode is quiet and the reader is a fan. */
  episode?: string;
  host: string;
  size: number;
  freeCentre: boolean;
  /** The site's fuzzy threshold when the round was made, for the browser's own hint. */
  threshold: number;
  settings: DraftSettings;
  invited: string[];
  order: string[];
  createdAt: number;
  endedAt?: number;
  game?: DraftGame;
  quiet?: boolean;
  /** For podcasters and admins: the episode isn't announced, so only they can join. */
  quietEpisode?: boolean;
  /** For the host, in the lobby, while not playing: they already have a card here, so they can't play. */
  hostHasCard?: boolean;
  /** The invite link's secret: for the host only. */
  code?: string;
  /** Who has the round open right now. */
  online?: string[];
}

/** One `update` event: a whole view without the cards, plus the one square written, if any. */
export interface DraftUpdate extends Omit<DraftView, 'code' | 'online' | 'quiet' | 'quietEpisode' | 'hostHasCard'> {
  written?: { userId: string; cell: number; text: string };
}

/** What somebody holding the link's code sees before joining. */
export interface DraftPreview {
  id: string;
  preview: true;
  status: DraftStatus;
  host: string;
  players: number;
  quiet: boolean;
  episode?: string;
}

/** One of the reader's rounds, as `draft-inbox` lists them. */
export interface DraftInboxItem {
  id: string;
  status: DraftStatus;
  host: string;
  role: 'host' | 'player' | 'invited';
  players: number;
  yourTurn: boolean;
  createdAt: number;
  endedAt?: number;
  episode?: string;
}
