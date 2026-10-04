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
     * @param cap      how many players' series to publish at most
     * @param now      when this is computed
     */
    static History compute(List<Input> episodes, List<CardResultRow> results, List<EntryRow> entries,
                           Predicate<String> listed, BingoScore.RankBy rankBy, int cap, Instant now) {
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
        CardRecord best = null;

        for (int i = 0; i < ordered.size(); i++) {
            Input episode = ordered.get(i);
            List<CardResultRow> cards = cardsBy.getOrDefault(episode.slug(), List.of());
            List<CardResultRow> ranked = cards.stream().filter(CardResultRow::ranked).toList();

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
                if (best == null || ordering.compare(score, scoreOf(best)) < 0) {
                    best = new CardRecord(card.author(), episode.slug(), card.fields(), card.lines(), card.cells());
                }
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
                    groups.size()));
        }

        // The series published are the best cumulative scores, like the standings; ties by id for stability.
        List<PlayerSeries> players = pointsBy.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, List<Point>>, BingoScore.Score>comparing(
                                e -> totals.get(e.getKey()), ordering)
                        .thenComparing(Map.Entry::getKey))
                .limit(cap)
                .map(e -> new PlayerSeries(e.getKey(), e.getValue().size(), List.copyOf(e.getValue())))
                .toList();

        List<LineCount> lines = distribution.entrySet().stream()
                .map(e -> new LineCount(e.getKey(), e.getValue()))
                .toList();

        return new History(List.copyOf(out), players, lines,
                records(out, pointsBy, best), rankBy.name().toLowerCase(java.util.Locale.ROOT), now.toString());
    }

    private static HistoryRecords records(List<HistoryEpisode> episodes, Map<String, List<Point>> pointsBy,
                                          CardRecord best) {
        PlayerCount mostCards = null;
        PlayerCount longestStreak = null;
        for (Map.Entry<String, List<Point>> e : pointsBy.entrySet()) {
            int cards = e.getValue().size();
            if (mostCards == null || cards > mostCards.count()
                    || (cards == mostCards.count() && e.getKey().compareTo(mostCards.author()) < 0)) {
                mostCards = new PlayerCount(e.getKey(), cards);
            }
            int streak = streakOf(e.getValue());
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
     * The longest run of bingos in a row, in the order they were played, each with at least one line. An
     * episode the player sat out ends the run: "in a row" means one after another, not one of theirs after
     * another.
     */
    private static int streakOf(List<Point> points) {
        int longest = 0;
        int run = 0;
        int previous = Integer.MIN_VALUE;
        Set<Integer> seen = new HashSet<>();
        for (Point p : points) {
            if (!seen.add(p.e())) {
                continue;
            }
            boolean consecutive = p.e() == previous + 1;
            run = p.l() > 0 ? (consecutive ? run + 1 : 1) : 0;
            longest = Math.max(longest, run);
            previous = p.e();
        }
        return longest;
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
