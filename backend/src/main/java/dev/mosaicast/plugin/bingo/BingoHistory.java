// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Predicate;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * How past bingos went, episode after episode: what the site page draws its charts from.
 *
 * <p>Pure, like {@link BingoFuzzy}: no context, no clock, no I/O. The caller hands over rows it already
 * selected and decides which episodes count. Only resolved bingos on episodes everyone may see should be
 * passed in, because an unresolved card's score is the podcaster's progress so far.
 *
 * <p><strong>Who is named.</strong> A series, a place on it or a record names a player, so these are built
 * only for players who allow being listed. Everything that names nobody — headcounts, averages, the
 * distribution, hit rates and the places themselves — counts every ranked card. Leaving opted-out players
 * out of the places would quietly move everybody else up.
 */
final class BingoHistory {

    private BingoHistory() {}

    /** One episode's bingo as the history knows it, before ordering. */
    record Input(String slug, String title, String feed, Integer season, Integer episodeNo, Instant publishedAt) {}

    /**
     * Builds the history.
     *
     * @param episodes the resolved, public bingos, in any order
     * @param results  {@code card_result} rows, any episode (others are ignored), ranked and late
     * @param entries  {@code entry} rows, any episode (others are ignored)
     * @param listed   whether a player allows being named
     * @param rankBy   how the site ranks
     * @param cap      how many rows a ranking publishes at most, and how many series beyond those it names
     * @param minCards how many cards a player needs before the per-card ranking places them
     * @param now      when this is computed
     */
    static History compute(List<Input> episodes, List<CardResultRow> results, List<EntryRow> entries,
                           Predicate<String> listed, BingoScore.RankBy rankBy, int cap, int minCards, Instant now) {
        // Oldest first: the order a season was played in. An episode with no date yet sorts last.
        List<Input> ordered = episodes.stream()
                .sorted(Comparator.comparing(Input::publishedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(Input::slug))
                .toList();
        Map<String, Integer> index = new HashMap<>();
        for (int i = 0; i < ordered.size(); i++) {
            index.put(ordered.get(i).slug(), i);
        }

        Map<String, List<CardResultRow>> cardsBy = new HashMap<>();
        for (CardResultRow row : results) {
            if (index.containsKey(row.episode())) {
                cardsBy.computeIfAbsent(row.episode(), e -> new ArrayList<>()).add(row);
            }
        }
        Map<String, Map<String, Boolean>> groupsBy = new HashMap<>();
        for (EntryRow row : entries) {
            if (index.containsKey(row.episode()) && row.canonical() != null) {
                groupsBy.computeIfAbsent(row.episode(), e -> new HashMap<>()).merge(row.canonical(), row.hit(),
                        Boolean::logicalOr);
            }
        }

        Comparator<BingoScore.Score> ordering = BingoScore.ordering(rankBy);
        List<HistoryEpisode> out = new ArrayList<>();
        Map<String, List<Point>> pointsBy = new LinkedHashMap<>();
        Map<String, BingoScore.Score> totals = new HashMap<>();
        Map<Integer, Integer> distribution = new TreeMap<>();
        int[] cells = new int[ordered.size()];

        for (int i = 0; i < ordered.size(); i++) {
            Input episode = ordered.get(i);
            List<CardResultRow> cards = cardsBy.getOrDefault(episode.slug(), List.of());
            List<CardResultRow> ranked = cards.stream().filter(CardResultRow::ranked).toList();
            cells[i] = cards.isEmpty() ? 9 : cards.get(0).cells();

            for (CardResultRow card : ranked) {
                BingoScore.Score score = scoreOf(card);
                // A competition rank over every ranked card, listed or not: 1 + how many did strictly better.
                int place = 1 + (int) ranked.stream().filter(o -> ordering.compare(scoreOf(o), score) < 0).count();
                distribution.merge(card.lines(), 1, Integer::sum);
                if (!listed.test(card.author())) {
                    continue;
                }
                pointsBy.computeIfAbsent(card.author(), a -> new ArrayList<>())
                        .add(new Point(i, card.fields(), card.lines(), place));
                totals.merge(card.author(), score,
                        (a, b) -> new BingoScore.Score(a.fields() + b.fields(), a.lines() + b.lines(),
                                a.cells() + b.cells()));
            }

            Map<String, Boolean> groups = groupsBy.getOrDefault(episode.slug(), Map.of());
            long hits = groups.values().stream().filter(Boolean::booleanValue).count();
            out.add(new HistoryEpisode(episode.slug(), blankToNull(episode.title()), episode.feed(),
                    episode.season(), episode.episodeNo(),
                    episode.publishedAt() == null ? null : episode.publishedAt().toString(),
                    cards.size(), ranked.size(), cards.size() - ranked.size(),
                    round(ranked.stream().mapToInt(CardResultRow::fields).average().orElse(0)),
                    round(ranked.stream().mapToInt(CardResultRow::lines).average().orElse(0)),
                    round(ranked.isEmpty() ? 0 : (double) ranked.stream().filter(r -> r.lines() > 0).count()
                            / ranked.size()),
                    round(groups.isEmpty() ? 0 : (double) hits / groups.size()),
                    groups.size(), lineCountsOf(ranked)));
        }

        // Every scope the page can show: the whole history, and each season of each feed. The key matches the
        // frontend's seasonKey, so a pill finds its numbers without translating anything.
        Map<String, List<Integer>> scopes = new LinkedHashMap<>();
        scopes.put(ALL, new ArrayList<>());
        for (int i = 0; i < ordered.size(); i++) {
            scopes.get(ALL).add(i);
            Input episode = ordered.get(i);
            if (episode.season() != null) {
                scopes.computeIfAbsent(seasonKey(episode), k -> new ArrayList<>()).add(i);
            }
        }
        Map<String, ScopeStats> stats = new LinkedHashMap<>();
        Set<String> named = new HashSet<>();
        for (Map.Entry<String, List<Integer>> scope : scopes.entrySet()) {
            ScopeStats s = scope(scope.getValue(), pointsBy, out, cells, rankBy, minCards, cap);
            s.byTotal().forEach(r -> named.add(r.author()));
            s.byAverage().forEach(r -> named.add(r.author()));
            stats.put(scope.getKey(), s);
        }

        // The series published: the best all-time totals, plus anybody a ranking names - a newcomer of the
        // latest season is the person the per-card ranking exists for, and would otherwise have no line.
        // Ordered by all-time total, which is also each player's colour slot.
        List<Map.Entry<String, List<Point>>> byTotal = pointsBy.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, List<Point>>, BingoScore.Score>comparing(
                                e -> totals.get(e.getKey()), ordering)
                        .thenComparing(Map.Entry::getKey))
                .toList();
        List<PlayerSeries> players = new ArrayList<>();
        for (int k = 0; k < byTotal.size(); k++) {
            var e = byTotal.get(k);
            if (k < cap || named.contains(e.getKey())) {
                players.add(new PlayerSeries(e.getKey(), e.getValue().size(), List.copyOf(e.getValue())));
            }
        }

        List<LineCount> lines = distribution.entrySet().stream()
                .map(e -> new LineCount(e.getKey(), e.getValue()))
                .toList();

        return new History(List.copyOf(out), List.copyOf(players), lines, stats,
                rankBy.name().toLowerCase(java.util.Locale.ROOT), now.toString());
    }

