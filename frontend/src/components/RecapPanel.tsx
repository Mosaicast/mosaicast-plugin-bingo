// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import type { Highlight, Recap } from '../types';

/**
 * One bingo in a few lines: what most people predicted, the hit nearly nobody saw coming, the miss
 * everybody did, and how an average card did.
 *
 * Renders nothing until the backend publishes it, which it does only once the bingo is resolved. It names
 * what happened in the episode, so a caller keeps it behind the same spoiler cover as the grid.
 */
export function RecapPanel({ recap, i18n }: { recap: Recap | null; i18n: PluginI18n }) {
  if (!recap?.published || recap.ranked === 0) return null;

  const line = (key: string, highlight: Highlight | null) =>
    highlight && (
      <li>
        {i18n.t(key, { label: highlight.label, cards: String(highlight.cards) })}
        {key === 'recap.mostPredicted' && ` · ${i18n.t(highlight.hit ? 'recap.happened' : 'recap.didNotHappen')}`}
      </li>
    );

  return (
    <section className="bingo__recap" aria-label={i18n.t('recap.title')}>
      <p className="bingo__section-title">
        <Icon name="board" /> {i18n.t('recap.title')}
      </p>
      <ul className="bingo__recap-list">
        {line('recap.mostPredicted', recap.mostPredicted)}
        {line('recap.rarestHit', recap.rarestHit)}
        {line('recap.biggestMiss', recap.biggestMiss)}
        <li>
          {i18n.t('recap.average', {
            fields: recap.avgFields.toLocaleString(i18n.locale, { maximumFractionDigits: 1 }),
            percent: String(Math.round(recap.withLine * 100)),
          })}
        </li>
      </ul>
    </section>
  );
}
