// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DisplaySnapshot, PluginContext, UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { CHANNEL_INBOX } from '../keys';
import type { DraftInboxItem } from '../types';
import { nameOf } from './common';
import { resolvePeople } from './useBingo';
import { SITE } from './useDraftRound';

/**
 * The reader's draft rounds: ones they run, play in, or are invited to.
 *
 * `compact` is the box on the bingo page, and draws nothing at all without a round: a fan who has never been
 * invited to one sees no trace of the feature. The list stays live through the `inbox` channel, which is
 * how an invite shows up while the page is open.
 */
export function DraftList({ ctx, i18n, compact = false }: { ctx: PluginContext; i18n: PluginI18n; compact?: boolean }) {
  const [items, setItems] = useState<DraftInboxItem[] | null>(null);
  const [people, setPeople] = useState<Record<string, UserRef>>({});
  const [titles, setTitles] = useState<Record<string, DisplaySnapshot>>({});
  const latest = useRef(ctx);
  latest.current = ctx;
  const signedIn = Boolean(ctx.user);

  const load = useCallback(async () => {
    const c = latest.current;
    if (!c.actions) return;
    try {
      const answer = await c.actions.call<{ items: DraftInboxItem[] }>('draft-inbox', null, { scope: SITE });
      const next = answer?.items ?? [];
      const slugs = [...new Set(next.map((i) => i.episode).filter((s): s is string => Boolean(s)))];
      const [who, snapshots] = await Promise.all([
        resolvePeople(c, [...new Set(next.map((i) => i.host))]),
        slugs.length > 0 ? c.feeds.displayMany(slugs).catch(() => ({})) : Promise.resolve({}),
      ]);
      setPeople(who);
      setTitles(snapshots);
      setItems(next);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    const { actions, channels } = latest.current;
    if (!signedIn || !actions || !channels) {
      setItems([]);
      return;
    }
    const sub = channels.subscribe(CHANNEL_INBOX, () => void load(), { scope: SITE, onReset: () => void load() });
    void load();
    return () => sub.close();
  }, [signedIn, load]);

  if (compact && (!items || items.length === 0)) return null;

  const go = (event: React.MouseEvent, path: string) => {
    event.preventDefault();
    ctx.route.navigate(path);
  };

  const list = (
    <ul className="bingo__items">
      {(items ?? []).map((item) => {
        const title = item.episode ? titles[item.episode]?.title : undefined;
        const role =
          item.role === 'invited'
            ? i18n.t('draft.list.invited', { name: nameOf(people[item.host], i18n) })
            : i18n.t(`draft.list.${item.role}`);
        return (
          <li key={item.id} className="bingo__item">
            <a className="bingo__item-link" href={`/p/bingo/draft/${item.id}`} onClick={(e) => go(e, `draft/${item.id}`)}>
              {title ? i18n.t('draft.episode', { title }) : i18n.t('draft.quietEpisode')}
            </a>
            <span className="bingo__item-meta">
              {item.yourTurn && <strong className="bingo__chip-state bingo__chip-state--open">{i18n.t('draft.list.yourTurn')}</strong>}{' '}
              {i18n.t(`draft.list.${item.status}`)} · {role} · {i18n.t('draft.list.players', { count: String(item.players) })}
            </span>
          </li>
        );
      })}
    </ul>
  );

  if (compact) {
    return (
      <div className="bingo__panel bingo__drafts">
        <p className="bingo__section-title">
          <Icon name="dice" /> {i18n.t('draft.list.title')}
        </p>
        {list}
        <a className="bingo__link" href="/p/bingo/draft" onClick={(e) => go(e, 'draft')}>
          {i18n.t('draft.list.all')}
        </a>
      </div>
    );
  }

  return (
    <>
      <header className="bingo__page-head">
        <h1 className="bingo__page-title">
          <Icon name="dice" /> {i18n.t('draft.list.title')}
        </h1>
        <p className="bingo__hint">{i18n.t('draft.hint')}</p>
      </header>
      <div className="bingo__panel">
        {!signedIn ? (
          <p className="bingo__note">{i18n.t('draft.signIn')}</p>
        ) : !ctx.actions ? (
          <p className="bingo__note">{i18n.t('draft.unavailable')}</p>
        ) : items === null ? (
          <p className="bingo__note">{i18n.t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="bingo__note">{i18n.t('draft.list.empty')}</p>
        ) : (
          list
        )}
        <p>
          <a className="bingo__link" href="/p/bingo/" onClick={(e) => go(e, '')}>{i18n.t('page.back')}</a>
        </p>
      </div>
    </>
  );
}
