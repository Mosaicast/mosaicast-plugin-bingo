// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.SchemaStore;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * The schema side: copying cards into rows (which is where the freeze happens) and scoring those rows
 * against the resolution.
 */
final class BingoRecord {

    private final PluginContext ctx;
    private final Clock clock;

    BingoRecord(PluginContext ctx, Clock clock) {
        this.ctx = ctx;
        this.clock = clock;
    }

    private Instant now() {
        return clock.instant();
    }

    /**
     * Copies cards into the schema, which is where the freeze actually happens.
     *
     * <ul>
     *   <li>{@code OPEN} - rewrite from the live document every tick, so editing a card before the lock is
     *       free and costs nothing but a delete-and-insert.</li>
     *   <li>{@code LOCKED} or later - a card that already has rows is never re-read; a card arriving now is
     *       taken once and marked {@code ranked = false}, so catch-up listeners still get to play without
     *       reaching the board.</li>
     * </ul>
     *
     * <p>{@code phase} here is the phase the cards were <em>written</em> under, not the one this pass has
     * just derived. On the tick that closes predictions the two differ, and using the new one would demote
     * everybody who saved inside the last interval - up to a whole {@code ingestIntervalSeconds}, which is
     * exactly when people rush to fill a card - to a latecomer who never reaches the board.
     */
    void ingest(String slug, List<CardInput> cards, BingoFuzzy.Grouping grouping,
                        Template template, Phase phase, boolean allowLate) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        Instant now = now();

