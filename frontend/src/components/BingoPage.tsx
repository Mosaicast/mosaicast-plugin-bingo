// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useMemo, useState } from 'react';
import { matchRoute, type DisplaySnapshot, type PluginContext, type UserRef } from '@mosaicast/plugin-sdk';
import { makeI18n, type PluginI18n } from '../i18n';
import { Icon } from '../icons';
import {
  KEY_HISTORY,
  KEY_IMPORTS,
  KEY_LEADERBOARD,
  KEY_PHASE,
  KEY_RECAP,
  KEY_STATS,
  KEY_SUGGESTIONS,
  KEY_TEMPLATE,
} from '../keys';
import {
  gridSize,
  lineCount,
  type Leaderboard,
  type Phase,
  type PhaseState,
  type RankBy,
  type Recap,
  type History,
  type Imports,
  type Stats,
  type Suggestions,
  type Template,
} from '../types';
import { Shell, nameOf } from './common';
import { ClaimBox } from './ClaimBox';
import { EpisodeScores, HistoryPanel } from './HistoryPanel';
import { RecapPanel } from './RecapPanel';
import { Results } from './Results';
import { ShareButton } from './ShareButton';
import { readScope, pick, resolvePeople } from './useBingo';

const ROUTES = ['', 'e/:slug', 'e/:slug/u/:user'] as const;

/** How many places of the site standings the page draws. The document carries up to fifty. */
const STANDINGS_SHOWN = 10;

/**
 * The plugin's own page, `/p/bingo/…`: the site's standings and every bingo there is, one bingo's
 * results, and a player's shared result.
 *
 * Everything here is read from documents the backend publishes for exactly this — the `stats` roll-up and
 * each episode's board and recap — so a visitor's browser never needs anybody's card. A quiet episode is
 * not in the list and its address is a 404 (`PageRouteProvider`); `ctx.feeds` hides it from the browser
 * as well, so a title is never drawn for it either.
 */
export function BingoPage({ ctx }: { ctx: PluginContext }) {
  const i18n = useMemo(() => makeI18n(ctx.locale), [ctx.locale]);
  useEffect(() => () => i18n.dispose(), [i18n]);

  const match = matchRoute(ctx.route.path, ROUTES);
  return (
    <Shell>
      {match?.pattern === '' && <SiteView ctx={ctx} i18n={i18n} />}
      {(match?.pattern === 'e/:slug' || match?.pattern === 'e/:slug/u/:user') && (
        <EpisodeView ctx={ctx} i18n={i18n} slug={match.params.slug} featured={match.params.user} />
      )}
      {!match && <p className="bingo__note">{i18n.t('page.notFound')}</p>}
    </Shell>
  );
}

