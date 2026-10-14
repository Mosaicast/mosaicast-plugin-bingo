// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Prediction lists, the square heatmap and the counts behind the lone-hit and near-miss records. */
class BingoInsightsTest {

    private static final Instant NOW = Instant.parse("2026-10-14T10:00:00Z");
    private static final String KRAKEN = "The kraken returns";
    private static final String SONG = "Someone sings a song";
    private long ids;

    // ---------------------------------------------------------------- predictions

    @Test
    void aLongRecordOutranksALuckyStreak() {
        List<BingoDocs.EntryRow> rows = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            rows.add(row("ep" + i, i % 2 == 0 ? "ann" : "bob", 0, KRAKEN, i < 18));
        }
        for (int i = 0; i < 3; i++) {
            rows.add(row("ep" + i, i % 2 == 0 ? "bob" : "ann", 1, SONG, true));
        }

        var stats = BingoInsights.predictions(rows, sites(rows), 3);

        assertEquals(List.of(KRAKEN, SONG), stats.best().stream().map(BingoDocs.PredictionRow::label).toList(),
                "18 of 20 is the safer bet than 3 of 3");
        var kraken = stats.best().get(0);
        assertEquals(20, kraken.bingos());
        assertEquals(18, kraken.hits());
        assertEquals(2, kraken.people());
        assertEquals(20, kraken.cards());
        assertTrue(BingoInsights.lower(18, 20) > BingoInsights.lower(3, 3));
    }

    @Test
    void ratesOnlyWhatAppearedOnEnoughBingosButCountsItAsPopular() {
        List<BingoDocs.EntryRow> rows = List.of(
                row("ep1", "ann", 0, KRAKEN, true), row("ep2", "bob", 0, KRAKEN, true),
                row("ep1", "bob", 0, KRAKEN, true));

        var stats = BingoInsights.predictions(rows, sites(rows), 3);

        assertTrue(stats.best().isEmpty(), "two bingos are below a floor of three");
        assertTrue(stats.worst().isEmpty());
        assertEquals(3, stats.floor());
        assertEquals(List.of(KRAKEN), stats.popular().stream().map(BingoDocs.PredictionRow::label).toList());
        assertEquals(3, stats.popular().get(0).cards());
    }

    @Test
    void neverPublishesWhatOnlyOnePersonWrote() {
        List<BingoDocs.EntryRow> rows = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            rows.add(row("ep" + i, "ann", 0, KRAKEN, true));
        }

        var stats = BingoInsights.predictions(rows, sites(rows), 3);

        assertTrue(stats.best().isEmpty() && stats.worst().isEmpty() && stats.popular().isEmpty(),
                "a prediction one person made is their own words");
    }

    @Test
    void leavesLateCardsOut() {
        List<BingoDocs.EntryRow> rows = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            rows.add(row("ep" + i, "ann", 0, KRAKEN, true));
            rows.add(late("ep" + i, "bob", KRAKEN, true));
        }

        var ranked = BingoInsights.rankedIn(List.of("ep0", "ep1", "ep2"), rows);
        var stats = BingoInsights.predictions(ranked, sites(ranked), 3);

        assertTrue(stats.best().isEmpty(), "without the late card only one person wrote it");
        assertEquals(3, ranked.size());
    }

    @Test
    void theWorstListNeverRepeatsTheBest() {
        List<BingoDocs.EntryRow> rows = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            rows.add(row("ep" + i, "ann", 0, KRAKEN, true));
            rows.add(row("ep" + i, "bob", 0, KRAKEN, true));
            rows.add(row("ep" + i, "ann", 1, SONG, false));
            rows.add(row("ep" + i, "bob", 1, SONG, false));
        }

        var stats = BingoInsights.predictions(rows, sites(rows), 3);

        assertEquals(List.of(KRAKEN), stats.best().stream().map(BingoDocs.PredictionRow::label).toList());
        assertEquals(List.of(SONG), stats.worst().stream().map(BingoDocs.PredictionRow::label).toList(),
                "never came true, so not among the best");
        assertEquals(0, stats.worst().get(0).hits());
    }

    @Test
    void reliableMeansTrueMoreOftenThanNot() {
        List<BingoDocs.EntryRow> rows = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            rows.add(row("ep" + i, "ann", 0, KRAKEN, i < 2));
            rows.add(row("ep" + i, "bob", 0, KRAKEN, i < 2));
        }
        for (int i = 0; i < 3; i++) {
            rows.add(row("ep" + i, "ann", 1, SONG, i == 0));
            rows.add(row("ep" + i, "bob", 1, SONG, i == 0));
        }

        var stats = BingoInsights.predictions(rows, sites(rows), 3);

        assertTrue(stats.best().isEmpty(), "a third of the time is not reliable, half the time is neither");
        assertEquals(List.of(SONG), stats.worst().stream().map(BingoDocs.PredictionRow::label).toList());
    }

    @Test
    void aBingoCountsOnceEvenWhereThePodcasterSplitIt() {
        List<BingoDocs.EntryRow> rows = List.of(
                row("ep1", "ann", 0, KRAKEN, true, "kraken a"),
                row("ep1", "bob", 0, "The kraken returns!", false, "kraken b"),
                row("ep2", "ann", 0, KRAKEN, false), row("ep3", "bob", 0, KRAKEN, false));

        var stats = BingoInsights.predictions(rows, sites(rows), 3);

        var kraken = stats.popular().get(0);
        assertEquals(3, kraken.bingos());
        assertEquals(1, kraken.hits(), "came true on ep1 by either decision");
    }

    // ---------------------------------------------------------------- squares

    @Test
    void countsEachSquareAndLeavesAFreeCentreEmpty() {
        List<BingoDocs.EntryRow> rows = List.of(
                row("ep1", "ann", 0, KRAKEN, true), row("ep1", "bob", 0, SONG, false),
                row("ep1", "ann", 8, SONG, true), row("ep2", "ann", 0, KRAKEN, true));

        var squares = BingoInsights.squares(rows, slug -> 3);

        assertEquals(1, squares.size());
        var cells = squares.get(0).cells();
        assertEquals(9, cells.size());
        assertEquals(new BingoDocs.SquareRate(3, 2), cells.get(0));
        assertEquals(new BingoDocs.SquareRate(1, 1), cells.get(8));
        assertEquals(new BingoDocs.SquareRate(0, 0), cells.get(4), "nothing was ever written in the middle");
    }

    // ---------------------------------------------------------------- the records' counts

    @Test
    void aLoneHitIsOneNobodyElseOnThatBingoHad() {
        List<BingoDocs.EntryRow> rows = List.of(
                row("ep1", "ann", 0, KRAKEN, true), row("ep1", "bob", 0, KRAKEN, true),
                row("ep1", "ann", 1, SONG, true),
                row("ep2", "bob", 0, SONG, true), row("ep2", "ann", 1, KRAKEN, false));

        assertEquals(Map.of("ann", 1, "bob", 1), BingoInsights.loneHits(rows),
                "ann alone saw the song coming on ep1, bob alone on ep2; the shared kraken counts for nobody");
    }

    @Test
    void aNearMissIsACardWithoutALineThatWasOneSquareShort() {
        List<BingoDocs.EntryRow> rows = new ArrayList<>();
        // ann: top row 0 and 1 came true, 2 did not - one short, and no line anywhere.
        rows.add(row("ep1", "ann", 0, "a", true));
        rows.add(row("ep1", "ann", 1, "b", true));
        rows.add(row("ep1", "ann", 2, "c", false));
        // bob: a whole row - a line, so not a near miss however close the rest came.
        rows.add(row("ep1", "bob", 0, "a", true));
        rows.add(row("ep1", "bob", 1, "b", true));
        rows.add(row("ep1", "bob", 2, "d", true));
        rows.add(row("ep1", "bob", 3, "e", true));
        rows.add(row("ep1", "bob", 4, "f", true));
        // cid: a free centre plus the top-left corner is one short of the diagonal.
        rows.add(row("ep2", "cid", 0, "a", true));

        var misses = BingoInsights.nearMisses(rows, slug -> 3, slug -> slug.equals("ep2"));

        assertEquals(Map.of("ann", 1, "cid", 1), misses);
    }

    @Test
    void nearLinesCountsEveryLineMissingExactlyOneSquare() {
        boolean[] hits = new boolean[9];
        hits[0] = hits[1] = hits[4] = true;
        // Row 0 (0,1 hit), column 1 (1,4 hit), the down diagonal (0,4 hit): each one short.
        assertEquals(3, BingoScore.nearLines(hits, 3));
        assertEquals(0, BingoScore.nearLines(new boolean[9], 3));
        assertEquals(0, BingoScore.nearLines(new boolean[4], 3), "a grid of the wrong size counts nothing");
    }

    // ---------------------------------------------------------------- fixtures

    private static BingoInsights.Sites sites(List<BingoDocs.EntryRow> rows) {
        var grouping = BingoFuzzy.group(rows.stream().map(BingoDocs.EntryRow::text).toList(), 0.82);
        return BingoInsights.Sites.of(grouping, rows, BingoPublish.MIN_AUTHORS);
    }

    private BingoDocs.EntryRow row(String episode, String author, int position, String text, boolean hit) {
        return row(episode, author, position, text, hit, BingoFuzzy.normalise(text));
    }

    private BingoDocs.EntryRow row(String episode, String author, int position, String text, boolean hit,
                                   String canonical) {
        return new BingoDocs.EntryRow(++ids, episode, author, position, text, canonical, hit, true, NOW);
    }

    private BingoDocs.EntryRow late(String episode, String author, String text, boolean hit) {
        return new BingoDocs.EntryRow(++ids, episode, author, 0, text, BingoFuzzy.normalise(text), hit, false, NOW);
    }
}
