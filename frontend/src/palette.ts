// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import type { ThemeTokens } from '@mosaicast/plugin-sdk';

/**
 * Player colours for the history charts: the same fixed categorical order `mosaicast-plugin-stats` uses,
 * so the two plugins read as one site. Validated with the dataviz palette checks against this shell's own
 * surfaces (light `#fffcf9`, dark `#201917`): lightness band, chroma floor, colour-blind separation and
 * normal-vision floor all pass. Three light slots sit below 3:1 against the surface, which is why every
 * chart here also has a legend, direct labels or a table view — nobody is identified by colour alone.
 *
 * A player keeps their slot everywhere: it is their place in the published history (best cumulative score
 * first), never their place in whatever the filters currently show.
 */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** Grey for everyone past the eighth slot. */
export const OTHER = '#8a877f';

/** Whether the host's background is dark, from the theme tokens the SDK hands over. */
export function isDark(theme: ThemeTokens | undefined): boolean {
  const hex = theme?.bg?.trim();
  const m = hex && /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum < 0.25;
}

export function seriesColor(slot: number, dark: boolean): string {
  const list = dark ? SERIES_DARK : SERIES_LIGHT;
  return slot >= 0 && slot < list.length ? list[slot] : OTHER;
}