/** The site page: who has done best across every bingo, and the bingos themselves. */
function SiteView({ ctx, i18n }: { ctx: PluginContext; i18n: PluginI18n }) {
  const [state, setState] = useState<{
    loading: boolean;
    stats: Stats | null;
    history: History | null;
    suggestions: Suggestions | null;
    imports: Imports | null;
    titles: Record<string, DisplaySnapshot>;
    people: Record<string, UserRef>;
  }>({ loading: true, stats: null, history: null, suggestions: null, imports: null, titles: {}, people: {} });

  useEffect(() => {
    let live = true;
    (async () => {
      // Every site-wide document the page draws, in one request.
      const site = await readScope(ctx, { type: 'site', id: 'main' }, [KEY_STATS, KEY_HISTORY, KEY_SUGGESTIONS, KEY_IMPORTS]);
      const stats = pick<Stats>(site, KEY_STATS);
      const history = pick<History>(site, KEY_HISTORY);
      const slugs = [
        ...new Set([...(stats?.bingos ?? []).map((b) => b.slug), ...(history?.episodes ?? []).map((e) => e.slug)]),
      ];
      const records = history?.records;
      const [titles, people] = await Promise.all([
        slugs.length > 0 ? ctx.feeds.displayMany(slugs).catch(() => ({})) : Promise.resolve({}),
        resolvePeople(ctx, [
          ...(stats?.players ?? []).slice(0, STANDINGS_SHOWN).map((p) => p.author),
          ...(history?.players ?? []).map((p) => p.author),
          ...[records?.bestCard, records?.mostCards, records?.longestStreak].flatMap((r) => (r ? [r.author] : [])),
        ]),
      ]);
      if (live) {
        setState({
          loading: false,
          stats,
          history,
          suggestions: pick<Suggestions>(site, KEY_SUGGESTIONS),
          imports: pick<Imports>(site, KEY_IMPORTS),
          titles,
          people,
        });
      }
    })().catch(() => {
      if (live) {
        setState({ loading: false, stats: null, history: null, suggestions: null, imports: null, titles: {}, people: {} });
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per visit to the page
  }, []);

  if (state.loading) return <p className="bingo__note">{i18n.t('common.loading')}</p>;

  const standings = (state.stats?.players ?? []).slice(0, STANDINGS_SHOWN);
  // A bingo whose episode the visitor may not see has no snapshot, and is not drawn at all.
  const bingos = (state.stats?.bingos ?? []).filter((b) => state.titles[b.slug]);

  return (
    <>
      <div className="bingo__head">
        <h2 className="bingo__title">
          <Icon name="dice" /> {i18n.t('page.title')}
        </h2>
      </div>
      <p className="bingo__hint">{i18n.t('page.hint')}</p>

      <p className="bingo__section-title">
        <Icon name="trophy" /> {i18n.t('stats.title')}
      </p>
      {standings.length === 0 ? (
        <p className="bingo__note">{i18n.t('stats.empty')}</p>
      ) : (
        <ol className="bingo__rows">
          {standings.map((row, i) => {
            const person = state.people[row.author];
            return (
              <li key={row.author} className="bingo__row">
                <span className="bingo__place">{i + 1}</span>
                {person ? (
                  <img className="bingo__avatar" src={person.avatarUrl} alt="" width={24} height={24} loading="lazy" />
                ) : (
                  <span className="bingo__avatar bingo__avatar--none" aria-hidden="true">
                    {nameOf(person, i18n).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span>{nameOf(person, i18n)}</span>
                {row.author === ctx.user?.id && <span className="bingo__role">{i18n.t('leaderboard.you')}</span>}
                <span className="bingo__row-score">
                  {i18n.t('stats.score', {
                    lines: String(row.lines),
                    fields: String(row.fields),
                    cards: String(row.cards),
                  })}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <ClaimBox ctx={ctx} i18n={i18n} imports={state.imports} />

      <HistoryPanel
        ctx={ctx}
        i18n={i18n}
        history={state.history}
        suggestions={state.suggestions}
        snapshots={state.titles}
        people={state.people}
      />

      <p className="bingo__section-title">
        <Icon name="board" /> {i18n.t('page.bingos')}
      </p>
      {bingos.length === 0 ? (
        <p className="bingo__note">{i18n.t('page.noBingos')}</p>
      ) : (
        <ul className="bingo__list">
          {bingos.map((b) => (
            <li key={b.slug}>
              <a
                className="bingo__link"
                href={`/p/bingo/e/${encodeURIComponent(b.slug)}`}
                onClick={(event) => {
                  event.preventDefault();
                  ctx.route.navigate(`e/${encodeURIComponent(b.slug)}`);
                }}
              >
                {state.titles[b.slug].title}
              </a>
              <span className="bingo__note">
                {' · '}
                {i18n.t(`phase.${b.phase.toLowerCase()}`)}
                {typeof b.players === 'number' && ` · ${i18n.t('stats.cards', { count: String(b.players) })}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Every document one bingo's page draws, in one request. */
const EPISODE_PAGE_KEYS = [KEY_TEMPLATE, KEY_PHASE, KEY_LEADERBOARD, KEY_RECAP];

/** One bingo: how it went, a way into the episode, and — when the link named one — a player's result. */
function EpisodeView({
  ctx,
  i18n,
  slug,
  featured,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  slug: string;
  /** The player a shared link names, if it named one. */
  featured?: string;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    snapshot: DisplaySnapshot | null;
    template: Template | null;
    phase: PhaseState | null;
    board: Leaderboard | null;
    recap: Recap | null;
    history: History | null;
    people: Record<string, UserRef>;
  }>({
    loading: true, snapshot: null, template: null, phase: null, board: null, recap: null, history: null, people: {},
  });
  const [unheard, setUnheard] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [docs, snapshot, site] = await Promise.all([
        readScope(ctx, { type: 'episode', id: slug }, EPISODE_PAGE_KEYS),
        ctx.feeds.display(slug).catch(() => null),
        // Only for comparing this episode with the rest; the page draws fine without it.
        readScope(ctx, { type: 'site', id: 'main' }, [KEY_HISTORY]).catch(() => ({})),
      ]);
      const board = pick<Leaderboard>(docs, KEY_LEADERBOARD);
      const people = await resolvePeople(ctx, [
        ...(board?.ranked ?? []).map((r) => r.author),
        ...(board?.late ?? []).map((r) => r.author),
      ]);
      if (live) {
        setState({
          loading: false,
          snapshot,
          template: pick<Template>(docs, KEY_TEMPLATE),
          phase: pick<PhaseState>(docs, KEY_PHASE),
          board,
          recap: pick<Recap>(docs, KEY_RECAP),
          history: pick<History>(site, KEY_HISTORY),
          people,
        });
      }
    })().catch(() => {
      if (live) setState((s) => ({ ...s, loading: false }));
    });
    ctx.progress
      .get(slug)
      .then((seconds) => live && setUnheard(seconds === null || seconds < 30))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on what the reads depend on
  }, [slug]);

  if (state.loading) return <p className="bingo__note">{i18n.t('common.loading')}</p>;
  if (!state.template || !state.snapshot) return <p className="bingo__note">{i18n.t('page.notFound')}</p>;

  const phase: Phase = state.phase?.phase ?? 'OPEN';
  const size = gridSize(state.template);
  const rankBy: RankBy = state.board?.rankBy === 'fields' ? 'fields' : 'lines';
  const rows = [...(state.board?.ranked ?? []), ...(state.board?.late ?? [])];
  const featuredRow = featured ? rows.find((r) => r.author === featured) : undefined;
  const mine = ctx.user ? rows.find((r) => r.author === ctx.user?.id) : undefined;
  const hideRecap = unheard && !revealed;

  return (
    <>
      <p className="bingo__note">
        <a
          className="bingo__link"
          href="/p/bingo/"
          onClick={(event) => {
            event.preventDefault();
            ctx.route.navigate('');
          }}
        >
          {i18n.t('page.back')}
        </a>
      </p>
      <div className="bingo__head">
        <h2 className="bingo__title">{state.template.title || state.snapshot.title}</h2>
        <span className="bingo__phase">{i18n.t(`phase.${phase.toLowerCase()}`)}</span>
      </div>
      {state.template.title && <p className="bingo__hint">{state.snapshot.title}</p>}

      {featuredRow && (
        <p className="bingo__warn">
          {i18n.t('page.featured', {
            name: nameOf(state.people[featuredRow.author], i18n),
            lines: String(featuredRow.lines),
            ofLines: String(lineCount(size)),
            fields: String(featuredRow.fields),
            cells: String(featuredRow.cells),
          })}
        </p>
      )}

      <div className="bingo__actions">
        <a className="bingo__btn" href={ctx.links.episode(slug)}>
          {i18n.t(phase === 'OPEN' ? 'page.play' : 'page.open')}
        </a>
        <ShareButton
          ctx={ctx}
          i18n={i18n}
          subpath={mine && state.board?.published ? `e/${slug}/u/${mine.author}` : `e/${slug}`}
          title={state.template.title || state.snapshot.title}
        />
      </div>

      <Results
        i18n={i18n}
        people={state.people}
        me={ctx.user?.id}
        board={state.board}
        size={size}
        hidden={false}
        rankBy={rankBy}
      />

      <EpisodeScores i18n={i18n} board={state.board} history={state.history} slug={slug} />

      {state.recap?.published &&
        (hideRecap ? (
          <div className="bingo__spoiler">
            <p className="bingo__note">{i18n.t('episode.spoilerBody')}</p>
            <button type="button" className="bingo__btn bingo__btn--quiet" onClick={() => setRevealed(true)}>
              {i18n.t('episode.spoilerReveal')}
            </button>
          </div>
        ) : (
          <RecapPanel recap={state.recap} i18n={i18n} />
        ))}
    </>
  );
}
