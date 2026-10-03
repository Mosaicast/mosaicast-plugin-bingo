// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Shared fixtures for the backend tests, against the SDK test kit — no core, no Postgres, no browser.
 *
 * <p>{@code FakePluginContext} runs scheduled tasks synchronously and immediately, so {@code register}
 * alone exercises a whole tick. {@code InMemoryDocStore.asUser(...)} stands in for the browser, which is
 * the only thing that can ever write a {@code USER} partition — there is no production counterpart, and
 * that absence is the security property the design leans on.
 */
abstract class BingoTestSupport {

    static final String EPISODE = "the-sample-cast-s01e04";
    static final Instant T0 = Instant.parse("2026-09-03T10:00:00Z");

    final MovableClock clock = new MovableClock(T0);
    final UUID alice = UUID.randomUUID();
    final UUID bob = UUID.randomUUID();
    FakeFeedAccess feeds;

    // ---------------------------------------------------------------- fixtures

    FakePluginContext ctx(DisplaySnapshot snapshot) {
        return ctx(snapshot, new MapPluginConfig());
    }

    FakePluginContext ctx(DisplaySnapshot snapshot, MapPluginConfig config) {
        FakeSchemaStore schema = BingoSchemaFixture.schema();
        feeds = new FakeFeedAccess(Map.of(Scope.site(), List.of(EPISODE))).withDisplay(EPISODE, snapshot);
        return new FakePluginContext(new InMemoryDocStore(), config, feeds, schema).withReadsAllUsers();
    }

    /** The episode goes out: the host now says it is released. */
    void release() {
        feeds.withPhase(EPISODE, EpisodePhase.RELEASED);
    }

    /** Announced and waiting for the feed ({@code UPCOMING}), or already out ({@code RELEASED}). */
    static DisplaySnapshot published(boolean isPublished) {
        return snapshot(isPublished ? EpisodePhase.RELEASED : EpisodePhase.UPCOMING);
    }

    /**
     * The episode as the host hands it over in a given phase. Only a released one has audio and a date, but
     * nothing here reads either: the phase alone says where the episode stands.
     */
    static DisplaySnapshot snapshot(EpisodePhase phase) {
        boolean out = phase == EpisodePhase.RELEASED || phase == EpisodePhase.WITHDRAWN;
        return new DisplaySnapshot("Episode 4", "", out ? "https://example/a.mp3" : null,
                out ? T0.minus(Duration.ofDays(1)) : null, null, null, null, null, null, "",
                null, null, null, phase, null);
    }

    /**
     * Two cards on a 3x3 with no free centre, chosen so the two ways of ranking disagree.
     *
     * <p>alice fills the top row: one line, three fields. bob scatters four hits over squares 3, 5, 6 and 8,
     * which touch no row, column or diagonal: no lines, four fields.
     */
    static final List<String> LINE_CARD =
            List.of("a", "b", "c", "x1", "x2", "x3", "x4", "x5", "x6");
    static final List<String> SCATTER_CARD =
            List.of("y1", "y2", "y3", "a", "y4", "b", "c", "y5", "d");
    static final Map<String, Boolean> HITS =
            Map.of("a", true, "b", true, "c", true, "d", true);

    void seedPlainTemplate(FakePluginContext ctx) {
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE,
                Map.of("size", 3, "title", "Bingo", "freeCentre", false));
    }

    /** A 3x3 that asks for the free middle square. Absent, the square is one more thing to fill in. */
    void seedTemplate(FakePluginContext ctx) {
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE,
                Map.of("size", 3, "title", "Bingo", "freeCentre", true));
    }

    /** As the browser would: a person's own card, written into their own partition, by them. */
    void seedCard(FakePluginContext ctx, UUID user, List<String> entries) {
        ctx.store().asUser(user).put(Scope.user(), BingoDocs.CARD_PREFIX + EPISODE,
                Map.of("entries", entries));
    }

    /** How somebody wants to appear. Their own partition, so only they can write it. */
    void seedPrefs(FakePluginContext ctx, UUID user, boolean listed, boolean showcasable) {
        ctx.store().asUser(user).put(Scope.user(), BingoDocs.KEY_PREFS,
                Map.of("listed", listed, "showcasable", showcasable));
    }

    /** The podcaster's pick of whose card to feature. */
    void seedShowcase(FakePluginContext ctx, UUID... users) {
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_SHOWCASE,
                Map.of("userIds", java.util.Arrays.stream(users).map(UUID::toString).toList()));
    }

    void resolve(FakePluginContext ctx, Map<String, Boolean> hits) {
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_RESOLUTION, Map.of("hits", hits));
    }

    void control(FakePluginContext ctx, String phase) {
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_CONTROL,
                Map.of("phase", phase, "updatedAt", clock.instant().toString()));
    }

    void lock(FakePluginContext ctx) {
        control(ctx, "LOCKED");
    }

    java.util.Optional<BingoDocs.PhaseState> phase(FakePluginContext ctx) {
        return ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_PHASE, BingoDocs.PhaseState.class);
    }

    BingoDocs.Leaderboard leaderboard(FakePluginContext ctx) {
        return ctx.store()
                .get(Scope.episode(EPISODE), BingoDocs.KEY_LEADERBOARD, BingoDocs.Leaderboard.class)
                .orElseThrow();
    }

    BingoDocs.Participants participants(FakePluginContext ctx) {
        return ctx.store()
                .get(Scope.episode(EPISODE), BingoDocs.KEY_PARTICIPANTS, BingoDocs.Participants.class)
                .orElseThrow();
    }

    BingoDocs.Showcased showcased(FakePluginContext ctx) {
        return ctx.store()
                .get(Scope.episode(EPISODE), BingoDocs.KEY_SHOWCASED, BingoDocs.Showcased.class)
                .orElseThrow();
    }

    BingoDocs.Stats stats(FakePluginContext ctx) {
        return ctx.store().get(Scope.site(), BingoDocs.KEY_STATS, BingoDocs.Stats.class).orElseThrow();
    }

    long entryCount(FakePluginContext ctx, String author) {
        return ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                dev.mosaicast.plugin.api.Criteria.where("author",
                        dev.mosaicast.plugin.api.Criteria.Op.EQ, author));
    }

    /** Whether the frozen row counts towards the board, independent of whether the board is published. */
    boolean rankedInSchema(FakePluginContext ctx, String author) {
        return ctx.schema().select(BingoDocs.ENTITY_CARD_RESULT,
                        dev.mosaicast.plugin.api.Criteria.where("author",
                                dev.mosaicast.plugin.api.Criteria.Op.EQ, author),
                        BingoDocs.CardResultRow.class)
                .get(0).ranked();
    }

    BingoDocs.Row rowFor(FakePluginContext ctx, String author) {
        var board = leaderboard(ctx);
        return java.util.stream.Stream.concat(board.ranked().stream(), board.late().stream())
                .filter(r -> r.author().equals(author))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no leaderboard row for " + author));
    }

    /** The archive transition is the one behaviour that cannot be tested without moving time. */
    static final class MovableClock extends Clock {
        private Instant now;

        private MovableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration by) {
            now = now.plus(by);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
