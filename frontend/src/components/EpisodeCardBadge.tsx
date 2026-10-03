// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo } from 'react';
import type { EpisodePhase, PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { Icon } from '../icons';
import { gridSize, lineCount, type Phase, type RankBy, type Row } from '../types';
import { BINGO_CSS } from './styles';
import { useBingoBadge } from './useBingo';

/**
 * The one-line badge inside an episode feed card.
 *
 * This is the narrowest place the plugin ever renders — a phone-width card in a list — so it says one
 * thing and nothing else, and it renders nothing at all rather than an empty box when the episode has no
 * bingo.
 */
/**
 * What a badge says when there is no score to lead with yet.
 *
 * Never "no bingo": the badge does not render at all without a template, so that branch could only ever
 * fire on a bingo that plainly exists — and a locked one announcing itself as absent is worse than saying
 * nothing. Each phase says the true thing about itself instead.
 */
const BADGE_LABEL: Record<Phase, string> = {
  OPEN: 'card.open',
  LOCKED: 'card.locked',
  RESOLVED: 'card.resolved',
  ARCHIVED: 'card.resolved',
};

export function EpisodeCardBadge({ ctx }: { ctx: PluginContext }) {
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx.locale]);
  useEffect(() => () => i18n.dispose(), [i18n]);

  // Deliberately not the tile's hook: a badge draws three documents, and reading the other nine once per
  // episode card is what turned a listing page into a wall of 404s.
  const data = useBingoBadge(ctx);

  if (data.loading || !data.template) {
    return null;
  }

  const phase: Phase = data.phase?.phase ?? 'OPEN';
  const size = gridSize(data.template);
  // Only ever the published board, so the badge cannot leak progress the tile itself is hiding.
  const rows = data.board?.published ? [...(data.board.ranked ?? []), ...(data.board.late ?? [])] : [];
  const best = data.board?.published ? (data.board.ranked ?? [])[0] : undefined;
  // The viewer's own row, when the board carries it: their score is the one they came to see.
  const mine = ctx.user ? rows.find((row) => row.author === ctx.user?.id) : undefined;
  // The same quantity the tile leads with: a badge showing the other one would rank nobody.
  const rankBy: RankBy = data.board?.rankBy === 'fields' ? 'fields' : 'lines';
  const score = (row: Row) =>
    rankBy === 'fields'
      ? i18n.t('card.fields', { fields: String(row.fields), cells: String(row.cells) })
      : i18n.t('card.lines', { lines: String(row.lines), ofLines: String(lineCount(size)) });

  const label = badgeLabel({
    phase,
    // Where the episode stands, from the host: only a podcaster ever sees `planned` (0.18.0).
    episode: ctx.episode?.phase,
    hasCard: data.hasCard,
    mine: mine ? i18n.t('card.yours', { score: score(mine) }) : null,
    best: best ? score(best) : null,
    t: (key) => i18n.t(key),
  });

  return (
    <>
      <style>{BINGO_CSS}</style>
      <span className="bingo bingo__badge">
        <Icon name="dice" />
        {label}
      </span>
    </>
  );
}

/**
 * What a badge says, most specific first: a podcaster's quiet bingo, the viewer's own card, the best score,
 * and only then where the bingo stands.
 *
 * Everything here is either on the documents the badge already read or on `ctx` — no reads of its own.
 */
export function badgeLabel({
  phase,
  episode,
  hasCard,
  mine,
  best,
  t,
}: {
  phase: Phase;
  episode: EpisodePhase | undefined;
  /** `null` for an anonymous visitor, or when the answer is unknown. */
  hasCard: boolean | null;
  /** The viewer's own score, already worded, when the published board carries it. */
  mine: string | null;
  best: string | null;
  t: (key: string) => string;
}): string {
  if (episode === 'planned') return t('card.quiet');
  if (mine) return mine;
  if (phase === 'OPEN' && hasCard === true) return t('card.yourCardIsIn');
  if (phase === 'OPEN' && hasCard === false) {
    return t(episode === 'upcoming' ? 'card.predictBeforeItAirs' : 'card.fillIn');
  }
  if (best) return best;
  if (phase === 'OPEN' && episode === 'upcoming') return t('card.predictBeforeItAirs');
  return t(BADGE_LABEL[phase]);
}

