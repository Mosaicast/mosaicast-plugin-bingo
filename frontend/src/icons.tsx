// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { iconCss } from '@mosaicast/plugin-sdk';

/**
 * The shell's icons, consumed as masks.
 *
 * Three things here fail quietly rather than loudly, which is why this is a file and not an inline style:
 *
 * 1. **A mask, never a `background-image`.** `background: currentColor` behind a mask takes the component's
 *    colour and re-themes with everything else; a background image bakes in whatever colour the icon was
 *    drawn with and ignores light/dark entirely.
 * 2. **Every reference needs a blank-SVG fallback.** An unresolved `var()` makes `mask-image` invalid at
 *    computed-value time, so it reverts to `none` — leaving an *unmasked* box painting `currentColor`,
 *    which renders as a solid square. `iconCss` supplies the fallback and the `-webkit-` prefixes.
 * 3. **Never declare into `--mc-*`.** That prefix belongs to the host.
 *
 * The `--mc-icon-*` family inherits through the shadow boundary, so this needs no `platformApi` bump: an
 * icon core adds lands here the day it ships.
 */
export const ICON_NAMES = [
  'board',
  'check',
  'clock',
  'dice',
  'lock',
  'trophy',
  'warning',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** Kebab-case, or the SDK throws at runtime — inside render, where it is most expensive to discover. */
const ICON_CLASS = 'bingo-icon';

export const ICON_CSS = iconCss(ICON_NAMES, { className: ICON_CLASS });

export function Icon({ name }: { name: IconName }) {
  return <span className={`${ICON_CLASS} ${ICON_CLASS}-${name}`} aria-hidden="true" />;
}
