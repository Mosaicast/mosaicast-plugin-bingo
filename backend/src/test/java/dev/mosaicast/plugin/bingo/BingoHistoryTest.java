// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The history the site page charts: who is named, what is counted, and in which order. */
class BingoHistoryTest extends BingoTestSupport {

    private static final Instant NOW = Instant.parse("2026-10-04T10:00:00Z");
    private long ids;

    // ---------------------------------------------------------------- the pure computation

    @Test
    void ordersEpisodesByReleaseAndPlacesEveryoneButNamesOnlyListedPlayers() {
        var episodes = List.of(
                input("ep-b", "2026-02-01T00:00:00Z"),
                input("ep-a", "2026-01-01T00:00:00Z"));
        var results = List.of(
                card("ep-a", "ann", 5, 2), card("ep-a", "hidden", 7, 3), card("ep-a", "bob", 5, 2),
                card("ep-b", "ann", 3, 0), card("ep-b", "bob", 6, 1));

        var history = BingoHistory.compute(episodes, results, List.of(), a -> !a.equals("hidden"),
                BingoScore.RankBy.LINES, 50, 3, NOW);

        assertEquals(List.of("ep-a", "ep-b"), history.episodes().stream().map(BingoDocs.HistoryEpisode::slug).toList(),
                "oldest first: the order the season was played in");
        assertEquals(Set.of("ann", "bob"), Set.copyOf(history.players().stream().map(BingoDocs.PlayerSeries::author).toList()),
                "someone who opted out has no series");
        var ann = series(history, "ann");
        assertEquals(new BingoDocs.Point(0, 5, 2, 2), ann.points().get(0),
                "second behind the opted-out card, sharing the place with bob: their card still counts");
        assertEquals(new BingoDocs.Point(1, 3, 0, 2), ann.points().get(1));
        assertEquals(3, history.episodes().get(0).ranked(), "aggregates count everyone");
        assertEquals(2.333, history.episodes().get(0).avgLines(), 0.001);
        assertEquals(List.of(0, 0, 2, 1), history.episodes().get(0).lineCounts(), "two cards with 2 lines, one with 3");
    }

    @Test
    void lateCardsAreCountedButNotPlaced() {
        var results = new ArrayList<>(List.of(card("ep-a", "ann", 5, 1)));
        results.add(new BingoDocs.CardResultRow(++ids, "ep-a", "latecomer", 9, 3, 9, false, NOW));

        var history = BingoHistory.compute(List.of(input("ep-a", "2026-01-01T00:00:00Z")), results, List.of(),
                a -> true, BingoScore.RankBy.LINES, 50, 3, NOW);

        var episode = history.episodes().get(0);
        assertEquals(2, episode.players());
        assertEquals(1, episode.late());
        assertEquals(1, series(history, "ann").points().get(0).p(), "a late card was never in the running");
        assertEquals(List.of("ann"), history.players().stream().map(BingoDocs.PlayerSeries::author).toList());
    }

    @Test
    void ignoresEpisodesItWasNotGiven() {
        var history = BingoHistory.compute(List.of(input("ep-a", "2026-01-01T00:00:00Z")),
                List.of(card("ep-a", "ann", 5, 1), card("unresolved", "ann", 9, 3)), List.of(), a -> true,
                BingoScore.RankBy.LINES, 50, 3, NOW);

        assertEquals(1, series(history, "ann").points().size(),
                "an unresolved bingo's score is the podcaster's progress, not a result");
        assertEquals(List.of(new BingoDocs.LineCount(1, 1)), history.distribution());
    }

    @Test
    void measuresHowPredictableEachEpisodeWas() {
        var entries = List.of(
                entry("ep-a", "kraken", true), entry("ep-a", "kraken", true), entry("ep-a", "merch", false),
                entry("ep-a", "storm", false), entry("ep-a", "guest", true));

        var history = BingoHistory.compute(List.of(input("ep-a", "2026-01-01T00:00:00Z")),
                List.of(card("ep-a", "ann", 2, 0)), entries, a -> true, BingoScore.RankBy.LINES, 50, 3, NOW);

        assertEquals(4, history.episodes().get(0).candidates(), "distinct predictions, not entries");
        assertEquals(0.5, history.episodes().get(0).hitRate());
        assertEquals("ep-a", history.scopes().get("all").records().mostPredictable().slug());
    }

    @Test
    void capsTheSeriesAtTheBestCumulativeScores() {
        List<BingoDocs.CardResultRow> results = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            results.add(card("ep-a", "p" + i, i, i));
        }

        var history = BingoHistory.compute(List.of(input("ep-a", "2026-01-01T00:00:00Z")), results, List.of(),
                a -> true, BingoScore.RankBy.LINES, 3, 3, NOW);

