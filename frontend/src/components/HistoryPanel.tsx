// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useMemo, useState } from 'react';
import type { DisplaySnapshot, PluginContext, ThemeTokens, UserRef } from '@mosaicast/plugin-sdk';
import type { PluginI18n } from '../i18n';
import {
  MAX_SHOWN,
  defaultSelection,
  episodesIn,
  scopeKey,
  niceTicks,
  rankingOf,
  slotOf,
  standings,
  summary,
  valuesOf,
  type FormMode,
} from '../history';
import { Icon } from '../icons';
import { isDark, seriesColor } from '../palette';
import type { EpisodeRate, History, HistoryEpisode, Leaderboard, PlayerCount, RankBy } from '../types';
import { BarChart } from './charts/BarChart';
import { Legend } from './charts/kit';
import { LineChart, type LineSeries } from './charts/LineChart';
import { SquareHeatmap } from './charts/SquareHeatmap';
import { nameOf } from './common';
import { PredictionsPanel } from './PredictionsPanel';
import { RecordsPanel, type RecordSpec } from './Records';

/**
 * The site page's history: tiles, form over the season, cards per bingo, how predictable each episode was,
 * how cards score, which predictions come true, which squares do, and records — in the visual language of
 * `mosaicast-plugin-stats`.
 *
 * Everything comes from the backend's `history` document: resolved bingos on public episodes only, a named
 * series only for players who allow being listed. The page's season tabs filter every part at once; a player
 * keeps their colour whatever is filtered, because the colour is their place in the whole history.
 */
