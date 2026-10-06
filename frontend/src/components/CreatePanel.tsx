// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import { isPluginApiError, type PluginContext } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { KEY_TEMPLATE } from '../keys';

/** Grids a podcaster can pick when creating one. Odd sizes get a free centre. */
const SIZES = [3, 4, 5];

/**
 * The way a bingo comes into existence.
 *
 * Until this existed a podcaster had no path at all: the template could only be written through the
 * doc-store API by hand, which is how every screenshot of this plugin got made.
 */
export function CreatePanel({
  ctx,
  i18n,
  onCreated,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  onCreated: () => void;
}) {
  const [size, setSize] = useState(3);
  const [title, setTitle] = useState('');
  // Absent means no: every square is the player's to write unless this bingo says otherwise.
  const [freeCentre, setFreeCentre] = useState(false);
  const [busy, setBusy] = useState(false);

  // An even grid has no middle square, so it cannot have given one away. Disabling the control is not
  // enough on its own: the state behind it survives the switch, and a 4x4 would be created claiming a free
  // centre that does not exist. Derive what is true from the grid rather than trusting the leftover.
  const hasCentre = size % 2 === 1;
  const givesCentreAway = hasCentre && freeCentre;

  const create = async () => {
    setBusy(true);
    try {
      await ctx.docs.put(ctx.scope, KEY_TEMPLATE, {
        size,
        title: title.trim(),
        freeCentre: givesCentreAway,
      });
      onCreated();
    } catch (error) {
      ctx.log(
        'warn',
        `bingo: could not create a bingo (${isPluginApiError(error) ? error.status : String(error)})`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bingo__create">
      <p className="bingo__section-title">{i18n.t('create.title')}</p>
      <div className="bingo__actions">
        <label className="bingo__field">
          {i18n.t('create.size')}
          <select
            className="bingo__select"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}x{n}
              </option>
            ))}
          </select>
        </label>
        <label className="bingo__field">
          {i18n.t('create.name')}
          <input
            className="bingo__input"
            value={title}
            placeholder={i18n.t('episode.title')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button type="button" className="bingo__btn" onClick={create} disabled={busy}>
          {i18n.t('create.button')}
        </button>
      </div>
      <label className="bingo__check">
        <input
          type="checkbox"
          checked={givesCentreAway}
          disabled={!hasCentre}
          onChange={(e) => setFreeCentre(e.target.checked)}
        />
        {i18n.t('create.freeCentre')}
      </label>
      <p className="bingo__note">{i18n.t('create.hint')}</p>
    </div>
  );
}
