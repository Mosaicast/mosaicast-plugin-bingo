// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import type { DisplaySnapshot, PluginContext } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import { Icon } from '../icons';
import { feedName } from '../history';
import type { BingoSummary, History } from '../types';

/** How many bingos the list holds before it offers a search. */
export const SEARCH_FROM = 20;

/** One bingo as the list draws it. */
interface Item {
  slug: string;
  title: string;
  /** "S1E5", "E5" or nothing. */
  code: string;
  phase: BingoSummary['phase'];
  players: number | null;
  /** The share of its predictions that came true, once it is resolved. */
  hitRate: number | null;
  /** `<feed>:<season>`, or `null` for an episode without a season. */
  seasonKey: string | null;
  season: number | null;
  feed: string | null;
  /** For newest-first order: the release date, else the episode number. */
  order: number;
}

/**
 * Every bingo on the site, built for a long list: the open ones first, as cards — they are what most visitors
 * come for — then the past ones by season, newest season open and older ones folded away. Past
 * {@link SEARCH_FROM} bingos a search narrows the list by title or episode code.
 *
 * Only bingos whose episode the visitor may see are passed in; a quiet episode is never drawn.
 */
export function BingoList({
  ctx,
  i18n,
  bingos,
  snapshots,
  history,
  season,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  bingos: BingoSummary[];
  snapshots: Record<string, DisplaySnapshot>;
  history: History | null;
  /** The page's season, as a `<feed>:<season>` key; `null` for every season. */
  season: string | null;
}) {
  const [query, setQuery] = useState('');
  const rates = new Map((history?.episodes ?? []).map((e) => [e.slug, e.candidates > 0 ? e.hitRate : null]));
  const items = bingos
    .map((b) => itemOf(b, snapshots[b.slug], rates.get(b.slug) ?? null))
    .filter((it) => season === null || it.seasonKey === season)
    .sort((a, b) => b.order - a.order || a.title.localeCompare(b.title));

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  const matches = (it: Item) => !searching || `${it.code} ${it.title}`.toLowerCase().includes(needle);
  const open = items.filter((it) => (it.phase === 'OPEN' || it.phase === 'LOCKED') && matches(it));
  const past = items.filter((it) => it.phase !== 'OPEN' && it.phase !== 'LOCKED' && matches(it));

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const go = (event: React.MouseEvent, path: string) => {
    event.preventDefault();
    ctx.route.navigate(path);
  };
  const pageOf = (slug: string) => `e/${encodeURIComponent(slug)}`;

  const row = (it: Item) => (
    <li key={it.slug} className="bingo__item">
      <a className="bingo__item-link" href={`/p/bingo/${pageOf(it.slug)}`} onClick={(e) => go(e, pageOf(it.slug))}>
        {it.code && <span className="bingo__code">{it.code}</span>}
        <span className="bingo__item-title">{it.title}</span>
      </a>
      <span className="bingo__item-meta">
        {i18n.t(`phase.${it.phase.toLowerCase()}`)}
        {it.players !== null && ` · ${i18n.t('stats.cards', { count: String(it.players) })}`}
        {it.hitRate !== null && ` · ${i18n.t('list.cameTrue', { rate: pct(it.hitRate) })}`}
      </span>
    </li>
  );

  // Past bingos by season, newest season first; with a season chosen, or a search running, one flat list.
  // "Season 1" names the feed too once two feeds are on the list, or there would be two of them.
  const feeds = new Set(items.map((it) => it.feed));
  const seasonLabel = (it: Item) =>
    it.season === null
      ? i18n.t('list.noSeason')
      : feeds.size > 1 && it.feed
        ? i18n.t('history.seasonNFeed', { season: String(it.season), feed: feedName(it.feed) })
        : i18n.t('history.seasonN', { season: String(it.season) });
  const groups: { key: string; label: string; items: Item[] }[] = [];
  if (season === null && !searching) {
    for (const it of past) {
      const key = it.seasonKey ?? '';
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, label: seasonLabel(it), items: [] };
        groups.push(g);
      }
      g.items.push(it);
    }
  }

  return (
    <section className="bingo__bingos" aria-label={i18n.t('page.bingos')}>
      <p className="bingo__section-title">
        <Icon name="board" /> {i18n.t('page.bingos')}
      </p>
      {items.length === 0 && <p className="bingo__note">{i18n.t('page.noBingos')}</p>}

      {items.length > SEARCH_FROM && (
        <label className="bingo__search">
          <Icon name="search" />
          <input
            className="bingo__input"
            type="search"
            value={query}
            placeholder={i18n.t('list.search')}
            aria-label={i18n.t('list.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {searching && open.length + past.length === 0 && <p className="bingo__note">{i18n.t('list.noMatch')}</p>}

      {open.length > 0 && (
        <>
          <h3 className="bingo__chart-title">{i18n.t('list.openNow')}</h3>
          <ul className="bingo__open">
            {open.map((it) => {
              const playable = it.phase === 'OPEN';
              return (
                <li key={it.slug} className="bingo__open-card">
                  <span className="bingo__open-top">
                    {it.code && <span className="bingo__code">{it.code}</span>}
                    <span className={playable ? 'bingo__chip-state bingo__chip-state--open' : 'bingo__chip-state'}>
                      <Icon name={playable ? 'dice' : 'lock'} /> {i18n.t(playable ? 'list.open' : 'list.locked')}
                    </span>
                  </span>
                  <span className="bingo__item-title">{it.title}</span>
                  <span className="bingo__item-meta">
                    {it.players !== null ? i18n.t('stats.cards', { count: String(it.players) }) : ' '}
                    {!playable && ` · ${i18n.t('list.waiting')}`}
                  </span>
                  {playable ? (
                    <a className="bingo__btn" href={ctx.links.episode(it.slug)}>{i18n.t('page.play')}</a>
                  ) : (
                    <a className="bingo__btn bingo__btn--quiet" href={`/p/bingo/${pageOf(it.slug)}`}
                      onClick={(e) => go(e, pageOf(it.slug))}>
                      {i18n.t('list.view')}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {past.length > 0 && groups.length === 0 && (
        <>
          {open.length > 0 && <h3 className="bingo__chart-title">{i18n.t('list.past')}</h3>}
          <ul className="bingo__items">{past.map(row)}</ul>
        </>
      )}
      {groups.length > 0 && (
        <>
          {open.length > 0 && <h3 className="bingo__chart-title">{i18n.t('list.past')}</h3>}
          {groups.map((g, i) => {
            const rated = g.items.filter((it) => it.hitRate !== null);
            const avg = rated.length ? rated.reduce((n, it) => n + it.hitRate!, 0) / rated.length : null;
            return (
              <details key={g.key} className="bingo__group" open={i === 0}>
                <summary className="bingo__group-summary">
                  <span className="bingo__group-title">{g.label}</span>
                  <span className="bingo__item-meta">
                    {i18n.t('list.count', { count: String(g.items.length) })}
                    {avg !== null && ` · ${i18n.t('list.cameTrue', { rate: pct(avg) })}`}
                  </span>
                </summary>
                <ul className="bingo__items">{g.items.map(row)}</ul>
              </details>
            );
          })}
        </>
      )}
    </section>
  );
}

function itemOf(b: BingoSummary, snap: DisplaySnapshot | undefined, hitRate: number | null): Item {
  const season = snap?.season ?? b.season ?? null;
  const episodeNo = snap?.episodeNo ?? null;
  const code = season != null && episodeNo != null ? `S${season}E${episodeNo}` : episodeNo != null ? `E${episodeNo}` : '';
  const released = snap?.publishedAt ? Date.parse(snap.publishedAt) : NaN;
  return {
    slug: b.slug,
    title: snap?.title || b.title || b.slug,
    code,
    phase: b.phase,
    players: typeof b.players === 'number' ? b.players : null,
    hitRate,
    seasonKey: season != null ? `${snap?.feed ?? b.feed ?? ''}:${season}` : null,
    season,
    feed: snap?.feed ?? b.feed ?? null,
    order: Number.isFinite(released) ? released : (season ?? 0) * 10_000 + (episodeNo ?? 0),
  };
}
