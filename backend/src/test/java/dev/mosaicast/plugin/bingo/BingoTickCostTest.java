// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * What a tick costs when nothing happened: a site with a back catalogue of finished bingos should not be
 * rewriting rows or recomputing its standings once a minute.
 */
class BingoTickCostTest extends BingoTestSupport {

    @Test
    void anUnchangedOpenCardKeepsItsRows() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken", "merch plug"));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        Set<Long> before = entryIds(ctx, alice.toString());

        plugin.tick();
        assertEquals(before, entryIds(ctx, alice.toString()), "same card, same rows: nothing to rewrite");

        seedCard(ctx, alice, List.of("kraken", "sponsor read"));
        plugin.tick();
        assertNotEquals(before, entryIds(ctx, alice.toString()), "an edit before the lock still lands");
        assertEquals(Set.of("kraken", "sponsor read"), texts(ctx, alice.toString()));
    }

    @Test
    void anUnchangedScoreKeepsItsResultRow() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        long before = resultId(ctx, alice.toString());

        plugin.tick();
        assertEquals(before, resultId(ctx, alice.toString()));

        resolve(ctx, Map.of("kraken", true));
        plugin.tick();
        assertNotEquals(before, resultId(ctx, alice.toString()), "a score that moved is recorded again");
    }

    @Test
    void theSiteRollUpWaitsForSomethingItIsComputedFrom() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        String first = stats(ctx).computedAt();

        clock.advance(Duration.ofMinutes(1));
        plugin.tick();
        assertEquals(first, stats(ctx).computedAt(), "nothing moved, so nothing was recomputed");

        seedPrefs(ctx, alice, false, true);
        clock.advance(Duration.ofMinutes(1));
        plugin.tick();
        String afterOptOut = stats(ctx).computedAt();
        assertNotEquals(first, afterOptOut, "who may be listed is an input");

        resolve(ctx, Map.of("kraken", true));
        clock.advance(Duration.ofMinutes(1));
        plugin.tick();
        String afterScore = stats(ctx).computedAt();
        assertNotEquals(afterOptOut, afterScore, "so is a score");

        clock.advance(BingoPlugin.ROLL_UP_REFRESH);
        plugin.tick();
        assertNotEquals(afterScore, stats(ctx).computedAt(), "and it is never older than the refresh period");
    }

    @Test
    void anEpisodeLeavingQuietRefreshesTheRollUp() {
        var ctx = ctx(snapshot(EpisodePhase.PLANNED));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals(0, stats(ctx).episodes(), "a quiet episode is nobody's business yet");

        feeds.withPhase(EPISODE, EpisodePhase.UPCOMING);
        clock.advance(Duration.ofMinutes(1));
        plugin.tick();
        assertEquals(1, stats(ctx).episodes(), "announced: its cards count from the next pass");
    }

    @Test
    void oneReadOfEveryCardServesEveryEpisode() {
        String other = "the-sample-cast-s01e05";
        var schema = BingoSchemaFixture.schema();
        feeds = new FakeFeedAccess(Map.of(Scope.site(), List.of(EPISODE, other)))
                .withDisplay(EPISODE, published(false))
                .withDisplay(other, published(false));
        var ctx = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(), feeds, schema)
                .withReadsAllUsers();
        seedTemplate(ctx);
        ctx.store().put(Scope.episode(other), BingoDocs.KEY_TEMPLATE, Map.of("size", 3));
        seedCard(ctx, alice, List.of("kraken"));
        ctx.store().asUser(alice).put(Scope.user(), BingoDocs.CARD_PREFIX + other, Map.of("entries", List.of("merch")));
        ctx.store().asUser(bob).put(Scope.user(), BingoDocs.CARD_PREFIX + other, Map.of("entries", List.of("guest")));

        new BingoPlugin(clock).register(ctx);

        assertEquals(Set.of("kraken"), texts(ctx, EPISODE, alice.toString()));
        assertEquals(Set.of("merch"), texts(ctx, other, alice.toString()));
        assertEquals(Set.of("guest"), texts(ctx, other, bob.toString()));
        assertEquals(Set.of(), texts(ctx, EPISODE, bob.toString()));
    }

    private static Set<Long> entryIds(FakePluginContext ctx, String author) {
        return rows(ctx, EPISODE, author).stream().map(BingoDocs.EntryRow::id).collect(Collectors.toSet());
    }

    private static Set<String> texts(FakePluginContext ctx, String author) {
        return texts(ctx, EPISODE, author);
    }

    private static Set<String> texts(FakePluginContext ctx, String episode, String author) {
        return rows(ctx, episode, author).stream().map(BingoDocs.EntryRow::text).collect(Collectors.toSet());
    }

    private static List<BingoDocs.EntryRow> rows(FakePluginContext ctx, String episode, String author) {
        return ctx.schema().select(BingoDocs.ENTITY_ENTRY, BingoDocs.byCard(episode, author),
                BingoDocs.EntryRow.class);
    }

    private static long resultId(FakePluginContext ctx, String author) {
        return ctx.schema().select(BingoDocs.ENTITY_CARD_RESULT,
                        Criteria.where("author", Criteria.Op.EQ, author), BingoDocs.CardResultRow.class)
                .get(0).id();
    }
}
