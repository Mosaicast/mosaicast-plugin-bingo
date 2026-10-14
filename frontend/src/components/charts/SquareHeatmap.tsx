// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginI18n } from '../../i18n';
import type { SquareStats } from '../../types';

/** The strongest tint a square gets: enough to read as a heatmap, light enough that text on it stays legible. */
const MAX_TINT = 40;

/**
 * How often each square of the grid came true, drawn as the grid itself.
 *
 * Every square says its rate and its count in text, so the tint is never the only way to read it; the best
 * square also gets a state border. Draws the grid size most predictions were made on — a site that only ever
 * plays one size has exactly one.
 */
export function SquareHeatmap({ i18n, squares }: { i18n: PluginI18n; squares: SquareStats[] | undefined }) {
  const grid = [...(squares ?? [])].sort((a, b) => total(b) - total(a))[0];
  if (!grid || total(grid) === 0) return null;
  const rates = grid.cells.map((c) => (c.predicted > 0 ? c.hits / c.predicted : null));
  const top = Math.max(...rates.map((r) => r ?? -1));
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <section aria-label={i18n.t('squares.title')}>
      <h3 className="bingo__chart-title">{i18n.t('squares.title')}</h3>
      <p className="bingo__note">{i18n.t('squares.hint')}</p>
      <div className="bingo__heatmap" role="list" style={{ gridTemplateColumns: `repeat(${grid.size}, minmax(0, 1fr))` }}>
        {grid.cells.map((cell, i) => {
          const rate = rates[i];
          const where = { row: String(Math.floor(i / grid.size) + 1), col: String((i % grid.size) + 1) };
          const label = rate === null
            ? i18n.t('squares.cellEmpty', where)
            : i18n.t('squares.cell', { ...where, rate: pct(rate), hits: String(cell.hits), predicted: String(cell.predicted) });
          const tint = rate === null ? 0 : Math.round(rate * MAX_TINT);
          return (
            <div key={i} role="listitem" aria-label={label}
              className={rate !== null && rate === top ? 'bingo__heat bingo__heat--top' : 'bingo__heat'}
              style={{ background: `color-mix(in srgb, var(--mc-accent) ${tint}%, var(--mc-bg))` }}>
              {rate === null ? (
                <span className="bingo__heat-sub">–</span>
              ) : (
                <>
                  <span className="bingo__heat-value">{pct(rate)}</span>
                  <span className="bingo__heat-sub">{i18n.t('squares.of', { hits: String(cell.hits), predicted: String(cell.predicted) })}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function total(grid: SquareStats): number {
  return grid.cells.reduce((n, c) => n + c.predicted, 0);
}