    /** The key of "all bingos" among the scopes. */
    static final String ALL = "all";

    /** A season's key: {@code <feed>:<season>}, as the frontend's {@code seasonKey} builds it. */
    static String seasonKey(Input episode) {
        return (episode.feed() == null ? "" : episode.feed()) + ":" + episode.season();
    }

    /**
     * Rankings and records within one scope.
     *
     * <p>Per card divides a player's score by the cards they played, so somebody who joined late can lead -
     * but only once they have played {@code bar} cards: {@code minCards}, or every bingo of a scope that has
     * fewer. Below that, one lucky card would lead for good. Those players are counted, never named.
     */
    private static ScopeStats scope(List<Integer> indices, Map<String, List<Point>> pointsBy,
                                    List<HistoryEpisode> episodes, int[] cells, BingoScore.RankBy rankBy,
                                    int minCards, int cap) {
        Map<Integer, Integer> position = new HashMap<>();
        for (int k = 0; k < indices.size(); k++) {
            position.put(indices.get(k), k);
        }
        Comparator<BingoScore.Score> ordering = BingoScore.ordering(rankBy);
        List<StandingRow> totals = new ArrayList<>();
        Map<String, List<Point>> inScope = new LinkedHashMap<>();
        CardRecord best = null;
        for (Map.Entry<String, List<Point>> e : pointsBy.entrySet()) {
            List<Point> mine = e.getValue().stream().filter(p -> position.containsKey(p.e())).toList();
            if (mine.isEmpty()) {
                continue;
            }
            inScope.put(e.getKey(), mine);
            int f = 0;
            int l = 0;
            int c = 0;
            for (Point p : mine) {
                f += p.f();
                l += p.l();
                c += cells[p.e()];
                BingoScore.Score score = new BingoScore.Score(p.f(), p.l(), cells[p.e()]);
                if (best == null || ordering.compare(score, scoreOf(best)) < 0) {
                    best = new CardRecord(e.getKey(), episodes.get(p.e()).slug(), p.f(), p.l(), cells[p.e()]);
                }
            }
            totals.add(new StandingRow(e.getKey(), f, l, mine.size(), c));
        }

        List<StandingRow> byTotal = totals.stream()
                .sorted(((Comparator<StandingRow>) (a, b) -> ordering.compare(a.asScore(), b.asScore()))
                        .thenComparingInt(StandingRow::cards)
                        .thenComparing(StandingRow::author))
                .limit(cap)
                .toList();

        int bar = Math.max(1, Math.min(minCards, indices.size()));
        Comparator<AverageRow> primary = rankBy == BingoScore.RankBy.FIELDS
                ? Comparator.comparingDouble(AverageRow::fields).thenComparingDouble(AverageRow::lines)
                : Comparator.comparingDouble(AverageRow::lines).thenComparingDouble(AverageRow::fields);
        List<AverageRow> byAverage = totals.stream()
                .filter(r -> r.cards() >= bar)
                .map(r -> new AverageRow(r.author(), r.cards(), round((double) r.fields() / r.cards()),
                        round((double) r.lines() / r.cards())))
                .sorted(primary.reversed()
                        .thenComparing(Comparator.comparingInt(AverageRow::cards).reversed())
                        .thenComparing(AverageRow::author))
                .limit(cap)
                .toList();
        int belowBar = (int) totals.stream().filter(r -> r.cards() < bar).count();

        List<HistoryEpisode> scoped = indices.stream().map(episodes::get).toList();
        return new ScopeStats(byTotal, byAverage, bar, belowBar,
                records(scoped, inScope, position, best), indices.size());
    }

