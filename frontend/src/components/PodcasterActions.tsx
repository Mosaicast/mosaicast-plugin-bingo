// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginI18n } from '../i18n';
import type { Phase } from '../types';

/**
 * The podcaster's one action, whatever the phase calls for.
 *
 * One button rather than a row of lifecycle controls: there is only ever one obvious next thing, and the
 * rest belongs behind it.
 */
export function PodcasterActions({
  i18n,
  phase,
  awaiting,
  pending,
  onOpen,
  onMove,
}: {
  i18n: PluginI18n;
  phase: Phase;
  /** A lifecycle change already asked for and not yet applied. Blocks asking again. */
  awaiting: Phase | null;
  pending: number;
  onOpen: (mode: 'resolve' | 'catchup' | 'feature') => void;
  onMove: (to: Phase) => void;
}) {
  return (
    <div className="bingo__actions">
      {phase === 'OPEN' && (
        <button
          type="button"
          className="bingo__btn bingo__btn--quiet"
          disabled={awaiting !== null}
          onClick={() => onMove('LOCKED')}
        >
          {awaiting === 'LOCKED' ? i18n.t('board.locking') : i18n.t('board.lock')}
        </button>
      )}
      {(phase === 'OPEN' || phase === 'LOCKED') && (
        <button type="button" className="bingo__btn" onClick={() => onOpen('resolve')}>
          {i18n.t('resolve.open')}
        </button>
      )}
      {phase === 'LOCKED' && (
        <button
          type="button"
          className="bingo__btn bingo__btn--quiet"
          disabled={awaiting !== null}
          onClick={() => onMove('OPEN')}
        >
          {awaiting === 'OPEN' ? i18n.t('board.reopening') : i18n.t('board.reopen')}
        </button>
      )}
      {phase === 'RESOLVED' && pending > 0 && (
        <button type="button" className="bingo__btn" onClick={() => onOpen('catchup')}>
          {i18n.t('resolve.catchup', { count: String(pending) })}
        </button>
      )}
      {phase !== 'ARCHIVED' && (
        <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => onOpen('feature')}>
          {i18n.t('showcase.open')}
        </button>
      )}
      {phase === 'RESOLVED' && (
        <button
          type="button"
          className="bingo__btn bingo__btn--quiet"
          disabled={awaiting !== null}
          onClick={() => onMove('ARCHIVED')}
        >
          {awaiting === 'ARCHIVED' ? i18n.t('board.archiving') : i18n.t('board.archive')}
        </button>
      )}
    </div>
  );
}
