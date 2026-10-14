// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * What the history says about predictions and squares rather than about players: which predictions come
 * true, which never do, where on the grid the hits land, and the counts two of the records are built from.
 *
 * <p>Pure, like {@link BingoHistory}: no context, no clock, no I/O. Every method takes the ranked entries of
 * one scope's resolved, public bingos and nothing else. Late cards are left out by the caller, because a late
 * card may be written once the answers are known.
 */
final class BingoInsights {

    private BingoInsights() {}

    /** How many rows each prediction list publishes at most. */
    static final int MAX_PREDICTIONS = 10;

    /**
     * How sure the prediction lists want to be, as the normal quantile of a 95% interval. A plain hit rate
     * puts "came true once in one bingo" at 100%, above "18 of 20"; the Wilson bound puts the long record
     * first because it is the one less likely to be luck.
     */
    private static final double Z = 1.96;

    /**
     * Predictions as the whole site groups them, and which of them may be shown.
     *
     * @param groupOf the site-wide group of a written entry, or {@code null} for one the grouping never saw
     * @param labels  group to the spelling shown for it - only groups at least {@code minAuthors} different
     *                people wrote, because a prediction one person made is their own words
     */
    record Sites(Function<String, String> groupOf, Map<String, String> labels) {

        /** No grouping at all: no prediction lists. */
        static final Sites NONE = new Sites(text -> null, Map.of());

        /**
         * @param grouping   the site grouping, built from {@code rows}
         * @param rows       the ranked entries on public episodes
         * @param minAuthors how many different people must have written a prediction before it is shown
         */
        static Sites of(BingoFuzzy.Grouping grouping, List<EntryRow> rows, int minAuthors) {
            Map<String, Set<String>> authors = new HashMap<>();
            for (EntryRow row : rows) {
                String group = grouping.canonicalOf(row.text());
                if (group != null) {
                    authors.computeIfAbsent(group, g -> new HashSet<>()).add(row.author());
                }
            }
            Map<String, String> labels = new HashMap<>();
            for (BingoFuzzy.Candidate c : grouping.candidates()) {
                if (authors.getOrDefault(c.canonical(), Set.of()).size() >= minAuthors) {
                    labels.put(c.canonical(), c.label());
                }
            }
            return new Sites(grouping::canonicalOf, Map.copyOf(labels));
        }
    }

    // ---------------------------------------------------------------- predictions

    /**
     * The prediction lists of one scope.
     *
     * <p>The unit is a bingo, not a card: a prediction came true in a bingo or it did not, however many
     * cards carried it. Where the podcaster split one site group into two decisions on one bingo, it counts
     * as a hit there if either came true.
     *
     * @param entries the ranked entries of the scope's bingos
     * @param sites   the site grouping and the predictions that may be shown
     * @param floor   how many bingos a prediction needs before it is rated, never lowered for a short scope
     */
    static PredictionStats predictions(List<EntryRow> entries, Sites sites, int floor) {
        Map<String, Map<String, Boolean>> hitBy = new HashMap<>();
        Map<String, Set<String>> people = new HashMap<>();
        Map<String, Set<String>> cards = new HashMap<>();
        for (EntryRow row : entries) {
            String group = sites.groupOf().apply(row.text());
            if (group == null || !sites.labels().containsKey(group)) {
                continue;
            }
            hitBy.computeIfAbsent(group, g -> new HashMap<>()).merge(row.episode(), row.hit(), Boolean::logicalOr);
            people.computeIfAbsent(group, g -> new HashSet<>()).add(row.author());
            cards.computeIfAbsent(group, g -> new HashSet<>()).add(row.episode() + "\u0000" + row.author());
        }

        List<PredictionRow> rows = new ArrayList<>();
        for (Map.Entry<String, Map<String, Boolean>> e : hitBy.entrySet()) {
            String group = e.getKey();
            int bingos = e.getValue().size();
            int hits = (int) e.getValue().values().stream().filter(Boolean::booleanValue).count();
            rows.add(new PredictionRow(sites.labels().get(group), bingos, hits, people.get(group).size(),
                    cards.get(group).size()));
        }

        // More often true than not on one side, less on the other: a short list would otherwise fill both ends
        // with whatever qualified, and call a prediction that came true a third of the time reliable.
        List<PredictionRow> rated = rows.stream().filter(r -> r.bingos() >= floor).toList();
        List<PredictionRow> best = rated.stream()
                .filter(r -> 2 * r.hits() > r.bingos())
                .sorted(Comparator.comparingDouble((PredictionRow r) -> lower(r.hits(), r.bingos())).reversed()
                        .thenComparing(Comparator.comparingInt(PredictionRow::hits).reversed())
                        .thenComparing(PredictionRow::label))
                .limit(MAX_PREDICTIONS)
                .toList();
        List<PredictionRow> worst = rated.stream()
                .filter(r -> 2 * r.hits() < r.bingos())
                .sorted(Comparator.comparingDouble((PredictionRow r) -> upper(r.hits(), r.bingos()))
                        .thenComparing(Comparator.comparingInt(PredictionRow::bingos).reversed())
                        .thenComparing(PredictionRow::label))
                .limit(MAX_PREDICTIONS)
                .toList();
        List<PredictionRow> popular = rows.stream()
                .sorted(Comparator.comparingInt(PredictionRow::cards).reversed()
                        .thenComparing(Comparator.comparingInt(PredictionRow::bingos).reversed())
                        .thenComparing(PredictionRow::label))
                .limit(MAX_PREDICTIONS)
                .toList();
        return new PredictionStats(floor, best, worst, popular);
    }

