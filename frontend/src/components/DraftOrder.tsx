// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { moveItem } from '../draft';
import { nameOf } from './common';

/**
 * The players in turn order. The host drags a name to a new place, or uses the arrows, which also work by
 * keyboard and on a phone, where dragging in a list is no fun. Everyone else sees the same list, read-only.
 */
export function DraftOrder({
  i18n,
  ids,
  people,
  online,
  host,
  onChange,
}: {
  i18n: PluginI18n;
  ids: string[];
  people: Record<string, UserRef>;
  online: string[];
  host: string;
  /** Present for the host only. */
  onChange?: (next: string[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  return (
    <ol className="bingo__order">
      {ids.map((id, index) => {
        const name = nameOf(people[id], i18n);
        const here = online.includes(id);
        return (
          <li
            key={id}
            className={[
              'bingo__order-item',
              dragging === index ? 'bingo__order-item--dragging' : '',
              over === index && dragging !== index ? 'bingo__order-item--over' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            draggable={Boolean(onChange)}
            onDragStart={(e) => {
              setDragging(index);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              setOver(index);
            }}
            onDragLeave={() => setOver((o) => (o === index ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null && dragging !== index) onChange?.(moveItem(ids, dragging, index));
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            <span className="bingo__place">{index + 1}</span>
            <span className={here ? 'bingo__dot bingo__dot--on' : 'bingo__dot'}
              title={here ? i18n.t('draft.online') : i18n.t('draft.away')} aria-hidden="true" />
            <span className="bingo__order-name">
              {name}
              {id === host && <span className="bingo__note"> · {i18n.t('draft.hostLabel')}</span>}
              <span className="bingo__sr">{here ? i18n.t('draft.online') : i18n.t('draft.away')}</span>
            </span>
            {onChange && (
              <span className="bingo__order-moves">
                <button
                  type="button"
                  className="bingo__btn bingo__btn--quiet bingo__btn--small"
                  aria-label={i18n.t('draft.lobby.up', { name })}
                  disabled={index === 0}
                  onClick={() => onChange(moveItem(ids, index, index - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="bingo__btn bingo__btn--quiet bingo__btn--small"
                  aria-label={i18n.t('draft.lobby.down', { name })}
                  disabled={index === ids.length - 1}
                  onClick={() => onChange(moveItem(ids, index, index + 1))}
                >
                  ↓
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
