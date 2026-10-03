// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { normalise } from './fuzzy';
import type { GroupingDoc } from './types';

/**
 * A podcaster's corrections to the automatic grouping, as pins on the `grouping` document.
 *
 * A pin names an entry *as written* — the browser only ever sees written texts, in `candidates.assignments`
 * — and says which group it belongs to: another candidate's canonical form (a merge), or `''` for a group
 * of its own (a split). The backend applies them on its next pass and the tile reads both the pins and the
 * result, so a correction that has not landed yet can say so instead of looking ignored.
 */

/** Every written spelling the backend put in one group, alphabetically. */
export function variantsOf(assignments: Record<string, string>, canonical: string): string[] {
  return Object.keys(assignments)
    .filter((text) => assignments[text] === canonical)
    .sort((a, b) => a.localeCompare(b));
}

/** Pins that move every spelling of one candidate into another. */
export function mergePins(
  assignments: Record<string, string>,
  from: string,
  into: string,
): Record<string, string> {
  return Object.fromEntries(variantsOf(assignments, from).map((text) => [text, into]));
}

/** The pin that gives one spelling a group of its own. */
export function splitPin(text: string): Record<string, string> {
  return { [text]: '' };
}

/**
 * Pins the backend has not applied yet.
 *
 * Judged from the result rather than from timestamps — a browser clock and the server's need not agree. A
 * merge has landed once the entry sits in its target; a split once the entry is its own group, which the
 * backend names after the entry's normalised form. An entry no card carries any more has nothing to wait for.
 */
export function pendingPins(grouping: GroupingDoc | null, assignments: Record<string, string>): string[] {
  const pins = grouping?.pins ?? {};
  return Object.keys(pins).filter((text) => {
    const now = assignments[text];
    if (now === undefined) return false;
    const target = pins[text] === '' ? normalise(text) : pins[text];
    return now !== target;
  });
}
