// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useRef, useState } from 'react';
import { isPluginApiError, type PluginContext, type UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { KEY_SHOWCASE } from '../keys';
import { nameOf } from './EpisodeBingo';

/**
 * Choosing whose cards get the prominent tabs.
 *
 * The list is ids the backend published, resolved to people here: no browser can read another person's
 * card, so neither the candidates nor their names could be worked out locally. Only people who allow
 * being featured appear at all, and the backend checks that again on every tick — a pick made before
 * somebody changed their mind stops publishing them on its own.
 */
export function FeatureModal({
  ctx,
  i18n,
  participants,
  people,
  picked,
  onClose,
  onDone,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  participants: string[];
  people: Record<string, UserRef>;
  picked: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState<string[]>(picked);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog?.open) dialog?.showModal();
    const close = () => onClose();
    dialog?.addEventListener('close', close);
    return () => dialog?.removeEventListener('close', close);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    try {
      await ctx.docs.put(ctx.scope, KEY_SHOWCASE, { userIds: chosen });
      onDone();
      ref.current?.close();
    } catch (error) {
      setBusy(false);
      ctx.log(
        'warn',
        `bingo: could not save the featured cards (${
          isPluginApiError(error) ? error.status : String(error)
        })`,
      );
    }
  };

  return (
    <dialog className="bingo__modal" ref={ref}>
      <div className="bingo">
        <div className="bingo__head">
          <h3 className="bingo__title">
            <Icon name="board" /> {i18n.t('showcase.title')}
          </h3>
        </div>
        <p className="bingo__hint">{i18n.t('showcase.hint')}</p>

        {participants.length === 0 ? (
          <p className="bingo__note">{i18n.t('showcase.empty')}</p>
        ) : (
          <div className="bingo__board">
            {participants.map((userId) => {
              const person = people[userId];
              const on = chosen.includes(userId);
              return (
                <button
                  key={userId}
                  type="button"
                  className="bingo__tick"
                  aria-pressed={on}
                  onClick={() =>
                    setChosen((c) => (on ? c.filter((id) => id !== userId) : [...c, userId]))
                  }
                >
                  <Icon name={on ? 'check' : 'board'} />
                  {person && (
                    <img className="bingo__avatar" src={person.avatarUrl} alt="" width={20} height={20} />
                  )}
                  <span>{nameOf(person, i18n)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="bingo__actions">
          <button type="button" className="bingo__btn" onClick={save} disabled={busy}>
            {i18n.t('showcase.save')}
          </button>
          <button
            type="button"
            className="bingo__btn bingo__btn--quiet"
            onClick={() => ref.current?.close()}
            disabled={busy}
          >
            {i18n.t('resolve.cancel')}
          </button>
        </div>
      </div>
    </dialog>
  );
}
