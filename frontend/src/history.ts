// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { History, HistoryEpisode, HistoryPoint, PlayerSeries, RankBy } from './types';

/**
 * Pure transforms over the backend's `history` document, for the site page's charts. No React, no `ctx`:
 * what a chart draws is decided here and tested here.
 */

/** How the form chart reads a player's cards. */
export type FormMode = 'episode' | 'total' | 'place';

/** A season the filter pills offer: its key, and the number to show. */
export interface SeasonKey {
  key: string;
  season: number;
  /** The feed's slug, set only when the history spans more than one feed — "Season 1" alone would be two pills. */
  feed?: string;
}

/** The seasons present in the history, in the order they were first played. Unnumbered episodes have none. */
export function seasonsOf(history: History | null): SeasonKey[] {
  const out: SeasonKey[] = [];
  const seen = new Set<string>();
  for (const e of history?.episodes ?? []) {
    if (e.season == null) continue;
    const key = seasonKey(e);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, season: e.season, feed: e.feed ?? undefined });
    }
  }
  const feeds = new Set(out.map((s) => s.feed));
  return feeds.size > 1 ? out : out.map(({ key, season }) => ({ key, season }));
}

/** A feed slug, readable: "game-of-pods" → "Game of pods". The SDK hands a plugin no feed titles. */
export function feedName(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function seasonKey(e: HistoryEpisode): string {
  return `${e.feed ?? ''}:${e.season ?? ''}`;
}

/** The `history.scopes` key for a season pill's selection: `"all"` for no season. */
export function scopeKey(season: string | null): string {
  return season ?? 'all';
}

/** Indices into `history.episodes` the current filter keeps — all of them for `null`. */
export function episodesIn(history: History | null, season: string | null): number[] {
  const episodes = history?.episodes ?? [];
  return episodes.map((_, i) => i).filter((i) => season === null || seasonKey(episodes[i]) === season);
}

/** The number a card is worth on the site's own scale: the one the leaderboard ranks by. */
export function measure(point: HistoryPoint, rankBy: RankBy): number {
  return rankBy === 'fields' ? point.f : point.l;
}

/**
 * One player's values at each kept episode — `null` where there is nothing to draw.
 *
 * - `episode`: the card's score; a gap where they sat the episode out, so a line never pretends.
 * - `total`: the running total within the filter; flat across an episode they missed, nothing before their
 *   first card.
 * - `place`: their standing among the published players after that episode, by running total (see
 *   {@link standings}).
 */
export function valuesOf(
  series: PlayerSeries,
  kept: number[],
  mode: FormMode,
  rankBy: RankBy,
  places?: Map<string, (number | null)[]>,
): (number | null)[] {
  if (mode === 'place') return places?.get(series.author) ?? kept.map(() => null);
  const byEpisode = new Map(series.points.map((p) => [p.e, p]));
  let total: number | null = null;
  return kept.map((i) => {
    const point = byEpisode.get(i);
    if (mode === 'episode') return point ? measure(point, rankBy) : null;
    if (point) total = (total ?? 0) + measure(point, rankBy);
    return total;
  });
}

/**
 * Everyone's standing after each kept episode, by running total, as a competition rank (ties share a
 * place). Only players who have played by then are placed. Computed over every published series, so the
 * places do not depend on which lines happen to be drawn.
 */
export function standings(players: PlayerSeries[], kept: number[], rankBy: RankBy): Map<string, (number | null)[]> {
  const totals = new Map(players.map((s) => [s.author, valuesOf(s, kept, 'total', rankBy)]));
  const out = new Map<string, (number | null)[]>(players.map((s) => [s.author, []]));
  kept.forEach((_, k) => {
    const here = players
      .map((s) => ({ author: s.author, total: totals.get(s.author)![k] }))
      .filter((x): x is { author: string; total: number } => x.total !== null);
    for (const s of players) {
      const mine = totals.get(s.author)![k];
      out.get(s.author)!.push(mine === null ? null : 1 + here.filter((x) => x.total > mine).length);
    }
  });
  return out;
}

/** How many lines the chart draws at most: the palette's eight slots. */
export const MAX_SHOWN = 8;

/**
 * Who is drawn before anybody picks: the top five, plus the viewer if they are published and not already in
 * it. Never more than {@link MAX_SHOWN}.
 */
export function defaultSelection(players: PlayerSeries[], viewer: string | undefined): string[] {
  const picked = players.slice(0, 5).map((p) => p.author);
  if (viewer && !picked.includes(viewer) && players.some((p) => p.author === viewer)) picked.push(viewer);
  return picked.slice(0, MAX_SHOWN);
}

/** A player's colour slot: their place in the whole published history, so no filter ever repaints them. */
export function slotOf(players: PlayerSeries[], author: string): number {
  return players.findIndex((p) => p.author === author);
}

/**
 * Round tick values from 0 up to at least `max`, about four steps. Counts and scores are whole numbers, so
 * by default no step is smaller than 1 — a "0.5 lines" tick would name a value nothing can take.
 */
export function niceTicks(max: number, opts: { fractional?: boolean } = {}): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  if (!opts.fractional) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let v = 0; v < max + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < max) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(6)));
  return ticks;
}

/** Headline numbers for the kept episodes. Aggregates over everyone, as published. */
export function summary(history: History | null, kept: number[]) {
  const episodes = kept.map((i) => history!.episodes![i]);
  const ranked = episodes.reduce((n, e) => n + e.ranked, 0);
  const cards = episodes.reduce((n, e) => n + e.players, 0);
  const weighted = (pick: (e: HistoryEpisode) => number) =>
    ranked === 0 ? 0 : episodes.reduce((n, e) => n + pick(e) * e.ranked, 0) / ranked;
  const players = new Set<string>();
  for (const s of history?.players ?? []) if (s.points.some((p) => kept.includes(p.e))) players.add(s.author);
  const predictable = episodes.filter((e) => e.candidates > 0);
  return {
    bingos: episodes.length,
    cards,
    namedPlayers: players.size,
    avgFields: weighted((e) => e.avgFields),
    withLine: weighted((e) => e.withLine),
    hitRate:
      predictable.length === 0 ? 0 : predictable.reduce((n, e) => n + e.hitRate, 0) / predictable.length,
  };
}
