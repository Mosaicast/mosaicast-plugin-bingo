// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Turns a card's hits into a score: how many fields came true, and how many complete lines that makes.
 *
 * <p>Pure — no context, no clock, no I/O — for the same reason {@link BingoFuzzy} is: this is the part
 * people will argue about, so it has to be trivially testable.
 *
 * <h2>Why a grid position has to be stored</h2>
 * Counting fields needs only a bag of hits. Counting <em>lines</em> needs to know which square each entry
 * sits on, and that cannot be recovered later: the doc store hands rows back in no guaranteed order (the
 * host adds no {@code ORDER BY} unless one is asked for), so the position travels with the row.
 *
 * <h2>The free centre</h2>
 * Optional per bingo. It only exists to be a hit nobody had to earn, which is worth nothing at all when
 * scoring by field count — every card gets the same constant — and worth a great deal when scoring by
 * lines: on a 3x3 the middle square sits on four of the eight possible lines.
 */
public final class BingoScore {

    private BingoScore() {}

    /** How a leaderboard is ordered. The other quantity is always the tiebreaker. */
    public enum RankBy {
        /** Bingo as people expect it: whoever completes lines wins, ties broken on fields. */
        LINES,
        /** Whoever guessed most individual things, ties broken on lines. */
        FIELDS;

        /** Lenient, because this comes from an operator-typed config field. */
        public static RankBy of(String raw) {
            if (raw != null && raw.strip().equalsIgnoreCase("fields")) {
                return FIELDS;
            }
            return LINES;
        }
    }

    /**
     * Where the {@code n}-th written entry sits on the grid.
     *
     * <p>A card is a flat list of what somebody typed; the free centre is not one of those entries, so
     * every square after it shifts by one. Both halves of the plugin have to agree on this mapping, which
     * is why it lives in one place and is stored rather than recomputed at read time.
     *
     * @return the grid index, or {@code -1} when the entry falls outside the grid
     */
    public static int gridPosition(int entryIndex, int size, boolean freeCentre) {
        if (entryIndex < 0) {
            return -1;
        }
        int centre = centreOf(size, freeCentre);
        int seen = 0;
        for (int cell = 0; cell < size * size; cell++) {
            if (cell == centre) {
                continue;
            }
            if (seen == entryIndex) {
                return cell;
            }
            seen++;
        }
        return -1;
    }

    /**
     * The inverse of {@link #gridPosition}: which written entry a grid square holds.
     *
     * @return the entry index, or {@code -1} for the free centre or a square outside the grid
     */
    public static int entryIndex(int position, int size, boolean freeCentre) {
        int centre = centreOf(size, freeCentre);
        if (position < 0 || position >= size * size || position == centre) {
            return -1;
        }
        return centre >= 0 && position > centre ? position - 1 : position;
    }

    /** The free square's grid index, or {@code -1} when this bingo has none. */
    public static int centreOf(int size, boolean freeCentre) {
        return freeCentre && size % 2 == 1 ? (size * size) / 2 : -1;
    }

    /** How many entries a person actually fills in. */
    public static int fillableCells(int size, boolean freeCentre) {
        return size * size - (centreOf(size, freeCentre) >= 0 ? 1 : 0);
    }

    /**
     * Counts the complete lines on a grid: every row, every column, and both diagonals.
     *
     * @param hits    one flag per grid square, in reading order; length must be {@code size * size}
     * @param size    the grid's edge length
     * @return how many lines are complete, out of {@code 2 * size + 2}
     */
    public static int countLines(boolean[] hits, int size) {
        if (size < 1 || hits.length != size * size) {
            return 0;
        }
        int lines = 0;

        for (int r = 0; r < size; r++) {
            boolean whole = true;
            for (int c = 0; c < size && whole; c++) {
                whole = hits[r * size + c];
            }
            if (whole) {
                lines++;
            }
        }
        for (int c = 0; c < size; c++) {
            boolean whole = true;
            for (int r = 0; r < size && whole; r++) {
                whole = hits[r * size + c];
            }
            if (whole) {
                lines++;
            }
        }

        boolean down = true;
        boolean up = true;
        for (int i = 0; i < size; i++) {
            down = down && hits[i * size + i];
            up = up && hits[i * size + (size - 1 - i)];
        }
        if (down) {
            lines++;
        }
        if (up) {
            lines++;
        }
        return lines;
    }

    /** How many lines a grid of this size has at all. */
    public static int lineCount(int size) {
        return 2 * size + 2;
    }

    /**
     * Builds the hit grid from what is known about one card.
     *
     * @param marks      grid index to whether that square came true; indexes outside the grid are ignored
     * @param size       the grid's edge length
     * @param freeCentre whether the middle square is a gift
     */
    public static boolean[] grid(List<int[]> marks, int size, boolean freeCentre) {
        boolean[] hits = new boolean[size * size];
        int centre = centreOf(size, freeCentre);
        if (centre >= 0) {
            hits[centre] = true;
        }
        for (int[] mark : marks) {
            int cell = mark[0];
            if (cell >= 0 && cell < hits.length && mark[1] != 0) {
                hits[cell] = true;
            }
        }
        return hits;
    }

    /** Everything one card is worth. */
    public record Score(int fields, int lines, int cells) {}

    /**
     * Scores one card.
     *
     * @param marks      grid index paired with 1 for a hit, 0 for a miss
     * @param size       the grid's edge length
     * @param freeCentre whether the middle square counts as a hit nobody earned
     */
    public static Score of(List<int[]> marks, int size, boolean freeCentre) {
        boolean[] hits = grid(marks, size, freeCentre);
        int fields = 0;
        for (boolean hit : hits) {
            if (hit) {
                fields++;
            }
        }
        return new Score(fields, countLines(hits, size), size * size);
    }

    /**
     * Orders two cards, best first.
     *
     * <p>The configured quantity decides; the other one breaks the tie. A caller still has to add a stable
     * final tiebreaker of its own, or two equal cards will swap places between ticks.
     */
    public static Comparator<Score> ordering(RankBy rankBy) {
        Comparator<Score> primary = rankBy == RankBy.FIELDS
                ? Comparator.comparingInt(Score::fields).thenComparingInt(Score::lines)
                : Comparator.comparingInt(Score::lines).thenComparingInt(Score::fields);
        return primary.reversed();
    }

    /** Convenience for the common shape: a list of (position, hit) pairs. */
    public static List<int[]> marks() {
        return new ArrayList<>();
    }
}