    private static HistoryRecords records(List<HistoryEpisode> episodes, Map<String, List<Point>> pointsBy,
                                          Map<Integer, Integer> position, CardRecord best) {
        PlayerCount mostCards = null;
        PlayerCount longestStreak = null;
        for (Map.Entry<String, List<Point>> e : pointsBy.entrySet()) {
            int cards = e.getValue().size();
            if (mostCards == null || cards > mostCards.count()
                    || (cards == mostCards.count() && e.getKey().compareTo(mostCards.author()) < 0)) {
                mostCards = new PlayerCount(e.getKey(), cards);
            }
            int streak = streakOf(e.getValue(), position);
            if (streak > 0 && (longestStreak == null || streak > longestStreak.count()
                    || (streak == longestStreak.count() && e.getKey().compareTo(longestStreak.author()) < 0))) {
                longestStreak = new PlayerCount(e.getKey(), streak);
            }
        }
        EpisodeRate most = null;
        EpisodeRate least = null;
        for (HistoryEpisode ep : episodes) {
            if (ep.candidates() == 0) {
                continue;
            }
            if (most == null || ep.hitRate() > most.hitRate()) {
                most = new EpisodeRate(ep.slug(), ep.hitRate());
            }
            if (least == null || ep.hitRate() < least.hitRate()) {
                least = new EpisodeRate(ep.slug(), ep.hitRate());
            }
        }
        return new HistoryRecords(best, mostCards, longestStreak, most, least);
    }

    /**
     * The longest run of bingos in a row within the scope, in the order they were played, each with at least
     * one line. An episode the player sat out ends the run: "in a row" means one after another, not one of
     * theirs after another.
     */
    private static int streakOf(List<Point> points, Map<Integer, Integer> position) {
        int longest = 0;
        int run = 0;
        int previous = Integer.MIN_VALUE;
        Set<Integer> seen = new HashSet<>();
        for (Point p : points) {
            int at = position.get(p.e());
            if (!seen.add(at)) {
                continue;
            }
            boolean consecutive = at == previous + 1;
            run = p.l() > 0 ? (consecutive ? run + 1 : 1) : 0;
            longest = Math.max(longest, run);
            previous = at;
        }
        return longest;
    }

    /** How many cards ended with 0, 1, 2… lines, by index, up to the highest seen. */
    private static List<Integer> lineCountsOf(List<CardResultRow> ranked) {
        int top = ranked.stream().mapToInt(CardResultRow::lines).max().orElse(-1);
        Integer[] counts = new Integer[top + 1];
        java.util.Arrays.fill(counts, 0);
        ranked.forEach(r -> counts[r.lines()]++);
        return List.of(counts);
    }

    private static BingoScore.Score scoreOf(CardResultRow row) {
        return new BingoScore.Score(row.fields(), row.lines(), row.cells());
    }

    private static BingoScore.Score scoreOf(CardRecord row) {
        return new BingoScore.Score(row.fields(), row.lines(), row.cells());
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text;
    }

    private static double round(double value) {
        return Math.round(value * 1000) / 1000.0;
    }
}