        for (CardInput card : cards) {
            boolean hasRows = schema.count(ENTITY_ENTRY, byCard(slug, card.author())) > 0;

            if (phase == Phase.OPEN) {
                schema.delete(ENTITY_ENTRY, byCard(slug, card.author()));
                insertEntries(schema, slug, card, grouping, template, true, now);
            } else if (!hasRows) {
                if (!allowLate) {
                    continue;
                }
                insertEntries(schema, slug, card, grouping, template, false, now);
            }
            // else: frozen - the document may have changed, and nothing here reads it again.
        }
    }

    void insertEntries(SchemaStore schema, String slug, CardInput card,
                               BingoFuzzy.Grouping grouping, Template template, boolean ranked,
                               Instant now) {
        List<String> entries = card.entries();
        for (int index = 0; index < entries.size(); index++) {
            String text = entries.get(index);
            String canonical = grouping.canonicalOf(text);
            if (canonical == null) {
                continue; // blank or uncomparable
            }
            // Stored, not recomputed on read: the host adds no ORDER BY unless one is asked for, so the
            // order rows come back in guarantees nothing and a line could not be found again.
            int position = BingoScore.gridPosition(index, template.gridSize(), template.hasFreeCentre());
            if (position < 0) {
                continue; // written for a bigger grid than this template has
            }
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("episode", slug);
            values.put("author", card.author());
            values.put("position", position);
            values.put("text", text.strip());
            values.put("canonical", canonical);
            values.put("hit", false);
            values.put("ranked", ranked);
            values.put("recordedAt", now);
            schema.insert(ENTITY_ENTRY, values);
        }
    }

    // ---------------------------------------------------------------- scoring

    /**
     * Rescores every frozen card against the current resolution and republishes the leaderboard.
     *
     * <p>Scoring runs on every tick right up to {@code ARCHIVED}, including long after the entries froze:
     * the podcaster is still ticking answers off, and a frozen card whose score never moved would be a card
     * that never got resolved.
     *
     * <p>Everyone is scored; only those who allow it are <em>published</em>. Someone who has opted out of
     * the leaderboard still has rows, still has a score, and still sees it on their own card - the tile
     * works that out from their own document without asking anybody.
     */
    Leaderboard score(String slug, Template template, Resolution resolution,
                      Map<String, Prefs> prefs, Phase phase, BingoScore.RankBy rankBy) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return Leaderboard.empty(now().toString());
        }

        List<EntryRow> rows = schema.select(ENTITY_ENTRY,
                Criteria.where("episode", Criteria.Op.EQ, slug), EntryRow.class);

        Map<String, List<EntryRow>> byAuthor = new LinkedHashMap<>();
        for (EntryRow row : rows) {
            byAuthor.computeIfAbsent(row.author(), a -> new ArrayList<>()).add(row);
        }

        int size = template.gridSize();
        boolean freeCentre = template.hasFreeCentre();
        Instant now = now();
        List<Row> ranked = new ArrayList<>();
        List<Row> late = new ArrayList<>();
        // Everyone scored, listed or not. Opting out is a choice about whether a name and a score are shown
        // to other people; it is not a choice to stop having taken part, so it must not shrink the
        // headcount or thin out the tally that places the very people no row is published for.
        List<Row> everyRanked = new ArrayList<>();
        int everyPlayer = 0;

        for (Map.Entry<String, List<EntryRow>> e : byAuthor.entrySet()) {
            List<EntryRow> cardRows = e.getValue();
            List<int[]> marks = BingoScore.marks();
            boolean isRanked = true;
            for (EntryRow row : cardRows) {
                boolean hit = resolution.isHit(row.canonical());
                if (hit != row.hit()) {
                    schema.update(ENTITY_ENTRY, row.id(), Map.of("hit", hit));
                }
                marks.add(new int[] { row.position(), hit ? 1 : 0 });
                isRanked = isRanked && row.ranked();
            }

            String author = e.getKey();
            BingoScore.Score score = BingoScore.of(marks, size, freeCentre);

            // The row is kept whatever the preference says: it is what the standings are recomputed from,
            // and dropping it would make an aggregate that quietly disagrees with what happened.
            schema.delete(ENTITY_CARD_RESULT, byCard(slug, author));
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("episode", slug);
            values.put("author", author);
            values.put("fields", score.fields());
            values.put("lines", score.lines());
            values.put("cells", score.cells());
            values.put("ranked", isRanked);
            values.put("recordedAt", now);
            schema.insert(ENTITY_CARD_RESULT, values);

            Row row = new Row(author, score.fields(), score.lines(), score.cells(), isRanked);
            everyPlayer++;
            if (isRanked) {
                everyRanked.add(row);
            }
            if (prefsFor(prefs, author).listedOrDefault()) {
                (isRanked ? ranked : late).add(row);
            }
        }

        int players = everyPlayer;

        // Nothing is published before the answers are known. Two reasons, and the second is the one that
        // matters: a board of identical scores says nothing, and a board that creeps upward while a
        // podcaster ticks answers off tells anyone watching how much has already come true - which is
        // exactly what the spoiler cover over the grid is there to prevent.
        if (phase != Phase.RESOLVED && phase != Phase.ARCHIVED) {
            return new Leaderboard(List.of(), List.of(), players, players, false, List.of(),
                    name(rankBy), now.toString());
        }

        Comparator<Row> best = comparing(rankBy).thenComparing(Row::author);
        ranked.sort(best);
        late.sort(best);
        return new Leaderboard(cap(ranked), cap(late), players, players, true,
                distributionOf(everyRanked), name(rankBy), now.toString());
    }

    /**
     * How the operator ranks, as the browser sees it.
     *
     * <p>Published rather than looked up: there is no {@code ctx.config} on the frontend, so a tile that
     * wants to lead with the quantity that actually decides places has no other way to learn which it is.
     */
                                   static String name(BingoScore.RankBy rankBy) {
        return rankBy.name().toLowerCase(java.util.Locale.ROOT);
    }

    /** Best first, by whatever the operator ranks on, with the other quantity breaking the tie. */
    static Comparator<Row> comparing(BingoScore.RankBy rankBy) {
        Comparator<BingoScore.Score> ordering = BingoScore.ordering(rankBy);
        return (a, b) -> ordering.compare(a.asScore(), b.asScore());
    }

    /** A published board is bounded: every visitor reads this document, however many people played. */
    static List<Row> cap(List<Row> rows) {
        return List.copyOf(rows.subList(0, Math.min(rows.size(), MAX_PUBLISHED_ROWS)));
    }

    /**
     * How many people share each score.
     *
     * <p>This is what lets somebody in 73rd place still learn they are 73rd. The board itself is capped, so
     * their row is not in it; counting how many scored better is enough to place them exactly, and it costs
     * a row per <em>distinct score</em> rather than per player — bounded by the size of the grid, not by
     * how many turned up. It also names nobody, so publishing it gives away less than the board does.
     *
     * <p>Counted over every ranked card, including the ones nobody else may see. A reader with no published
     * row is precisely who this exists for, and someone who opted out has no published row by definition —
     * leaving them out would empty the tally of the only readers who need it, and would misplace everyone
     * else by however many of them there are.
     */
    static List<Tally> distributionOf(List<Row> ranked) {
        Map<String, Tally> byScore = new LinkedHashMap<>();
        for (Row row : ranked) {
            byScore.merge(row.lines() + ":" + row.fields(),
                    new Tally(row.lines(), row.fields(), 1),
                    (a, b) -> new Tally(a.lines(), a.fields(), a.count() + b.count()));
        }
        return List.copyOf(byScore.values());
    }
            }
