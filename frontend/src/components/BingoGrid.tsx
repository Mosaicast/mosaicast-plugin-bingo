// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginI18n } from '../i18n';

/** One square: a written entry, or the free middle of an odd grid. */
type Cell = { kind: 'free' } | { kind: 'entry'; index: number };

/**
 * Lays a card's entries out over a square grid, giving away the middle square when there is one.
 *
 * Only an odd grid has a middle to give away, so a 4x4 board is simply sixteen things to predict — the
 * alternative would be picking one of four centre squares arbitrarily.
 */
export function cellsFor(size: number, freeCentre: boolean): Cell[] {
  const centre = freeCentre && size % 2 === 1 ? Math.floor((size * size) / 2) : -1;
  const cells: Cell[] = [];
  let index = 0;
  for (let i = 0; i < size * size; i++) {
    cells.push(i === centre ? { kind: 'free' } : { kind: 'entry', index: index++ });
  }
  return cells;
}

interface Props {
  size: number;
  /** Whether the middle square is a gift. Decided per bingo when it is created. */
  freeCentre: boolean;
  entries: string[];
  i18n: PluginI18n;
  /** Which entries came true, by their position in `entries`. */
  hits?: boolean[];
  /** When set, the grid is editable and reports every change. */
  onChange?: (index: number, value: string) => void;
  /** Labels the inputs for assistive tech; the visible name lives in the tab above. */
  label: string;
  /** Squares the card editor has something to say about, by entry index (see `CardChecks`). */
  flags?: Record<number, 'duplicate' | 'similar'>;
  /** Told which square the player is in, so a picked suggestion can land there. */
  onFocusCell?: (index: number) => void;
}

export function BingoGrid({
  size,
  freeCentre,
  entries,
  i18n,
  hits,
  onChange,
  label,
  flags,
  onFocusCell,
}: Props) {
  const cells = cellsFor(size, freeCentre);
  const editable = Boolean(onChange);

  return (
    <div
      className="bingo__grid"
      role="group"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
    >
      {cells.map((cell, i) => {
        if (cell.kind === 'free') {
          return (
            <div key={`free-${i}`} className="bingo__cell bingo__cell--free bingo__cell--hit">
              {i18n.t('episode.freeCentre')}
            </div>
          );
        }
        const value = entries[cell.index] ?? '';
        const hit = hits?.[cell.index] ?? false;
        const flag = flags?.[cell.index];
        const classes = [
          'bingo__cell',
          hit ? 'bingo__cell--hit' : '',
          flag ? `bingo__cell--${flag}` : '',
          !editable && !value ? 'bingo__cell--empty' : '',
        ]
          .filter(Boolean)
          .join(' ');

        if (editable) {
          return (
            <div key={cell.index} className={classes}>
              <textarea
                className="bingo__cell-input"
                value={value}
                aria-label={`${label} ${cell.index + 1}`}
                aria-invalid={flag === 'duplicate' || undefined}
                onChange={(e) => onChange?.(cell.index, e.target.value)}
                onFocus={() => onFocusCell?.(cell.index)}
              />
            </div>
          );
        }
        return (
          <div key={cell.index} className={classes}>
            {value}
          </div>
        );
      })}
    </div>
  );
}
