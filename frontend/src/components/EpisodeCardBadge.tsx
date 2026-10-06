// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import { makeI18n } from '../i18n';
import { Icon } from '../icons';
import { gridSize, lineCount, type Phase, type RankBy } from '../types';
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
  const best = data.board?.published ? (data.board.ranked ?? [])[0] : undefined;
  // The same quantity the tile leads with: a badge showing the other one would rank nobody.
  const rankBy: RankBy = data.board?.rankBy === 'fields' ? 'fields' : 'lines';

  return (
    <>
      <style>{BINGO_CSS}</style>
      <span className="bingo bingo__badge">
        <Icon name="dice" />
        {!best
          ? i18n.t(BADGE_LABEL[phase])
          : rankBy === 'fields'
            ? i18n.t('card.fields', { fields: String(best.fields), cells: String(best.cells) })
            : i18n.t('card.lines', {
                lines: String(best.lines),
                ofLines: String(lineCount(size)),
              })}
      </span>
    </>
  );
}
