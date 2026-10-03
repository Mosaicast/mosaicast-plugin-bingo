// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { CardIssue } from '../fuzzy';
import type { PluginI18n } from '../i18n';

/**
 * What the card editor has to say about a card's own squares, before it is saved.
 *
 * Worked out in the browser as the player types (see `fuzzy.ts`): nothing here waits for, or costs, a
 * request. A square repeated word for word blocks saving, since one event would tick both off; a square
 * merely close to another is a hint, because only the backend's grouping is binding.
 */
export function CardChecks({ issues, i18n }: { issues: CardIssue[]; i18n: PluginI18n }) {
  if (issues.length === 0) return null;
  return (
    <ul className="bingo__checks" aria-live="polite">
      {issues.map((issue) => (
        <li key={issue.index} className={issue.kind === 'duplicate' ? 'bingo__warn' : 'bingo__note'}>
          {i18n.t(issue.kind === 'duplicate' ? 'checks.duplicate' : 'checks.similar', {
            square: String(issue.index + 1),
            other: String(issue.other + 1),
          })}
        </li>
      ))}
    </ul>
  );
}

/** Whether these issues stop a card from being saved. */
export function blocksSaving(issues: CardIssue[]): boolean {
  return issues.some((issue) => issue.kind === 'duplicate');
}
