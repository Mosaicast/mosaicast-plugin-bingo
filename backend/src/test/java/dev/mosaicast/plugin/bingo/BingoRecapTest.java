// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The few lines that say what happened in a bingo - and nothing at all before it is resolved. */
class BingoRecapTest extends BingoTestSupport {

    private final UUID carol = UUID.randomUUID();

    @Test
    void saysNothingBeforeTheResolution() {
        var ctx = played();
        resolve(ctx, Map.of("kraken", true)); // ticked off, but not resolved yet
        new BingoPlugin(clock).register(ctx);

        var recap = recap(ctx);
        assertFalse(recap.published(), "the most predicted thing coming true is the spoiler");
        assertNull(recap.mostPredicted());
        assertEquals(3, recap.players(), "how many played is worth saying early, as on the board");
    }

    @Test
    void namesTheMostPredictedTheRarestHitAndTheBiggestMiss() {
        var ctx = played();
        resolve(ctx, Map.of("kraken", true, "merch plug", false, "guest is late", true));
        control(ctx, "RESOLVED");
        new BingoPlugin(clock).register(ctx);

        var recap = recap(ctx);
        assertTrue(recap.published());
        assertEquals(new BingoDocs.Highlight("Kraken!", 3, true), recap.mostPredicted(), "named as first spelled");
        assertEquals(new BingoDocs.Highlight("guest is late", 1, true), recap.rarestHit());
        assertEquals(new BingoDocs.Highlight("merch plug", 2, false), recap.biggestMiss());
        assertEquals(3, recap.ranked());
        // alice: kraken + guest + free centre = 3; bob: kraken + centre = 2; carol: kraken + centre = 2.
        assertEquals(2.33, recap.avgFields());
    }

    @Test
    void goesQuietAgainWhenReopened() {
        var ctx = played();
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertTrue(recap(ctx).published());

        control(ctx, "OPEN");
        plugin.tick();

        assertFalse(recap(ctx).published());
    }

    @Test
    void theRecapIsTheBackendsToWrite() {
        assertTrue(List.of(BingoSchemaFixture.backendOwned()).contains(BingoDocs.KEY_RECAP));
    }

    /** Three cards: kraken on all three, merch plug on two, guest only on alice's. */
    private FakePluginContext played() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken", "merch plug", "guest is late"));
        seedCard(ctx, bob, List.of("Kraken!", "merch plug"));
        seedCard(ctx, carol, List.of("kraken"));
        return ctx;
    }

    private static BingoDocs.Recap recap(FakePluginContext ctx) {
        return ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_RECAP, BingoDocs.Recap.class).orElseThrow();
    }
}