        assertEquals(List.of("p5", "p4", "p3"),
                history.players().stream().map(BingoDocs.PlayerSeries::author).toList());
    }

    @Test
    void recordsNameListedPlayersOnly() {
        var episodes = List.of(input("e1", "2026-01-01T00:00:00Z"), input("e2", "2026-01-08T00:00:00Z"),
                input("e3", "2026-01-15T00:00:00Z"), input("e4", "2026-01-22T00:00:00Z"));
        var results = List.of(
                card("e1", "ann", 4, 1), card("e2", "ann", 4, 1), card("e3", "ann", 2, 0), card("e4", "ann", 5, 1),
                card("e1", "bob", 3, 1), card("e2", "bob", 3, 1), card("e3", "bob", 3, 1),
                card("e2", "hidden", 9, 8));

        var history = BingoHistory.compute(episodes, results, List.of(), a -> !a.equals("hidden"),
                BingoScore.RankBy.LINES, 50, 3, NOW);

        var records = history.scopes().get("all").records();
        assertEquals(new BingoDocs.CardRecord("ann", "e4", 5, 1, 9), records.bestCard(),
                "the opted-out player's 8-line card is nobody's record");
        assertEquals(new BingoDocs.PlayerCount("ann", 4), records.mostCards());
        assertEquals(new BingoDocs.PlayerCount("bob", 3), records.longestStreak(),
                "three bingos in a row with a line; ann's run broke at e3");
    }

    @Test
    void anEmptySiteHasAnEmptyHistory() {
        var history = BingoHistory.compute(List.of(), List.of(), List.of(), a -> true, BingoScore.RankBy.FIELDS,
                50, 3, NOW);

        assertTrue(history.episodes().isEmpty());
        assertNull(history.scopes().get("all").records().bestCard());
        assertEquals("fields", history.rankBy());
    }

    // ---------------------------------------------------------------- scopes: per season, per card

    @Test
    void ranksEachSeasonOnItsOwnAndByCardOnceAPlayerHasEnoughCards() {
        var episodes = List.of(input("s1e1", 1, "2026-01-01T00:00:00Z"), input("s1e2", 1, "2026-01-08T00:00:00Z"),
                input("s1e3", 1, "2026-01-15T00:00:00Z"), input("s2e1", 2, "2026-03-01T00:00:00Z"),
                input("s2e2", 2, "2026-03-08T00:00:00Z"));
        var results = List.of(
                card("s1e1", "veteran", 4, 1), card("s1e2", "veteran", 4, 1), card("s1e3", "veteran", 4, 1),
                card("s2e1", "veteran", 3, 0), card("s2e2", "veteran", 3, 0),
                card("s2e1", "newcomer", 6, 2), card("s2e2", "newcomer", 6, 2),
                card("s1e1", "oneshot", 9, 8));

        var history = BingoHistory.compute(episodes, results, List.of(), a -> true, BingoScore.RankBy.LINES, 50, 3, NOW);

        var all = history.scopes().get("all");
        assertEquals(List.of("oneshot", "newcomer", "veteran"),
                all.byTotal().stream().map(BingoDocs.StandingRow::author).toList());
        assertEquals(3, all.bar());
        assertEquals(List.of("veteran"), all.byAverage().stream().map(BingoDocs.AverageRow::author).toList(),
                "one lucky card, or two good ones, are not three");
        assertEquals(2, all.belowBar());
        assertEquals(0.6, all.byAverage().get(0).lines(), 0.001);

        var season2 = history.scopes().get("feed:2");
        assertEquals(2, season2.bar(), "a season of two bingos asks for both, not for three");
        assertEquals(List.of("newcomer", "veteran"),
                season2.byAverage().stream().map(BingoDocs.AverageRow::author).toList(),
                "who joined late leads where they played");
        assertEquals(2, season2.bingos());
        assertEquals("newcomer", season2.records().bestCard().author());
        assertEquals(new BingoDocs.PlayerCount("newcomer", 2), season2.records().longestStreak());
        assertEquals("oneshot", history.scopes().get("feed:1").records().bestCard().author());
        assertEquals(new BingoDocs.PlayerCount("veteran", 3), history.scopes().get("feed:1").records().longestStreak());
    }

    @Test
    void anybodyARankingNamesHasALineEvenPastTheCap() {
        var episodes = List.of(input("s1e1", 1, "2026-01-01T00:00:00Z"), input("s2e1", 2, "2026-03-01T00:00:00Z"));
        List<BingoDocs.CardResultRow> results = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            results.add(card("s1e1", "old" + i, 8, 5));
        }
        results.add(card("s2e1", "newcomer", 2, 1));

        var history = BingoHistory.compute(episodes, results, List.of(), a -> true, BingoScore.RankBy.LINES, 3, 3, NOW);

        assertTrue(history.players().stream().anyMatch(p -> p.author().equals("newcomer")),
                "first in season 2, so drawn, though far from the all-time top three");
    }

    // ---------------------------------------------------------------- published by the roll-up

    @Test
    void theRollUpPublishesResolvedPublicBingosOnly() {
        String quiet = "the-sample-cast-s01e09";
        String open = "the-sample-cast-s01e10";
        feeds = new FakeFeedAccess(Map.of(Scope.site(), List.of(EPISODE, quiet, open)))
                .withDisplay(EPISODE, published(true))
                .withDisplay(quiet, snapshot(EpisodePhase.PLANNED))
                .withDisplay(open, published(false));
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(), feeds,
                BingoSchemaFixture.schema()).withReadsAllUsers();
        for (String slug : List.of(EPISODE, quiet, open)) {
            ctx.store().put(Scope.episode(slug), BingoDocs.KEY_TEMPLATE, Map.of("size", 3));
            ctx.store().asUser(alice).put(Scope.user(), BingoDocs.CARD_PREFIX + slug, Map.of("entries", List.of("kraken")));
            ctx.store().asUser(bob).put(Scope.user(), BingoDocs.CARD_PREFIX + slug, Map.of("entries", List.of("kraken")));
        }
        seedPrefs(ctx, bob, false, true);
        for (String slug : List.of(EPISODE, quiet)) {
            ctx.store().put(Scope.episode(slug), BingoDocs.KEY_RESOLUTION, Map.of("hits", Map.of("kraken", true)));
            ctx.store().put(Scope.episode(slug), BingoDocs.KEY_CONTROL, Map.of("phase", "RESOLVED"));
        }

        new BingoPlugin(clock).register(ctx);

        var history = ctx.store().get(Scope.site(), BingoDocs.KEY_HISTORY, BingoDocs.History.class).orElseThrow();
        assertEquals(List.of(EPISODE), history.episodes().stream().map(BingoDocs.HistoryEpisode::slug).toList(),
                "the quiet one would announce itself; the open one is not settled");
        assertEquals(List.of(alice.toString()),
                history.players().stream().map(BingoDocs.PlayerSeries::author).toList());
        assertEquals(2, history.episodes().get(0).ranked());
        assertEquals(1.0, history.episodes().get(0).hitRate());
        assertTrue(List.of(BingoSchemaFixture.backendOwned()).contains(BingoDocs.KEY_HISTORY));
    }

    @Test
    void theCardBarComesFromTheSettingsAndAChangeRecomputes() {
        var config = new MapPluginConfig().with("minCardsPerCard", 1);
        var ctx = ctx(published(true), config);
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals(1, scopeAll(ctx).byAverage().size());
        String before = ctx.store().get(Scope.site(), BingoDocs.KEY_HISTORY, BingoDocs.History.class).orElseThrow()
                .computedAt();

        config.with("minCardsPerCard", 5);
        clock.advance(java.time.Duration.ofMinutes(1));
        plugin.tick();

        assertTrue(!before.equals(ctx.store().get(Scope.site(), BingoDocs.KEY_HISTORY, BingoDocs.History.class)
                .orElseThrow().computedAt()), "a changed bar is an input of the roll-up");

        assertEquals(1, scopeAll(ctx).bar(), "one bingo on the site, so one card is all there is to ask for");
        assertTrue(BingoSchemaFixture.manifest().path("config").path("minCardsPerCard").path("default").asInt() == 3);
    }

    private static BingoDocs.ScopeStats scopeAll(FakePluginContext ctx) {
        return ctx.store().get(Scope.site(), BingoDocs.KEY_HISTORY, BingoDocs.History.class).orElseThrow()
                .scopes().get("all");
    }

    // ---------------------------------------------------------------- fixtures

    private static BingoHistory.Input input(String slug, String publishedAt) {
        return input(slug, 1, publishedAt);
    }

    private static BingoHistory.Input input(String slug, int season, String publishedAt) {
        return new BingoHistory.Input(slug, null, "feed", season, null, Instant.parse(publishedAt));
    }

    private BingoDocs.CardResultRow card(String episode, String author, int fields, int lines) {
        return new BingoDocs.CardResultRow(++ids, episode, author, fields, lines, 9, true, NOW);
    }

    private BingoDocs.EntryRow entry(String episode, String canonical, boolean hit) {
        return new BingoDocs.EntryRow(++ids, episode, UUID.randomUUID().toString(), 0, canonical, canonical, hit,
                true, NOW);
    }

    private static BingoDocs.PlayerSeries series(BingoDocs.History history, String author) {
        return history.players().stream().filter(p -> p.author().equals(author)).findFirst().orElseThrow();
    }
}
