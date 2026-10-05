// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * Writes cards in {@code mosaicast-bingo/1}, the format {@code scripts/bingo-import.mjs} reads: one entry per
 * bingo with its grid stated outright and every square with whether it came true. Pure.
 */
final class BingoExport {

    static final String FORMAT = "mosaicast-bingo/1";

    private BingoExport() {}

    /**
     * One person's own cards, as {@code "player": "you"}. No id: the file is theirs, and an id would only
     * tie it back to this site.
     *
     * @param rows     every entry row the person authored, any episode
     * @param template the episode's template, or {@code null} when it is gone
     */
    static Map<String, Object> ownBingos(List<EntryRow> rows, Function<String, Template> template) {
        Map<String, List<EntryRow>> byEpisode = new LinkedHashMap<>();
        rows.forEach(r -> byEpisode.computeIfAbsent(r.episode(), e -> new ArrayList<>()).add(r));

        List<Map<String, Object>> bingos = new ArrayList<>();
        byEpisode.forEach((slug, cardRows) -> {
            Template t = template.apply(slug);
            int size = t == null ? BingoPlugin.DEFAULT_GRID_SIZE : t.gridSize();
            boolean freeCentre = t != null && t.hasFreeCentre();
            Object[] squares = new Object[BingoScore.fillableCells(size, freeCentre)];
            Arrays.fill(squares, Map.of("text", "", "hit", false));
            boolean ranked = true;
            for (EntryRow row : cardRows) {
                int index = BingoScore.entryIndex(row.position(), size, freeCentre);
                if (index >= 0 && index < squares.length) {
                    squares[index] = Map.of("text", row.text(), "hit", row.hit());
                }
                ranked &= row.ranked();
            }
            Map<String, Object> card = new LinkedHashMap<>();
            card.put("player", "you");
            card.put("ranked", ranked);
            card.put("squares", List.of(squares));
            Map<String, Object> bingo = new LinkedHashMap<>();
            bingo.put("episode", Map.of("slug", slug));
            if (t != null && t.title() != null && !t.title().isBlank()) {
                bingo.put("title", t.title());
            }
            bingo.put("size", size);
            bingo.put("freeCentre", freeCentre);
            bingo.put("cards", List.of(card));
            bingos.add(bingo);
        });

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("format", FORMAT);
        out.put("bingos", bingos);
        return out;
    }
}
