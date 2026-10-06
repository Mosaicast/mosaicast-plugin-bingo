// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import vectors from '../../shared/fuzzy-vectors.json';
import { cardIssues, normalise, similarity } from './fuzzy';

/** The same file `BingoFuzzyTest.java` reads: one answer key for both halves. */
const VECTORS = vectors as { normalise: [string, string][]; similarity: [string, string, number][] };

describe('fuzzy, against the shared vectors', () => {
  it.each(VECTORS.normalise)('normalises %j to %j', (raw, expected) => {
    expect(normalise(raw)).toBe(expected);
  });

  it.each(VECTORS.similarity)('rates %j against %j at %d', (a, b, expected) => {
    expect(similarity(a, b)).toBeCloseTo(expected, 12);
  });
});

describe('cardIssues', () => {
  it('flags the same prediction written twice', () => {
    expect(cardIssues(['Kraken!', 'merch', 'kraken'], 0.82)).toEqual([{ index: 2, other: 0, kind: 'duplicate' }]);
  });

  it('flags two squares the backend will most likely group as one', () => {
    expect(cardIssues(['Alex says damn it', 'alex says damn'], 0.82)).toEqual([
      { index: 1, other: 0, kind: 'similar' },
    ]);
  });

  it('reports a repeat even when a merely similar square comes first', () => {
    expect(cardIssues(['Espresso machin', 'Espresso machine', 'espresso machine'], 0.82)).toEqual([
      { index: 1, other: 0, kind: 'similar' },
      { index: 2, other: 1, kind: 'duplicate' },
    ]);
  });

  it('leaves different numbers and blank squares alone', () => {
    expect(cardIssues(['3 sponsor reads', '5 sponsor reads', '', ''], 0.82)).toEqual([]);
  });

  it('follows the published threshold', () => {
    expect(cardIssues(['kraken', 'krakken'], 0.9)).toEqual([]);
    expect(cardIssues(['kraken', 'krakken'], 0.8)).toHaveLength(1);
  });
});
