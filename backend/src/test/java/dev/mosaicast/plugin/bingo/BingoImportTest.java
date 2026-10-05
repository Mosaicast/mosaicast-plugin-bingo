// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeNotifier;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import dev.mosaicast.plugin.testkit.UserDataHandlerHarness;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Past bingos taken in through an import document, and claims that link them to the people who played. */
class BingoImportTest extends BingoTestSupport {

    private final String max = "import:" + UUID.randomUUID();
    private final String alex = "import:" + UUID.randomUUID();
    private static final String MAX_CODE = "GOP7-K2MQ-9XD4-HTFA";

    // ---------------------------------------------------------------- importing

    @Test
    void anImportBecomesAResolvedBingoScoredExactlyAsJudgedBackThen() {
        var ctx = ctx(published(true));
        // "Tyrion drinks" and "Tyrion drinks!" group together and agree; "Arya kills" and "Arya kill" would
        // group too, but were judged differently, so they must not share a decision.
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(),
                card(max, true, "Tyrion drinks", true, "Arya kills", true, "Dragons", false,
                        "x1", false, "x2", false, "x3", false, "x4", false, "x5", false, "x6", false),
                card(alex, true, "Tyrion drinks!", true, "Arya kill", false, "Snow", true,
                        "y1", false, "y2", false, "y3", false, "y4", false, "y5", false, "y6", false)));

        new BingoPlugin(clock).register(ctx);

        assertEquals("RESOLVED", phase(ctx).orElseThrow().phase());
        assertEquals(new BingoDocs.Row(max, 2, 0, 9, true), resultFor(ctx, max), "Tyrion + Arya, as marked");
        assertEquals(new BingoDocs.Row(alex, 2, 0, 9, true), resultFor(ctx, alex), "Tyrion + Snow; Arya kill was a miss");
        assertTrue(ctx.store().get(Scope.site(), "import:b1-1", Object.class).isEmpty(), "taken in, then removed");
        var report = imports(ctx);
        assertEquals(1, report.applied().size());
        assertEquals(EPISODE, report.applied().get(0).slug());
    }

    @Test
    void aLaterThresholdChangeDoesNotRegroupHistory() {
        var config = new MapPluginConfig();
        var ctx = ctx(published(true), config);
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(),
                card(max, true, "Arya kills", true, "a", false, "b", false, "c", false, "d", false, "e", false,
                        "f", false, "g", false, "h", false),
                card(alex, true, "Arya kill", false, "i", false, "j", false, "k", false, "l", false, "m", false,
                        "n", false, "o", false, "p", false)));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        config.with("fuzzyThreshold", 0.5);
        plugin.tick();

        assertEquals(1, resultFor(ctx, max).fields());
        assertEquals(0, resultFor(ctx, alex).fields());
    }

    @Test
    void aFreeCentreIsStatedAndCountsAsLive() {
        var ctx = ctx(published(true));
        putImport(ctx, "import:b1-1", bingo(3, true, Map.of(),
                card(max, true, "a", true, "b", false, "c", false, "d", false, "e", false, "f", false, "g", false,
                        "h", false)));

        new BingoPlugin(clock).register(ctx);

        assertEquals(2, resultFor(ctx, max).fields(), "a plus the free middle");
        assertTrue(ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, BingoDocs.Template.class)
                .orElseThrow().hasFreeCentre());
    }

    @Test
    void refusesWhatItCannotTakeInWhole() {
        var ctx = ctx(published(true));
        String account = UUID.randomUUID().toString();
        putImport(ctx, "import:bad-1", bingo(3, false, Map.of(), card(max, true, "only", true)));
        putImport(ctx, "import:bad-2", bingo(4, true, Map.of(), card(max, true, "x", true)));
        putImport(ctx, "import:bad-3", bingo(3, false, Map.of(),
                card(account, true, "a", true, "b", false, "c", false, "d", false, "e", false, "f", false,
                        "g", false, "h", false, "i", false)));
        Map<String, Object> noGrid = new LinkedHashMap<>(bingo(3, false, Map.of(), card(max, true, "a", true)));
        noGrid.remove("freeCentre");
        putImport(ctx, "import:bad-4", noGrid);

        new BingoPlugin(clock).register(ctx);

        var reasons = imports(ctx).rejected().stream().map(BingoDocs.ImportRejected::reason).toList();
        assertEquals(4, reasons.size());
        assertTrue(reasons.get(0).contains("1 squares, a 3x3 needs 9"), reasons.get(0));
        assertTrue(reasons.get(1).contains("no single middle square"), reasons.get(1));
        assertTrue(reasons.get(2).contains("linked only by its own claim"), reasons.get(2));
        assertTrue(reasons.get(3).contains("freeCentre must be stated"), reasons.get(3));
        assertTrue(ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, Object.class).isEmpty(),
                "nothing half-written");
    }

    @Test
    void anEpisodeWithABingoIsSkippedUnlessAskedToMergeIntoAResolvedOne() {
        var ctx = ctx(published(true));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(), nine(max, "kraken", true)));
        plugin.tick();
        assertTrue(imports(ctx).rejected().get(0).reason().contains("already has a bingo"));

        Map<String, Object> merge = new LinkedHashMap<>(bingo(3, false, Map.of(), nine(max, "kraken", true)));
        merge.put("onExisting", "merge");
        putImport(ctx, "import:b1-2", merge);
        plugin.tick();
        assertTrue(imports(ctx).rejected().get(1).reason().contains("only a resolved bingo"));

        resolve(ctx, Map.of("kraken", false));
        control(ctx, "RESOLVED");
        plugin.tick();
        putImport(ctx, "import:b1-3", merge);
        plugin.tick();
        assertTrue(imports(ctx).rejected().get(2).reason().contains("decided false in this bingo but marked true"),
                "the same words cannot be true for one card and false for another");

        Map<String, Object> other = new LinkedHashMap<>(bingo(3, false, Map.of(), nine(max, "Kraken attacks", true)));
        other.put("onExisting", "merge");
        putImport(ctx, "import:b1-4", other);
        plugin.tick();

        assertTrue(imports(ctx).applied().get(0).merged());
        assertEquals(1, resultFor(ctx, max).fields(), "his prediction came true back then, whatever was decided here");
        assertEquals(0, resultFor(ctx, alice.toString()).fields(), "and hers still did not");
    }

    @Test
    void importedPlayersCountButAreNeverNamedOrToldAnything() {
        var ctx = ctx(published(true));
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(), nine(max, "a", true), nine(alex, "b", false)));

        new BingoPlugin(clock).register(ctx);

        var history = ctx.store().get(Scope.site(), BingoDocs.KEY_HISTORY, BingoDocs.History.class).orElseThrow();
        assertEquals(2, history.episodes().get(0).ranked(), "counted");
        assertTrue(history.players().isEmpty(), "nobody chose to be shown, so nobody is");
        assertTrue(leaderboard(ctx).ranked().isEmpty(), "not on the board either");
        assertEquals(2, leaderboard(ctx).players(), "but counted");
        assertTrue(notifier.delivered().isEmpty());
    }

    @Test
    void aCardMarkedNotRankedIsLate() {
        var ctx = ctx(published(true));
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(), nine(max, "a", true), nineUnranked(alex, "b", true)));

        new BingoPlugin(clock).register(ctx);

        assertFalse(resultFor(ctx, alex).ranked());
        assertTrue(resultFor(ctx, max).ranked());
    }

    // ---------------------------------------------------------------- claims

    @Test
    void aClaimMovesTheCardsOnceAndTellsNobody() {
        var ctx = ctx(published(true));
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(BingoImport.hashOf(MAX_CODE), max), nine(max, "a", true)));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        claim(ctx, alice, "gop7 k2mq 9xd4 htfa"); // spacing and case do not matter
        plugin.tick();

        assertEquals(1, resultFor(ctx, alice.toString()).fields());
        assertEquals(0, ctx.schema().count(BingoDocs.ENTITY_ENTRY, Criteria.where("author", Criteria.Op.EQ, max)));
        var result = imports(ctx).claimed().get(BingoImport.hashOf(MAX_CODE));
        assertEquals(1, result.linked());
        assertTrue(notifier.delivered().isEmpty(), "news of a years-old resolution is not news");

        claim(ctx, bob, MAX_CODE);
        plugin.tick();
        assertTrue(leaderboard(ctx).ranked().stream().noneMatch(r -> r.author().equals(bob.toString())),
                "a code works once");
    }

    @Test
    void aClaimKeepsTheClaimantsOwnLiveCard() {
        var ctx = ctx(published(true));
        String other = "the-sample-cast-s01e05";
        feeds.withDisplay(other, published(true));
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, Map.of("size", 3, "freeCentre", false));
        seedCard(ctx, alice, List.of("mine"));
        resolve(ctx, Map.of("mine", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        Map<String, Object> merge = new LinkedHashMap<>(bingo(3, false, Map.of(BingoImport.hashOf(MAX_CODE), max),
                nine(max, "imported", false)));
        merge.put("onExisting", "merge");
        putImport(ctx, "import:b1-1", merge);
        Map<String, Object> elsewhere = new LinkedHashMap<>(bingo(3, false, Map.of(), nine(max, "x", true)));
        elsewhere.put("slug", other);
        putImport(ctx, "import:b1-2", elsewhere);
        plugin.tick();

        claim(ctx, alice, MAX_CODE);
        plugin.tick();

        var result = imports(ctx).claimed().get(BingoImport.hashOf(MAX_CODE));
        assertEquals(1, result.linked());
        assertEquals(1, result.skipped(), "her own card there is the record");
        assertEquals(1, resultFor(ctx, alice.toString()).fields(), "still her live card");
        assertEquals(9, ctx.schema().count(BingoDocs.ENTITY_ENTRY, Criteria.where("author", Criteria.Op.EQ, max)),
                "the clashing imported card - nine squares - stays anonymous");
    }

    @Test
    void anUnclaimGivesTheCardsBackAndRotatesTheCode() {
        var ctx = ctx(published(true));
        String newCode = "NEWC-ODE0-0000-0001";
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(BingoImport.hashOf(MAX_CODE), max), nine(max, "a", true)));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        claim(ctx, bob, MAX_CODE); // a leaked code, used by the wrong person
        plugin.tick();
        assertEquals(1, resultFor(ctx, bob.toString()).fields());

        ctx.store().put(Scope.site(), BingoDocs.UNCLAIM_PREFIX + "x",
                Map.of("hash", BingoImport.hashOf(MAX_CODE), "newHash", BingoImport.hashOf(newCode)));
        plugin.tick();
        plugin.tick();

        assertEquals(0, ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                Criteria.where("author", Criteria.Op.EQ, bob.toString())), "back to the pseudonym, and not re-claimed");
        claim(ctx, alice, newCode);
        plugin.tick();
        assertEquals(1, resultFor(ctx, alice.toString()).fields());
    }

    @Test
    void bingosImportedAfterTheClaimFollowTheClaimant() {
        var ctx = ctx(published(true));
        String later = "the-sample-cast-s01e05";
        feeds.withDisplay(later, published(true));
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(BingoImport.hashOf(MAX_CODE), max), nine(max, "a", true)));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        claim(ctx, alice, MAX_CODE);
        plugin.tick();

        Map<String, Object> next = new LinkedHashMap<>(bingo(3, false, Map.of(BingoImport.hashOf(MAX_CODE), max),
                nine(max, "b", true)));
        next.put("slug", later);
        putImport(ctx, "import:b2-1", next);
        plugin.tick();

        assertEquals(0, ctx.schema().count(BingoDocs.ENTITY_ENTRY, Criteria.where("author", Criteria.Op.EQ, max)));
        assertEquals(2, imports(ctx).claimed().get(BingoImport.hashOf(MAX_CODE)).linked());
    }

    @Test
    void anUnknownCodeChangesNothing() {
        var ctx = ctx(published(true));
        putImport(ctx, "import:b1-1", bingo(3, false, Map.of(BingoImport.hashOf(MAX_CODE), max), nine(max, "a", true)));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        claim(ctx, alice, "WRON-GCOD-E000-0000");
        plugin.tick();

        assertTrue(imports(ctx).claimed().isEmpty());
        assertNull(BingoImport.hashOf("short"), "too short to be a code");
        // scripts/bingo-import.test.mjs asserts the same value: the script and the backend must agree.
        assertEquals("b80087d0460bafadda33996223a80e9e44e963829286bdeb4701ce8d3cb845c0", BingoImport.hashOf("gop7-k2mq 9xd4-htfa"));
    }

    // ---------------------------------------------------------------- export

    @Test
    void anExportIsThePersonsOwnCardsInTheImportFormat() {
        var ctx = ctx(published(true));
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, Map.of("size", 3, "freeCentre", true));
        seedCard(ctx, alice, List.of("kraken", "", "merch"));
        seedCard(ctx, bob, List.of("not hers"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        var export = new UserDataHandlerHarness(plugin).export(alice.toString()).orElseThrow();

        assertEquals("mosaicast-bingo/1", export.get("format"));
        @SuppressWarnings("unchecked")
        var bingo = ((List<Map<String, Object>>) export.get("bingos")).get(0);
        assertEquals(3, bingo.get("size"));
        assertEquals(true, bingo.get("freeCentre"));
        @SuppressWarnings("unchecked")
        var card = ((List<Map<String, Object>>) bingo.get("cards")).get(0);
        assertEquals("you", card.get("player"));
        @SuppressWarnings("unchecked")
        var squares = (List<Map<String, Object>>) card.get("squares");
        assertEquals(8, squares.size(), "a free middle is stated, not written");
        assertEquals(Map.of("text", "kraken", "hit", true), squares.get(0));
        assertEquals(Map.of("text", "", "hit", false), squares.get(1));
        assertFalse(export.toString().contains("not hers"));
    }

    // ---------------------------------------------------------------- fixtures

    private void putImport(FakePluginContext ctx, String id, Map<String, Object> doc) {
        ctx.store().put(Scope.site(), id, doc);
    }

    private static Map<String, Object> bingo(int size, boolean freeCentre, Map<String, String> claims,
                                             Map<String, Object>... cards) {
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("slug", EPISODE);
        doc.put("size", size);
        doc.put("freeCentre", freeCentre);
        doc.put("cards", List.of(cards));
        doc.put("claims", claims);
        return doc;
    }

    /** A card from alternating text, hit pairs. */
    private static Map<String, Object> card(String author, boolean ranked, Object... pairs) {
        List<Map<String, Object>> squares = new ArrayList<>();
        for (int i = 0; i < pairs.length; i += 2) {
            squares.add(Map.of("text", pairs[i], "hit", pairs[i + 1]));
        }
        return Map.of("author", author, "ranked", ranked, "squares", squares);
    }

    /** A full 3x3 card: one real square, eight unique fillers that never came true. */
    private static Map<String, Object> nine(String author, String text, boolean hit) {
        return nineOf(author, text, hit, true);
    }

    private static Map<String, Object> nineUnranked(String author, String text, boolean hit) {
        return nineOf(author, text, hit, false);
    }

    private static Map<String, Object> nineOf(String author, String text, boolean hit, boolean ranked) {
        Object[] pairs = new Object[18];
        pairs[0] = text;
        pairs[1] = hit;
        for (int i = 1; i < 9; i++) {
            pairs[2 * i] = author.substring(7, 15) + " filler " + i;
            pairs[2 * i + 1] = false;
        }
        return card(author, ranked, pairs);
    }

    private void claim(FakePluginContext ctx, UUID user, String code) {
        ctx.store().asUser(user).put(Scope.user(), BingoDocs.KEY_CLAIM, Map.of("codes", List.of(code)));
        clock.advance(Duration.ofMinutes(1));
    }

    /** A card's score as recorded, whether or not the public board names its author. */
    private static BingoDocs.Row resultFor(FakePluginContext ctx, String author) {
        var row = ctx.schema().select(BingoDocs.ENTITY_CARD_RESULT, Criteria.where("author", Criteria.Op.EQ, author),
                BingoDocs.CardResultRow.class).get(0);
        return new BingoDocs.Row(row.author(), row.fields(), row.lines(), row.cells(), row.ranked());
    }

    private static BingoDocs.Imports imports(FakePluginContext ctx) {
        return ctx.store().get(Scope.site(), BingoDocs.KEY_IMPORTS, BingoDocs.Imports.class).orElseThrow();
    }
}
