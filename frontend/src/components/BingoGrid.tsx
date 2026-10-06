// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useLayoutEffect, useRef, useState } from 'react';
import type { PluginI18n } from '../i18n';
import { completedLines, hitGrid, type CompletedLine } from '../types';

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
  // Strokes only on a card that is read, never on one being written: there is nothing to have hit yet.
  const lines = editable || !hits ? [] : completedLines(hitGrid(hits, size, freeCentre), size);

  const wrap = useRef<HTMLDivElement>(null);
  const squares = useRef<(HTMLDivElement | null)[]>([]);
  const strokes = useStrokes(wrap, squares, lines);

  return (
    <div className="bingo__grid-wrap" ref={wrap}>
      <div
        className="bingo__grid"
        role="group"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {cells.map((cell, i) => {
          const keep = (el: HTMLDivElement | null) => {
            squares.current[i] = el;
          };
          if (cell.kind === 'free') {
            return (
              <div key={`free-${i}`} ref={keep} className="bingo__cell bingo__cell--free bingo__cell--hit">
                <span className="bingo__cell-text">{i18n.t('episode.freeCentre')}</span>
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
              <div key={cell.index} ref={keep} className={classes}>
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
            <div key={cell.index} ref={keep} className={classes}>
              <span className="bingo__cell-text">{value}</span>
            </div>
          );
        })}
      </div>
      {lines.length > 0 && (
        // Decoration only: the score in lines is in the tab label, and each square says it came true.
        <svg className="bingo__strikes" aria-hidden="true" width={strokes.width} height={strokes.height}>
          {strokes.segments.map((s, k) => (
            <line
              key={`${lines[k].from}-${lines[k].to}`}
              className="bingo__strike"
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              strokeWidth={s.width}
              pathLength={1}
              style={{ animationDelay: `${k * 120}ms` }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/** A band's thickness, as a share of a square's shorter side: across rows and columns, and along diagonals. */
const BAND = 0.62;
const BAND_DIAGONAL = 0.42;
/** How far a band's rounded end stays inside the end squares' edges, in pixels. */
const INSET = 6;

/**
 * Where each line's stroke runs, in pixels of the grid's own box — measured from the squares themselves,
 * so it is exact at any width, any gap and any grid size, and re-measured whenever the grid is resized.
 */
function useStrokes(
  wrap: React.RefObject<HTMLDivElement | null>,
  squares: React.RefObject<(HTMLDivElement | null)[]>,
  lines: CompletedLine[],
) {
  const [box, setBox] = useState<{ width: number; height: number; segments: Segment[] }>({
    width: 0,
    height: 0,
    segments: [],
  });
  const key = lines.map((l) => `${l.from}-${l.to}`).join(',');

  useLayoutEffect(() => {
    const host = wrap.current;
    if (!host || lines.length === 0) return;
    const measure = () => {
      const origin = host.getBoundingClientRect();
      const centre = (i: number) => {
        const r = squares.current?.[i]?.getBoundingClientRect();
        return r
          ? { x: r.left - origin.left + r.width / 2, y: r.top - origin.top + r.height / 2, w: r.width, h: r.height }
          : { x: 0, y: 0, w: 0, h: 0 };
      };
      const segments = lines.map(({ from, to }) => bandBetween(centre(from), centre(to)));
      setBox({ width: origin.width, height: origin.height, segments });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which lines there are
  }, [key]);

  // Until measured, nothing; a stroke at 0,0 for one frame would flash across the corner.
  return box.segments.length === lines.length ? box : { ...box, segments: [] };
}

/** A square's centre and size, in pixels of the grid's box. */
export interface Square {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The band through a completed line, from its first square to its last. It runs centre to centre and on
 * into the two end squares for as long as its round cap stays {@link INSET} inside them, on both axes: a
 * row reaches almost to the card's edge, and a diagonal through wide, short squares stops where the cap
 * would otherwise poke out above or below.
 */
export function bandBetween(a: Square, b: Square): Segment {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  // A band rather than a hairline: as tall as most of a square across a row or column, narrower along a
  // diagonal so it stays off the neighbouring squares.
  const width = Math.min(a.w, a.h) * (ux !== 0 && uy !== 0 ? BAND_DIAGONAL : BAND);
  const room = (side: number, u: number) => (u ? (side / 2 - width / 2 - INSET) / Math.abs(u) : Infinity);
  const reach = Math.max(0, Math.min(room(a.w, ux), room(a.h, uy)));
  return { x1: a.x - ux * reach, y1: a.y - uy * reach, x2: b.x + ux * reach, y2: b.y + uy * reach, width };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}
