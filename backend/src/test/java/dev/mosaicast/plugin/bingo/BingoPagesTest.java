// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Role;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeLocales;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeUsers;
import dev.mosaicast.plugin.testkit.PageRouteProviderHarness;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The pages under {@code /p/bingo/}: which exist, and what a shared link to one says. */
class BingoPagesTest extends BingoTestSupport {

    private final String home = "e/" + EPISODE;

    @Test
    void servesTheSitePageAndPublicBingosAnd404sTheRest() {
        var plugin = resolved(published(true));

        var answers = new PageRouteProviderHarness(plugin).check("", home, "e/no-such-episode", "nonsense",
                home + "/u/" + alice, home + "/u/" + bob, home + "/x/" + alice);

        assertTrue(answers.servesRoot(), "the root is a route; answering false 404s the landing page");
        assertTrue(answers.serves(home));
        assertTrue(answers.serves(home + "/u/" + alice), "a published row is a shareable result");
        assertEquals(List.of("e/no-such-episode", "nonsense", home + "/u/" + bob, home + "/x/" + alice),
                answers.notFound(), "bob opted out, so there is no page for his result");
    }

    @Test
    void aQuietEpisodesBingoDoesNotExistToAVisitor() {
        var plugin = resolved(snapshot(EpisodePhase.PLANNED));

        assertFalse(plugin.hasRoute(home), "a 404 is the only answer that does not confirm the episode");
        assertTrue(plugin.metaFor(home).isEmpty());
        assertTrue(plugin.metaFor(home + "/u/" + alice).isEmpty());
    }

    @Test
    void beforeRegisterEveryPathRenders() {
        assertTrue(new BingoPlugin(clock).hasRoute("e/anything"));
        assertTrue(new BingoPlugin(clock).metaFor("e/anything").isEmpty());
    }

    @Test
    void aSharedResultNamesThePlayerAndTheScoreButNotWhatHappened() {
        var plugin = resolved(published(true));

        var meta = plugin.metaFor(home + "/u/" + alice).orElseThrow();

        assertEquals("Alice's bingo for “Episode 4”", meta.title());
        assertEquals("1 of 8 lines, 3 of 9 squares", meta.description());
        assertFalse(meta.description().contains("kraken"), "a link preview is read by people who have not listened");
        assertEquals("en", meta.locale());
    }

    @Test
    void aBingosCardSaysHowManyPlayedInTheSitesLanguage() {
        var ctx = resolvedCtx(published(true));
        ctx.withLocales(FakeLocales.englishOnly().withUi("en", "de").withDefault("de"));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        var meta = plugin.metaFor(home).orElseThrow();

        assertEquals("Bingo: Episode 4", meta.title());
        assertEquals("Aufgelöst: 2 Karte(n) gespielt. Sieh nach, wie sie abgeschnitten haben.", meta.description());
        assertEquals("de", meta.locale());
    }

    /** alice fills the top row and stays listed; bob opts out of the board. */
    @Test
    void aSeasonPageExistsOnceTheSeasonHasAVisibleBingo() {
        var plugin = resolved(new dev.mosaicast.plugin.api.DisplaySnapshot("Episode 4", "", "https://example/a.mp3",
                T0.minus(java.time.Duration.ofDays(1)), null, null, null, null, null, "", "the-cast", 2, 4,
                EpisodePhase.RELEASED, null));

        var answers = new PageRouteProviderHarness(plugin).check("season/2", "season/2/the-cast",
                "season/2/other-cast", "season/3", "season/x", "season", "season/2/the-cast/more");

        assertTrue(answers.serves("season/2"), "one feed has a season 2, so the short form is unambiguous");
        assertTrue(answers.serves("season/2/the-cast"));
        assertEquals(List.of("season/2/other-cast", "season/3", "season/x", "season", "season/2/the-cast/more"),
                answers.notFound());
        var stats = lastCtx.store().get(Scope.site(), BingoDocs.KEY_STATS, BingoDocs.Stats.class).orElseThrow();
        assertEquals("the-cast", stats.bingos().get(0).feed());
        assertEquals(2, stats.bingos().get(0).season());
    }

    @Test
    void aQuietSeasonHasNoPage() {
        var plugin = resolved(snapshot(EpisodePhase.PLANNED));
        assertEquals(List.of("season/1"), new PageRouteProviderHarness(plugin).check("season/1").notFound());
    }

    private FakePluginContext resolvedCtx(dev.mosaicast.plugin.api.DisplaySnapshot snapshot) {
        var ctx = ctx(snapshot);
        ctx.withUsers(new FakeUsers().withUser(alice, "Alice", Role.FAN));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("a", "b", "c", "kraken"));
        seedCard(ctx, bob, List.of("a"));
        seedPrefs(ctx, bob, false, true);
        resolve(ctx, Map.of("a", true, "b", true, "c", true, "kraken", false));
        control(ctx, "RESOLVED");
        return ctx;
    }

    private BingoPlugin resolved(dev.mosaicast.plugin.api.DisplaySnapshot snapshot) {
        var ctx = resolvedCtx(snapshot);
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lastCtx = ctx;
        return plugin;
    }

    private FakePluginContext lastCtx;

    @Test
    void theStatsDocumentListsPublicBingosAndLeavesQuietOnesOut() {
        resolved(published(true));
        var stats = lastCtx.store().get(Scope.site(), BingoDocs.KEY_STATS, BingoDocs.Stats.class).orElseThrow();
        assertEquals(List.of(new BingoDocs.BingoSummary(EPISODE, "Bingo", "RESOLVED", 2, 3, false, null, null)), stats.bingos());

        resolved(snapshot(EpisodePhase.PLANNED));
        stats = lastCtx.store().get(Scope.site(), BingoDocs.KEY_STATS, BingoDocs.Stats.class).orElseThrow();
        assertTrue(stats.bingos().isEmpty());
    }
}
