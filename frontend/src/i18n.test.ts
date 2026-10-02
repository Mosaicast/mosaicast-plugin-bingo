// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import de from '../locales/de.json';

const EN = en as Record<string, string>;
const DE = de as Record<string, string>;

/** `{{placeholder}}` names used by one string, so two locales can be compared on substance. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

describe('locales', () => {
  it('translates exactly the same keys', () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort());
  });

  it('uses the same placeholders in both languages', () => {
    // A translation that drops a placeholder renders a sentence with a hole in it, and only in that
    // language — which is precisely the bug nobody is looking at when they ship.
    for (const key of Object.keys(EN)) {
      expect(placeholders(DE[key]), key).toEqual(placeholders(EN[key]));
    }
  });

  it('keeps decoration out of the copy', () => {
    // Marks belong in CSS, as a `--mc-icon-*` mask, where they re-theme with everything else.
    for (const [key, value] of Object.entries({ ...EN, ...DE })) {
      expect(value, key).not.toMatch(/[←-⇿☀-➿️\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it('has no blank strings', () => {
    for (const [key, value] of Object.entries({ ...EN, ...DE })) {
      expect(value.trim(), key).not.toBe('');
    }
  });
});
