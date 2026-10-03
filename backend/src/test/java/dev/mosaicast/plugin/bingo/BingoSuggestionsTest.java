// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Predictions people keep making, offered to the next player - and never one person's own words. */
class BingoSuggestionsTest extends BingoTestSupport {

    private final UUID carol = UUID.randomUUID();

    @Test
    void offersWhatSeveralPeoplePredictedAndNothingOnlyOnePersonWrote() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken", "merch plug", "my cat walks in"));
        seedCard(ctx, bob, List.of("Kraken!", "merch plug"));
        seedCard(ctx, carol, List.of("kraken"));

        new BingoPlugin(clock).register(ctx);

        var labels = suggestions(ctx).items().stream().map(BingoDocs.Suggestion::label).toList();
        assertEquals(List.of("Kraken!", "merch plug"), labels);
        assertFalse(labels.contains("my cat walks in"), "one person's own words are not published");
        assertEquals(3, suggestions(ctx).items().get(0).people());
    }

    @Test
    void leavesQuietEpisodesOut() {
        var ctx = ctx(snapshot(EpisodePhase.PLANNED));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("secret guest"));
        seedCard(ctx, bob, List.of("secret guest"));

        new BingoPlugin(clock).register(ctx);

        assertTrue(suggestions(ctx).items().isEmpty(), "a quiet episode's predictions would announce it");
    }

    @Test
    void countsWhereItCameTrue() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedCard(ctx, bob, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");

        new BingoPlugin(clock).register(ctx);

        assertEquals(new BingoDocs.Suggestion("kraken", 2, 1, 1), suggestions(ctx).items().get(0));
    }

    @Test
    void aPreferenceTheBackendDoesNotKnowIsIgnoredNotFatal() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        ctx.store().asUser(alice).put(Scope.user(), BingoDocs.KEY_PREFS,
                Map.of("listed", false, "showcasable", true, "suggestions", false, "updatedAt", "now"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");

        new BingoPlugin(clock).register(ctx);

        assertTrue(leaderboard(ctx).ranked().isEmpty(), "her opt-out still reads, next to a field it never knew");
    }

    @Test
    void theSuggestionsAreTheBackendsToWrite() {
        assertTrue(List.of(BingoSchemaFixture.backendOwned()).contains(BingoDocs.KEY_SUGGESTIONS));
    }

    private static BingoDocs.Suggestions suggestions(FakePluginContext ctx) {
        return ctx.store().get(Scope.site(), BingoDocs.KEY_SUGGESTIONS, BingoDocs.Suggestions.class).orElseThrow();
    }
}