export function HistoryPanel({
  ctx,
  i18n,
  history,
  season,
  snapshots,
  people,
}: {
  ctx: PluginContext;
  i18n: PluginI18n;
  history: History | null;
  /** The season the page shows, as a `history.scopes` key; `null` for every bingo. */
  season: string | null;
  /** Live episode snapshots, for titles; an episode the visitor may not see has none. */
  snapshots: Record<string, DisplaySnapshot>;
  people: Record<string, UserRef>;
}) {
  const episodes = history?.episodes ?? [];
  const players = history?.players ?? [];
  const rankBy: RankBy = history?.rankBy === 'fields' ? 'fields' : 'lines';
  const dark = isDark(ctx.theme as ThemeTokens | undefined);
  const viewer = ctx.user?.id;

  const [mode, setMode] = useState<FormMode>('total');
  const [picked, setPicked] = useState<string[]>(() => defaultSelection(players, viewer));
  const [table, setTable] = useState(false);

  const kept = episodesIn(history, season);
  const places = useMemo(() => standings(players, kept, rankBy), [players, kept.join(','), rankBy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (episodes.length === 0) {
    return <p className="bingo__note">{i18n.t('history.empty')}</p>;
  }

  const num = (v: number, digits = 1) => v.toLocaleString(i18n.locale, { maximumFractionDigits: digits });
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const name = (author: string) => (author === viewer ? i18n.t('leaderboard.you') : nameOf(people[author], i18n));
  const titleOf = (e: HistoryEpisode) => snapshots[e.slug]?.title ?? e.title ?? e.slug;
  const shortOf = (e: HistoryEpisode, i: number) =>
    e.season != null && e.episodeNo != null ? `S${e.season}E${e.episodeNo}` : e.episodeNo != null ? `E${e.episodeNo}` : `#${i + 1}`;
  const colorOf = (author: string) => seriesColor(slotOf(players, author), dark);

  const shown = kept.map((i) => episodes[i]);
  const xLabels = kept.map((i) => shortOf(episodes[i], i));
  const xTitles = shown.map(titleOf);
  const s = summary(history, kept);
  const measureLabel = i18n.t(rankBy === 'fields' ? 'history.fields' : 'history.lines');

  // ---- form over the season
  const drawn = players.filter((p) => picked.includes(p.author) && p.points.some((pt) => kept.includes(pt.e)));
  const series: LineSeries[] = drawn.map((p) => ({
    key: p.author,
    label: name(p.author),
    color: colorOf(p.author),
    values: valuesOf(p, kept, mode, rankBy, places),
    emphasis: p.author === viewer,
  }));
  const formMax = Math.max(1, ...series.flatMap((x) => x.values.filter((v): v is number => v !== null)));
  const formTicks = mode === 'place' ? placeTicks(formMax) : niceTicks(formMax);
  const togglePlayer = (author: string) =>
    setPicked((now) =>
      now.includes(author) ? now.filter((a) => a !== author) : now.length >= MAX_SHOWN ? now : [...now, author],
    );

  // ---- cards per bingo: the late layer only when somebody played late, or its legend names nothing
  const cardStacks = [
    { key: 'ranked', label: i18n.t('history.ranked'), color: seriesColor(0, dark), values: shown.map((e) => e.ranked) },
    { key: 'late', label: i18n.t('leaderboard.late'), color: seriesColor(3, dark), values: shown.map((e) => e.late) },
  ].filter((x) => x.key === 'ranked' || x.values.some((v) => v > 0));

  // ---- distribution over the kept episodes
  const counts: number[] = [];
  for (const e of shown) (e.lineCounts ?? []).forEach((c, l) => (counts[l] = (counts[l] ?? 0) + c));
  for (let l = 0; l < counts.length; l++) counts[l] = counts[l] ?? 0;

  // ---- records
  const scope = history?.scopes?.[scopeKey(season)];
  const records = scope?.records;
  const bySlug = (slug: string) => episodes.find((e) => e.slug === slug);
  const where = (slug: string) => titleIfKnown(bySlug(slug), titleOf);

  // ---- records: each a ranking, holder first; the dialog shows the rest
  const recordSpecs = (): RecordSpec[] => {
    const most = rankingOf(records?.mostPredictable);
    const least = rankingOf(records?.leastPredictable);
    const players = (id: string, label: string, rows: PlayerCount[], value: (r: PlayerCount) => string): RecordSpec => ({
      id, label, rows: rows.map((r) => ({ id: r.author, value: value(r), who: name(r.author) })),
    });
    const episodesBy = (id: string, label: string, rows: EpisodeRate[]): RecordSpec => ({
      id, label, rows: rows.map((r) => ({ id: r.slug, value: pct(r.hitRate), where: where(r.slug) })),
    });
    return [
      {
        id: 'bestCard',
        label: i18n.t('history.bestCard'),
        rows: rankingOf(records?.bestCard).map((r) => ({
          id: r.author,
          value: i18n.t('history.bestCardValue', { lines: String(r.lines), fields: String(r.fields) }),
          who: name(r.author),
          where: where(r.slug),
        })),
      },
      players('mostCards', i18n.t('history.mostCards'), rankingOf(records?.mostCards), (r) => String(r.count)),
      players('longestStreak', i18n.t('history.longestStreak'), rankingOf(records?.longestStreak),
        (r) => i18n.t('history.inARow', { count: String(r.count) })),
      episodesBy('mostPredictable', i18n.t('history.mostPredictable'), most),
      // With a single bingo the most and the least predictable one are the same episode: say it once.
      episodesBy('leastPredictable', i18n.t('history.leastPredictable'),
        least.length === 1 && most[0]?.slug === least[0].slug ? [] : least),
      players('loneHits', i18n.t('history.loneHits'), rankingOf(records?.loneHits),
        (r) => i18n.t('history.loneHitsValue', { count: String(r.count) })),
      players('nearMisses', i18n.t('history.nearMisses'), rankingOf(records?.nearMisses),
        (r) => i18n.t('history.nearMissesValue', { count: String(r.count) })),
    ];
  };

  return (
    <section className="bingo__history" aria-label={i18n.t('history.title')}>
      <p className="bingo__section-title">
        <Icon name="board" /> {i18n.t('history.title')}
      </p>

      <div className="bingo__tiles">
        <Tile label={i18n.t('history.tileBingos')} value={String(s.bingos)} />
        <Tile label={i18n.t('history.tileCards')} value={String(s.cards)}
          sub={i18n.t('history.tilePlayers', { count: String(s.namedPlayers) })} />
        <Tile label={i18n.t('history.tileAvg')} value={num(s.avgFields)} sub={i18n.t('history.tileAvgSub')} />
        <Tile label={i18n.t('history.tileWithLine')} value={pct(s.withLine)} />
        <Tile label={i18n.t('history.tileHitRate')} value={pct(s.hitRate)} sub={i18n.t('history.tileHitRateSub')} />
      </div>


      {kept.length < 2 ? (
        <p className="bingo__note">{i18n.t('history.needTwo')}</p>
      ) : (
        <>
          <div className="bingo__chart-head">
            <h3 className="bingo__chart-title">{i18n.t('history.form')}</h3>
            <div className="bingo__pills" role="group" aria-label={i18n.t('history.form')}>
              {(['episode', 'total', 'place'] as const).map((m) => (
                <button key={m} type="button" className="bingo__pill bingo__pill--small" aria-pressed={mode === m}
                  onClick={() => setMode(m)}>
                  {i18n.t(`history.mode.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <p className="bingo__note">
            {i18n.t(mode === 'place' ? 'history.formPlaceHint' : 'history.formHint', { measure: measureLabel })}
          </p>
          {series.length === 0 ? (
            <p className="bingo__note">{i18n.t('history.pickSomeone')}</p>
          ) : table ? (
            <FormTable series={series} xTitles={xTitles} format={(v) => (mode === 'place' ? `#${v}` : num(v))}
              i18n={i18n} />
          ) : (
            <LineChart
              xLabels={xLabels}
              xTitles={xTitles}
              series={series}
              ticks={formTicks}
              invert={mode === 'place'}
              format={(v) => (mode === 'place' ? `#${v}` : num(v))}
              label={i18n.t('history.form')}
              scrollLabel={i18n.t('chart.scrolls', { chart: i18n.t('history.form') })}
              directLabels={series.length <= 4}
            />
          )}
          <Legend items={series.map((x) => ({ key: x.key, label: x.label, color: x.color, line: true }))} />
          <div className="bingo__players" role="group" aria-label={i18n.t('history.players')}>
            {players.map((p) => (
              <button key={p.author} type="button" className="bingo__chip bingo__chip--player"
                aria-pressed={picked.includes(p.author)}
                disabled={!picked.includes(p.author) && picked.length >= MAX_SHOWN}
                onClick={() => togglePlayer(p.author)}>
                <span className="bingo__swatch" style={{ background: colorOf(p.author) }} aria-hidden="true" />
                {name(p.author)}
              </button>
            ))}
          </div>
          <p className="bingo__note">
            <button type="button" className="bingo__more" onClick={() => setTable((t) => !t)}>
              {i18n.t(table ? 'history.asChart' : 'history.asTable')}
            </button>
            {' · '}
            {i18n.t('history.onlyListed')}
          </p>

          <h3 className="bingo__chart-title">{i18n.t('history.cardsPer')}</h3>
          <BarChart
            xLabels={xLabels}
            xTitles={xTitles}
            stacks={cardStacks}
            ticks={niceTicks(Math.max(1, ...shown.map((e) => e.players)))}
            format={(v) => num(v, 0)}
            label={i18n.t('history.cardsPer')}
            scrollLabel={i18n.t('chart.scrolls', { chart: i18n.t('history.cardsPer') })}
          />
          <Legend items={cardStacks.map((x) => ({ key: x.key, label: x.label, color: x.color }))} />

          <h3 className="bingo__chart-title">{i18n.t('history.predictable')}</h3>
          <BarChart
            xLabels={xLabels}
            xTitles={xTitles}
            stacks={[{ key: 'hit', label: i18n.t('history.hitRate'), color: 'var(--mc-accent-2)', values: shown.map((e) => e.hitRate) }]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            format={pct}
            label={i18n.t('history.predictable')}
            scrollLabel={i18n.t('chart.scrolls', { chart: i18n.t('history.predictable') })}
            reference={{ value: s.hitRate, label: i18n.t('history.average', { value: pct(s.hitRate) }) }}
          />
        </>
      )}

      {counts.length > 0 && (
        <>
          <h3 className="bingo__chart-title">{i18n.t('history.howCardsScore')}</h3>
          <BarChart
            xLabels={counts.map((_, l) => String(l))}
            xTitles={counts.map((_, l) => i18n.t('history.withLines', { count: String(l) }))}
            stacks={[{ key: 'cards', label: i18n.t('history.cards'), color: 'var(--mc-accent-2)', values: counts }]}
            ticks={niceTicks(Math.max(1, ...counts))}
            format={(v) => num(v, 0)}
            label={i18n.t('history.howCardsScore')}
          />
          <p className="bingo__note">{i18n.t('history.howCardsScoreAxis')}</p>
        </>
      )}

      <PredictionsPanel i18n={i18n} stats={scope?.predictions} />
      <SquareHeatmap i18n={i18n} squares={scope?.squares} />

      <RecordsPanel i18n={i18n} records={recordSpecs()} />
    </section>
  );
}

function titleIfKnown(e: HistoryEpisode | undefined, titleOf: (e: HistoryEpisode) => string): string | undefined {
  return e ? titleOf(e) : undefined;
}

/** Place ticks: 1 at the top, whole numbers only, about five. */
function placeTicks(worst: number): number[] {
  const step = Math.max(1, Math.ceil(worst / 5));
  const out: number[] = [];
  for (let v = 1; v <= worst; v += step) out.push(v);
  if (out[out.length - 1] !== worst) out.push(worst);
  return out;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bingo__tile">
      <div className="bingo__tile-label">{label}</div>
      <div className="bingo__tile-value">{value}</div>
      {sub && <div className="bingo__tile-sub">{sub}</div>}
    </div>
  );
}

/** The form chart as a table: the accessible way to every value, and to the light colours' low contrast. */
function FormTable({
  series,
  xTitles,
  format,
  i18n,
}: {
  series: LineSeries[];
  xTitles: string[];
  format: (v: number) => string;
  i18n: PluginI18n;
}) {
  return (
    <div className="bingo__table-wrap">
      <table className="bingo__table">
        <thead>
          <tr>
            <th scope="col">{i18n.t('history.episode')}</th>
            {series.map((x) => (
              <th key={x.key} scope="col">{x.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {xTitles.map((title, i) => (
            <tr key={i}>
              <th scope="row">{title}</th>
              {series.map((x) => (
                <td key={x.key}>{x.values[i] === null ? '–' : format(x.values[i]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One bingo's scores, for its own page: how many cards ended with each number of lines, and how predictable
 * the episode was against the site's average. Says nothing about what was predicted, so it needs no
 * spoiler cover. Renders nothing until the board is published.
 */
export function EpisodeScores({
  i18n,
  board,
  history,
  slug,
}: {
  i18n: PluginI18n;
  board: Leaderboard | null;
  history: History | null;
  slug: string;
}) {
  if (!board?.published) return null;
  const counts: number[] = [];
  for (const t of board.distribution ?? []) counts[t.lines] = (counts[t.lines] ?? 0) + t.count;
  for (let l = 0; l < counts.length; l++) counts[l] = counts[l] ?? 0;
  const episodes = history?.episodes ?? [];
  const here = episodes.find((e) => e.slug === slug);
  const decided = episodes.filter((e) => e.candidates > 0);
  const average = decided.length ? decided.reduce((n, e) => n + e.hitRate, 0) / decided.length : null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (counts.length === 0 && !here) return null;

  return (
    <section aria-label={i18n.t('history.howCardsScore')}>
      {counts.length > 0 && (
        <>
          <h3 className="bingo__chart-title">{i18n.t('history.howCardsScore')}</h3>
          <BarChart
            xLabels={counts.map((_, l) => String(l))}
            xTitles={counts.map((_, l) => i18n.t('history.withLines', { count: String(l) }))}
            stacks={[{ key: 'cards', label: i18n.t('history.cards'), color: 'var(--mc-accent-2)', values: counts }]}
            ticks={niceTicks(Math.max(1, ...counts))}
            format={(v) => v.toLocaleString(i18n.locale, { maximumFractionDigits: 0 })}
            label={i18n.t('history.howCardsScore')}
          />
          <p className="bingo__note">{i18n.t('history.howCardsScoreAxis')}</p>
        </>
      )}
      {here && here.candidates > 0 && (
        <p className="bingo__note">
          {average !== null && decided.length > 1
            ? i18n.t('history.hereVsAverage', { here: pct(here.hitRate), average: pct(average) })
            : i18n.t('history.here', { here: pct(here.hitRate) })}
        </p>
      )}
    </section>
  );
}
