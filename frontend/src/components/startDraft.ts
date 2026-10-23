// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { isActionRejected, type PluginContext } from '@mosaicast/plugin-sdk';
import { PLUGIN_ID } from './ShareButton';

/**
 * Opens a new draft round on the tile's episode and goes to its page, where the podcaster sets it up.
 *
 * A full page load, not `ctx.route.navigate`: that only moves within the plugin's own page, and the tile
 * lives on the episode's.
 *
 * @returns the rejection code when the backend refused, `generic` for anything else, `null` on the way out
 */
export async function startDraft(ctx: PluginContext): Promise<string | null> {
  if (!ctx.actions) return 'generic';
  try {
    const answer = await ctx.actions.call<{ id: string }>('draft-create', {}, { scope: ctx.scope });
    if (!answer?.id) return 'generic';
    window.location.assign(`/p/${PLUGIN_ID}/draft/${answer.id}`);
    return null;
  } catch (error) {
    if (isActionRejected(error)) return error.problem.code;
    ctx.log('warn', `bingo: could not start a draft round (${String(error)})`);
    return 'generic';
  }
}
