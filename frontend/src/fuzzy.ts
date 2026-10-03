// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The browser's copy of the backend's comparison rules (`BingoFuzzy.java`), for advice only.
 *
 * Grouping stays the backend's job and the tile still reads every decision from `candidates.assignments`:
 * two implementations of "are these the same thing" would eventually disagree about a real card. What this
 * copy is for is telling a player, while they type, that two of their own squares will count as one — a
 * question with no backend round trip to wait for, and one where a rare disagreement costs a hint, not a
 * score.
 *
 * It mirrors the Java character for character, UTF-16 code units included, and `shared/fuzzy-vectors.json`
 * pins both halves to the same answers: the Java and the TypeScript tests read the same file.
 */

const LETTER_OR_DIGIT = /^[\p{L}\p{Nd}]$/u;
const DIGIT = /^\p{Nd}$/u;

/**
 * Reduces an entry to its comparison form: accents folded, case dropped, punctuation removed, whitespace
 * collapsed. `BingoFuzzy.normalise`.
 */
export function normalise(raw: string | null | undefined): string {
  if (raw == null) return '';
  const folded = raw.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ß/g, 'ss');
  let out = '';
  // By code unit, as Java's `charAt` walks it: a lone surrogate is neither a letter nor a digit there.
  for (let i = 0; i < folded.length; i++) {
    const c = folded[i];
    if (LETTER_OR_DIGIT.test(c)) {
      out += c;
    } else if (out.length > 0 && out[out.length - 1] !== ' ') {
      out += ' ';
    }
  }
  return out.trim();
}

/**
 * `1 - editDistance / longerLength` over two normalised strings, except that entries disagreeing about a
 * number are never the same thing. `BingoFuzzy.similarity`.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const digitsA = digitsOf(a);
  const digitsB = digitsOf(b);
  if (digitsA !== '' && digitsB !== '' && digitsA !== digitsB) return 0;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  return 1 - levenshtein(a, b) / longer;
}

function digitsOf(text: string): string {
  let out = '';
  let inRun = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (DIGIT.test(c)) {
      out += c;
      inRun = true;
    } else if (inRun) {
      out += '.';
      inRun = false;
    }
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** One thing worth telling a player about their own card, before they save it. */
export interface CardIssue {
  /** The square (entry index) the issue is shown on — always the later of the two. */
  index: number;
  /** The earlier square it collides with. */
  other: number;
  /**
   * `duplicate` — the same prediction, spelled the same once normalised: it would score twice off one
   * event. `similar` — close enough that the backend will most likely group the two as one thing.
   */
  kind: 'duplicate' | 'similar';
}

/**
 * Collisions between a card's own squares, computed entirely here — no request, nothing for the backend to
 * do while somebody types.
 *
 * @param entries   the card as written, one string per fillable square
 * @param threshold the site's `fuzzyThreshold`, as the backend publishes it on the `phase` document
 */
export function cardIssues(entries: readonly string[], threshold: number): CardIssue[] {
  const forms = entries.map(normalise);
  const issues: CardIssue[] = [];
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '') continue;
    // A repeat anywhere earlier outranks a near miss: only the repeat blocks saving, so it must not be
    // hidden behind a merely similar square that happens to come first.
    const repeat = forms.findIndex((form, j) => j < i && form === forms[i]);
    if (repeat !== -1) {
      issues.push({ index: i, other: repeat, kind: 'duplicate' });
      continue;
    }
    const close = forms.findIndex((form, j) => j < i && form !== '' && similarity(form, forms[i]) >= threshold);
    if (close !== -1) issues.push({ index: i, other: close, kind: 'similar' });
  }
  return issues;
}
