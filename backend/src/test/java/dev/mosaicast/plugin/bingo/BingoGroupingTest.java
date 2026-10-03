// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The candidate list after the freeze, and the podcaster's corrections to it: what one tick-off decides has
 * to keep applying to the same thing, and a correction has to reach cards that are already frozen.
 */
class BingoGroupingTest extends BingoTestSupport {

    @Test
    void aLateSpellingThatSortsFirstDoesNotOrphanADecision() {
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("Alex says damn it"));
        resolve(ctx, Map.of("alex says damn it", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        seedCard(ctx, bob, List.of("alex says damn"));
        plugin.tick();

        var candidates = candidates(ctx);
        assertEquals(List.of("alex says damn it"),
                candidates.items().stream().map(BingoFuzzy.Candidate::canonical).toList(),
                "the decided group keeps its name, so nothing new is waiting for a decision");
        assertEquals(1, rowFor(ctx, bob.toString()).fields(), "and the latecomer's same prediction scores");
    }

    @Test
    void aCardRewrittenAfterTheLockPutsNothingInTheCandidateList() {
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedShowcase(ctx, alice);
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();

        // Nothing can refuse a write to one's own partition; the tick must simply not read it any more.
        seedCard(ctx, alice, List.of("buy my mixtape"));
        plugin.tick();

        var labels = candidates(ctx).items().stream().map(BingoFuzzy.Candidate::label).toList();
        assertEquals(List.of("kraken"), labels);
        assertFalse(candidates(ctx).assignments().containsKey("buy my mixtape"));
        assertEquals("kraken", showcased(ctx).items().get(0).entries().get(0),
                "a featured card shows the record, not the scratchpad");
    }

    @Test
    void aMergeAfterTheLockRescoresFrozenCards() {
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedCard(ctx, bob, List.of("giant squid"));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();
        resolve(ctx, Map.of("kraken", true, "giant squid", false));
        control(ctx, "RESOLVED");
        plugin.tick();
        assertEquals(0, rowFor(ctx, bob.toString()).fields());

        pins(ctx, Map.of("giant squid", "kraken"));
        plugin.tick();

        assertEquals(1, rowFor(ctx, bob.toString()).fields(), "the merged group's decision now applies to him");
        assertEquals(List.of("kraken"),
                candidates(ctx).items().stream().map(BingoFuzzy.Candidate::canonical).toList());
        assertEquals(2, candidates(ctx).cards().get("kraken"));
    }

    @Test
    void aSplitLeavesTheSplitOffEntryWaitingForADecision() {
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("Alex says damn it"));
        seedCard(ctx, bob, List.of("alex says damn"));
        resolve(ctx, Map.of("alex says damn", true));
        control(ctx, "RESOLVED");
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals(1, rowFor(ctx, alice.toString()).fields());

        pins(ctx, Map.of("Alex says damn it", ""));
        plugin.tick();

        var canonicals = candidates(ctx).items().stream().map(BingoFuzzy.Candidate::canonical).toList();
        assertTrue(canonicals.containsAll(List.of("alex says damn", "alex says damn it")));
        assertEquals(0, rowFor(ctx, alice.toString()).fields(), "split off, and nobody has decided on it yet");
        assertEquals(1, rowFor(ctx, bob.toString()).fields());
    }

    @Test
    void theGroupingKeyIsTheBrowsersToWrite() {
        for (String owned : BingoSchemaFixture.backendOwned()) {
            assertFalse(BingoDocs.KEY_GROUPING.startsWith(owned.replace("*", "")) && !owned.equals("*")
                    && (owned.endsWith("*") || owned.equals(BingoDocs.KEY_GROUPING)),
                    "a podcaster's correction is an intent the browser writes; reserving it would 403 the UI");
        }
    }

    private void pins(FakePluginContext ctx, Map<String, String> pins) {
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_GROUPING,
                Map.of("pins", pins, "updatedAt", clock.instant().toString()));
    }

    private static BingoDocs.Candidates candidates(FakePluginContext ctx) {
        return ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_CANDIDATES, BingoDocs.Candidates.class)
                .orElseThrow();
    }
}
