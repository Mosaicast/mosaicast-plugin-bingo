// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { createPluginI18n, type PluginContext } from '@mosaicast/plugin-sdk';
import en from '../locales/en.json';
import de from '../locales/de.json';

/**
 * Builds this plugin's translator, bound to the host's active locale.
 *
 * The returned translator subscribes to `locale.onChange` for its whole life, so every caller must call
 * `dispose()` from its render cleanup or the subscription outlives the shadow root it was made for.
 */
export function makeI18n(locale: PluginContext['locale']) {
  return createPluginI18n({ en, de }, locale);
}

/** This plugin's translator, as the components take it. */
export type PluginI18n = ReturnType<typeof makeI18n>;
