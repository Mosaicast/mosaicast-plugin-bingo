// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.bingo.BingoScore.RankBy;
import dev.mosaicast.plugin.bingo.BingoScore.Score;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Scoring is the part people argue about, so it is tested on its own, away from any context. */
class BingoScoreTest {

    /** Marks every named grid square as a hit. */
    private static List<int[]> hits(int... cells) {
        List<int[]> marks = new ArrayList<>();
        for (int cell : cells) {
            marks.add(new int[] { cell, 1 });
        }
        return marks;
    }

    @Test
    void mapsWrittenEntriesOntoTheGridAroundTheFreeCentre() {
        // A card is a flat list of what somebody typed; the free square is not one of those entries, so
        // everything after it shifts by one.
        assertEquals(0, BingoScore.gridPosition(0, 3, true));
        assertEquals(3, BingoScore.gridPosition(3, 3, true));
        assertEquals(5, BingoScore.gridPosition(4, 3, true), "entry 4 skips over the centre at 4");
        assertEquals(8, BingoScore.gridPosition(7, 3, true));
        assertEquals(-1, BingoScore.gridPosition(8, 3, true), "a 3x3 with a free centre holds 8 entries");
    }

    @Test
    void mapsStraightThroughWithoutAFreeCentre() {
        for (int i = 0; i < 9; i++) {
            assertEquals(i, BingoScore.gridPosition(i, 3, false));
        }
    }

    @Test
    void onlyAnOddGridHasAMiddleToGiveAway() {
        assertEquals(4, BingoScore.centreOf(3, true));
        assertEquals(-1, BingoScore.centreOf(4, true), "a 4x4 has no single middle square");
        assertEquals(-1, BingoScore.centreOf(3, false));
        assertEquals(8, BingoScore.fillableCells(3, true));
        assertEquals(9, BingoScore.fillableCells(3, false));
    }

    @Test
    void countsRowsColumnsAndBothDiagonals() {
        assertEquals(8, BingoScore.lineCount(3));

        assertEquals(1, BingoScore.countLines(BingoScore.grid(hits(0, 1, 2), 3, false), 3), "a row");
        assertEquals(1, BingoScore.countLines(BingoScore.grid(hits(0, 3, 6), 3, false), 3), "a column");
        assertEquals(1, BingoScore.countLines(BingoScore.grid(hits(0, 4, 8), 3, false), 3), "a diagonal");
        assertEquals(1, BingoScore.countLines(BingoScore.grid(hits(2, 4, 6), 3, false), 3), "the other one");
        assertEquals(0, BingoScore.countLines(BingoScore.grid(hits(0, 1, 3), 3, false), 3));
    }

    @Test
    void countsEveryLineOnAFullCard() {
        assertEquals(8, BingoScore.countLines(
                BingoScore.grid(hits(0, 1, 2, 3, 4, 5, 6, 7, 8), 3, false), 3));
    }

    @Test
    void theFreeCentreIsWorthNothingOnFieldsAndAGreatDealOnLines() {
        // The whole argument for keeping it. On a 3x3 the middle square sits on four of the eight lines.
        List<int[]> corners = hits(0, 2, 6, 8);

        Score without = BingoScore.of(corners, 3, false);
        Score with = BingoScore.of(corners, 3, true);

        assertEquals(0, without.lines());
        assertEquals(2, with.lines(), "both diagonals close once the middle is a gift");
        assertEquals(without.fields() + 1, with.fields(), "on fields it is the same constant for everyone");
    }

    @Test
    void reportsTheWholeGridAsItsCellCount() {
        assertEquals(9, BingoScore.of(hits(0), 3, true).cells());
        assertEquals(16, BingoScore.of(hits(0), 4, false).cells());
    }

    @Test
    void ignoresAMarkThatFallsOutsideTheGrid() {
        // A card written for a bigger grid, or a template that shrank under it.
        Score score = BingoScore.of(hits(0, 99, -1), 3, false);
        assertEquals(1, score.fields());
    }

    @Test
    void ranksByLinesFirstAndBreaksTiesOnFields() {
        Score oneLineFewFields = new Score(3, 1, 9);
        Score noLinesManyFields = new Score(6, 0, 9);
        Score oneLineManyFields = new Score(5, 1, 9);

        var byLines = BingoScore.ordering(RankBy.LINES);
        assertTrue(byLines.compare(oneLineFewFields, noLinesManyFields) < 0, "a line beats loose hits");
        assertTrue(byLines.compare(oneLineManyFields, oneLineFewFields) < 0, "fields break the tie");
    }

    @Test
    void ranksByFieldsWhenTheOperatorSaysSo() {
        Score oneLineFewFields = new Score(3, 1, 9);
        Score noLinesManyFields = new Score(6, 0, 9);

        var byFields = BingoScore.ordering(RankBy.FIELDS);
        assertTrue(byFields.compare(noLinesManyFields, oneLineFewFields) < 0);
    }

    @Test
    void readsTheConfigLenientlyBecauseAnOperatorTypedIt() {
        assertEquals(RankBy.FIELDS, RankBy.of("fields"));
        assertEquals(RankBy.FIELDS, RankBy.of("  FIELDS "));
        assertEquals(RankBy.LINES, RankBy.of("lines"));
        assertEquals(RankBy.LINES, RankBy.of(null), "the default is bingo as people expect it");
        assertEquals(RankBy.LINES, RankBy.of("nonsense"));
    }
}
