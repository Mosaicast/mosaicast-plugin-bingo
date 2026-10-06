// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { PluginContext, UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { BINGO_CSS } from './styles';

/** Wraps content in the plugin's own stylesheet; the host cannot style inside a shadow root for us. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{BINGO_CSS}</style>
      <div className="bingo bingo--tile">{children}</div>
    </>
  );
}

/** The signed-in reader as the directory would describe them. */
export function toRef(user: NonNullable<PluginContext['user']>): UserRef {
  return { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, role: user.role };
}

/** What to call somebody the directory could not answer for. */
export function nameOf(person: UserRef | undefined, i18n: PluginI18n): string {
  return person?.displayName ?? i18n.t('leaderboard.formerListener');
}