    /** The lower end of the Wilson score interval: a hit rate this record is fairly sure to reach. */
    static double lower(int hits, int n) {
        return wilson(hits, n, -1);
    }

    /** The upper end: a hit rate this record is fairly sure to stay under. */
    static double upper(int hits, int n) {
        return wilson(hits, n, +1);
    }

    private static double wilson(int hits, int n, int sign) {
        if (n <= 0) {
            return sign < 0 ? 0 : 1;
        }
        double p = (double) hits / n;
        double z2 = Z * Z;
        double centre = p + z2 / (2.0 * n);
        double spread = Z * Math.sqrt(p * (1 - p) / n + z2 / (4.0 * n * n));
        return (centre + sign * spread) / (1 + z2 / n);
    }

    // ---------------------------------------------------------------- squares

    /**
     * How often each square came true, one entry per grid size, smallest first.
     *
     * @param entries the ranked entries of the scope's bingos
     * @param sizeOf  each bingo's grid edge, by slug
     */
    static List<SquareStats> squares(List<EntryRow> entries, Function<String, Integer> sizeOf) {
        Map<Integer, int[][]> bySize = new TreeMap<>();
        for (EntryRow row : entries) {
            int size = sizeOf.apply(row.episode());
            if (row.position() < 0 || row.position() >= size * size) {
                continue;
            }
            int[][] cells = bySize.computeIfAbsent(size, s -> new int[s * s][2]);
            cells[row.position()][0]++;
            if (row.hit()) {
                cells[row.position()][1]++;
            }
        }
        List<SquareStats> out = new ArrayList<>();
        bySize.forEach((size, cells) -> {
            List<SquareRate> rates = new ArrayList<>();
            for (int[] cell : cells) {
                rates.add(new SquareRate(cell[0], cell[1]));
            }
            out.add(new SquareStats(size, List.copyOf(rates)));
        });
        return List.copyOf(out);
    }

    // ---------------------------------------------------------------- counts for the records

    /**
     * Per player, the predictions that came true and that no other ranked card of that bingo carried. The
     * group is the bingo's own ({@code canonical}), the one the podcaster decided on.
     *
     * @param entries the ranked entries of the scope's bingos
     */
    static Map<String, Integer> loneHits(List<EntryRow> entries) {
        Map<String, Set<String>> authors = new HashMap<>();
        Map<String, Boolean> hit = new HashMap<>();
        for (EntryRow row : entries) {
            if (row.canonical() == null) {
                continue;
            }
            String key = row.episode() + "\u0000" + row.canonical();
            authors.computeIfAbsent(key, k -> new HashSet<>()).add(row.author());
            hit.merge(key, row.hit(), Boolean::logicalOr);
        }
        Map<String, Integer> out = new LinkedHashMap<>();
        authors.forEach((key, who) -> {
            if (who.size() == 1 && hit.get(key)) {
                out.merge(who.iterator().next(), 1, Integer::sum);
            }
        });
        return out;
    }

    /**
     * Per player, the cards that ended without a line but were one square short of one.
     *
     * @param entries    the ranked entries of the scope's bingos
     * @param sizeOf     each bingo's grid edge, by slug
     * @param freeCentre whether a bingo's middle square was a gift, by slug
     */
    static Map<String, Integer> nearMisses(List<EntryRow> entries, Function<String, Integer> sizeOf,
                                           Function<String, Boolean> freeCentre) {
        Map<String, List<EntryRow>> byCard = new LinkedHashMap<>();
        for (EntryRow row : entries) {
            byCard.computeIfAbsent(row.episode() + "\u0000" + row.author(), k -> new ArrayList<>()).add(row);
        }
        Map<String, Integer> out = new LinkedHashMap<>();
        for (List<EntryRow> card : byCard.values()) {
            EntryRow first = card.get(0);
            int size = sizeOf.apply(first.episode());
            List<int[]> marks = BingoScore.marks();
            card.forEach(row -> marks.add(new int[] { row.position(), row.hit() ? 1 : 0 }));
            boolean[] hits = BingoScore.grid(marks, size, freeCentre.apply(first.episode()));
            if (BingoScore.countLines(hits, size) == 0 && BingoScore.nearLines(hits, size) > 0) {
                out.merge(first.author(), 1, Integer::sum);
            }
        }
        return out;
    }

    /** The scope's ranked entries, for every method here: late cards and bingos outside it left out. */
    static List<EntryRow> rankedIn(Collection<String> slugs, List<EntryRow> entries) {
        Set<String> in = new HashSet<>(slugs);
        return entries.stream().filter(EntryRow::ranked).filter(r -> in.contains(r.episode())).toList();
    }
}
