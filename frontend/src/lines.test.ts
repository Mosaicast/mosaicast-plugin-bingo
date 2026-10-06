// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { bandBetween } from './components/BingoGrid';
import { completedLines, countLines } from './types';

const grid = (rows: string[]) => rows.join('').split('').map((c) => c === 'x');

describe('completedLines', () => {
  it('finds rows, columns and both diagonals by their end squares', () => {
    const hits = grid(['xxx', 'x.x', 'x.x']);
    expect(completedLines(hits, 3)).toEqual([
      { from: 0, to: 2 }, // top row
      { from: 0, to: 6 }, // left column
      { from: 2, to: 8 }, // right column
    ]);
    expect(completedLines(grid(['x..', '.x.', '..x']), 3)).toEqual([{ from: 0, to: 8 }]);
    expect(completedLines(grid(['..x', '.x.', 'x..']), 3)).toEqual([{ from: 2, to: 6 }]);
  });

  it('is what the line score counts, so the strokes and the number never disagree', () => {
    const hits = grid(['xxxx', 'x..x', 'x..x', 'xxxx']);
    expect(countLines(hits, 4)).toBe(completedLines(hits, 4).length);
    expect(countLines(hits, 4)).toBe(4);
  });

  it('draws nothing for a grid of the wrong size', () => {
    expect(completedLines([true, true], 3)).toEqual([]);
  });
});

describe('bandBetween', () => {
  // A 3x3 of wide, short squares, as on a desktop tile: 180 x 66, 6px gaps.
  const at = (row: number, col: number) => ({ x: 90 + col * 186, y: 33 + row * 72, w: 180, h: 66 });
  const inside = (x: number, y: number, r: number, s: { x: number; y: number; w: number; h: number }) =>
    Math.abs(x - s.x) + r <= s.w / 2 + 1e-9 && Math.abs(y - s.y) + r <= s.h / 2 + 1e-9;

  it('runs a row almost to the card edge', () => {
    const band = bandBetween(at(0, 0), at(0, 2));
    expect(band.y1).toBe(33);
    expect(band.x1).toBeCloseTo(6 + band.width / 2);
    expect(band.x2).toBeCloseTo(186 * 2 + 180 - 6 - band.width / 2);
  });

  it('keeps a diagonal’s round ends inside its corner squares', () => {
    const band = bandBetween(at(0, 0), at(2, 2));
    expect(band.width).toBeLessThan(bandBetween(at(0, 0), at(0, 2)).width);
    expect(inside(band.x1, band.y1, band.width / 2, at(0, 0))).toBe(true);
    expect(inside(band.x2, band.y2, band.width / 2, at(2, 2))).toBe(true);
    expect(band.x1).toBeLessThan(at(0, 0).x);
  });
});
