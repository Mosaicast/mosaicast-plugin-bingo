// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { PluginContext } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';

/** This plugin's id, which names its page subtree: `/p/bingo/…`. Fixed by `plugin.json`. */
export const PLUGIN_ID = 'bingo';

/**
 * The absolute address of one of this plugin's pages, for sharing outside the site.
 *
 * `ctx.route.navigate` moves within the subtree but hands back no URL, and a link pasted into a chat needs
 * the origin. The host serves those pages with OpenGraph tags from the backend's `metaFor`, so the preview
 * says what the link is.
 */
export function pageUrl(subpath: string): string {
  return `${window.location.origin}/p/${PLUGIN_ID}/${subpath}`;
}

/**
 * Shares a link: the device's own share sheet where there is one, the clipboard otherwise.
 *
 * What is shared is chosen by the caller and is always a page the backend answers for — a player's own
 * result only when the published board carries it, the bingo itself otherwise.
 */
export function ShareButton({
  ctx,
  i18n,
  subpath,
  title,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  subpath: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = pageUrl(subpath);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (error) {
      // Dismissing the share sheet rejects too; only a real failure is worth a line in the log.
      if ((error as { name?: string })?.name !== 'AbortError') {
        ctx.log('warn', `bingo: could not share (${String(error)})`);
      }
    }
  };

  return (
    <span className="bingo__share">
      <button type="button" className="bingo__btn bingo__btn--quiet" onClick={share}>
        {i18n.t('share.button')}
      </button>
      {copied && <span className="bingo__note" role="status">{i18n.t('share.copied')}</span>}
    </span>
  );
}
