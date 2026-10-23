// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.ActionRejectedException;
import dev.mosaicast.plugin.api.Caller;
import dev.mosaicast.plugin.api.Channel;
import dev.mosaicast.plugin.api.ChannelRef;
import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Role;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.testkit.Callers;
import dev.mosaicast.plugin.testkit.ChannelEvent;
import dev.mosaicast.plugin.testkit.FakeNotifier;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSubscription;
import dev.mosaicast.plugin.testkit.FakeUsers;
import dev.mosaicast.plugin.testkit.SubscriptionRefusedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Draft rounds through the host's surfaces: actions, channels, timers, the store, and the tick. */
class BingoDraftsTest extends BingoTestSupport {

    final UUID host = UUID.randomUUID();
    final UUID carol = UUID.randomUUID();
    FakePluginContext ctx;
    FakeNotifier notifier;
    FakeUsers users;
    BingoPlugin plugin;

    Caller hostCaller() {
        return Callers.podcaster(host);
    }

    @BeforeEach
    void setUp() {
        start(published(false));
    }

    void start(dev.mosaicast.plugin.api.DisplaySnapshot snapshot) {
        ctx = ctx(snapshot).withActions(BingoDrafts.ACTIONS.toArray(String[]::new)).withChannels();
        // The per-name floors as plugin.json declares them, so a test calls through the same gate the host is.
        BingoSchemaFixture.manifest().get("actions").get("names").properties().forEach(e -> {
            if (e.getValue().has("callableBy")) {
                ctx.actions().withNameFloor(e.getKey(),
                        Role.valueOf(e.getValue().get("callableBy").asString().toUpperCase(java.util.Locale.ROOT)));
            }
        });
        users = new FakeUsers()
                .withUser(host, "Host", Role.PODCASTER)
                .withUser(alice, "Alice", Role.FAN)
                .withUser(bob, "Bob", Role.FAN)
                .withUser(carol, "Carol", Role.PODCASTER);
        ctx.withUsers(users);
        notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);
        seedPlainTemplate(ctx);
        // People the plugin knows: they have something of their own in a partition.
        for (UUID u : List.of(alice, bob, carol)) {
            seedPrefs(ctx, u, true, true);
        }
        plugin = new BingoPlugin(new CtxClock(ctx));
        plugin.register(ctx);
    }

    // ---------------------------------------------------------------- helpers

    JsonNode call(Caller caller, String action, Object payload) {
        Scope scope = action.equals("draft-create") ? Scope.episode(EPISODE) : Scope.site();
        return ctx.actions().call(caller, action, scope, payload);
    }

    String rejected(Caller caller, String action, Object payload) {
        return assertThrows(ActionRejectedException.class, () -> call(caller, action, payload)).code();
    }

    String create() {
        return call(hostCaller(), "draft-create", null).get("id").asString();
    }

    /** A round with the host, Alice and Bob joined, in that order, on the given clock. */
    String lobbyWithPlayers(Map<String, Object> settings) {
        String id = create();
        call(hostCaller(), "draft-invite", Map.of("id", id, "userIds", List.of(alice.toString(), bob.toString())));
        call(Callers.fan(alice), "draft-join", Map.of("id", id));
        call(Callers.fan(bob), "draft-join", Map.of("id", id));
        call(hostCaller(), "draft-setup", Map.of("id", id, "settings", settings));
        return id;
    }

    static Map<String, Object> untimed() {
        return Map.of("clock", false, "duplicateCheck", true);
    }

    JsonNode state(Caller caller, String id) {
        return call(caller, "draft-state", Map.of("id", id));
    }

    String current(String id) {
        return state(hostCaller(), id).get("game").get("current").asString();
    }

    Caller as(String userId) {
        UUID id = UUID.fromString(userId);
        return id.equals(host) ? hostCaller() : Callers.fan(id);
    }

    /** Plays the whole round, each player writing their own name and a number into the first empty square. */
    void playOut(String id) {
        int n = 0;
        while (state(hostCaller(), id).get("status").asString().equals("RUNNING")) {
            String who = current(id);
            JsonNode seats = state(hostCaller(), id).get("game").get("seats");
            int cell = -1;
            for (JsonNode seat : seats) {
                if (seat.get("userId").asString().equals(who)) {
                    for (int i = 0; i < seat.get("cells").size(); i++) {
                        if (seat.get("cells").get(i).asString().isEmpty()) {
                            cell = i;
                            break;
                        }
                    }
                }
            }
            call(as(who), "draft-move", Map.of("id", id, "cell", cell, "text", "p" + who.substring(0, 4) + " " + n++));
        }
    }

    // ---------------------------------------------------------------- tests

    @Test
    void onlyAPodcasterStartsARoundAndOnlyItsHostRunsIt() {
        assertThrows(IllegalStateException.class, () -> call(Callers.fan(alice), "draft-create", null),
                "the host's floor: a fan never reaches the handler");
        String id = create();
        assertEquals("not-host", rejected(Callers.podcaster(carol), "draft-start", Map.of("id", id)));
        assertEquals("too-few", rejected(hostCaller(), "draft-start", Map.of("id", id)));
    }

    @Test
    void aRoundNeedsAnOpenBingo() {
        lock(ctx);
        plugin.tick();
        assertEquals("closed", rejected(hostCaller(), "draft-create", null));
    }

    @Test
    void anInviteRingsTheBellAndTheLiveInbox() {
        String id = create();
        ChannelRef inbox = new ChannelRef(Scope.site(), BingoDrafts.CHANNEL_INBOX);
        FakeSubscription aliceInbox = ctx.channels().subscribe(Callers.fan(alice), inbox);

        call(hostCaller(), "draft-invite", Map.of("id", id, "userIds", List.of(alice.toString())));

        assertEquals(1, notifier.messagesFor(alice).size());
        assertTrue(notifier.messagesFor(alice).get(0).textFor("en").startsWith("Host invited you"));
        assertEquals("/p/bingo/draft/" + id, notifier.messagesFor(alice).get(0).link());
        assertEquals(List.of("invited"), aliceInbox.events().stream().map(ChannelEvent::event).toList());

        JsonNode mine = call(Callers.fan(alice), "draft-inbox", null).get("items");
        assertEquals(1, mine.size());
        assertEquals("invited", mine.get(0).get("role").asString());
        assertEquals(0, call(Callers.fan(bob), "draft-inbox", null).get("items").size(),
                "nobody sees a round they were never asked to");
    }

    @Test
    void thePickerOffersKnownPlayersWithoutACardThere() {
        seedCard(ctx, bob, LINE_CARD);
        String id = create();
        JsonNode ids = call(hostCaller(), "draft-players", Map.of("id", id)).get("userIds");
        List<String> offered = new ArrayList<>();
        ids.forEach(n -> offered.add(n.asString()));
        assertTrue(offered.contains(alice.toString()));
        assertFalse(offered.contains(bob.toString()), "Bob already has a card on the episode");
    }

    @Test
    void somebodyWithACardCannotJoin() {
        seedCard(ctx, bob, LINE_CARD);
        String id = create();
        String code = state(hostCaller(), id).get("code").asString();
        assertEquals("has-card", rejected(Callers.fan(bob), "draft-join", Map.of("id", id, "code", code)));
    }

    @Test
    void theLinkLetsAnyoneJoinAndOnlyTheHostSeesIt() {
        String id = create();
        assertEquals("not-invited", rejected(Callers.fan(alice), "draft-join", Map.of("id", id)));
        JsonNode hostView = state(hostCaller(), id);
        String code = hostView.get("code").asString();

        JsonNode preview = call(Callers.fan(alice), "draft-state", Map.of("id", id, "code", code));
        assertTrue(preview.get("preview").asBoolean());

        call(Callers.fan(alice), "draft-join", Map.of("id", id, "code", code));
        JsonNode aliceView = state(Callers.fan(alice), id);
        assertFalse(aliceView.has("code"), "a player never gets the code");
        assertEquals(id, ctx.store().asUser(alice)
                .get(Scope.user(), BingoDocs.SEAT_PREFIX + EPISODE, BingoDrafts.Seat.class).orElseThrow().draftId());
    }

    @Test
    void aQuietEpisodeTakesOnlyPodcastersAndNamesNoEpisodeToAFan() {
        start(snapshot(EpisodePhase.PLANNED));
        String id = create();
        JsonNode offered = call(hostCaller(), "draft-players", Map.of("id", id)).get("userIds");
        assertEquals(1, offered.size());
        assertEquals(carol.toString(), offered.get(0).asString());

        String code = state(hostCaller(), id).get("code").asString();
        assertEquals("quiet", rejected(Callers.fan(alice), "draft-join", Map.of("id", id, "code", code)));
        JsonNode preview = call(Callers.fan(alice), "draft-state", Map.of("id", id, "code", code));
        assertFalse(preview.has("episode"));
        call(Callers.podcaster(carol), "draft-join", Map.of("id", id, "code", code));
    }

    @Test
    void onlyMembersListenToARound() {
        String id = lobbyWithPlayers(untimed());
        ChannelRef ref = new ChannelRef(Scope.site(), BingoDrafts.CHANNEL_PREFIX + id);
        ctx.channels().subscribe(Callers.fan(alice), ref);
        assertThrows(SubscriptionRefusedException.class,
                () -> ctx.channels().subscribe(Callers.fan(UUID.randomUUID()), ref));
    }

    @Test
    void everyMoveIsOneEventWithItsVersionAndSquare() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        ChannelRef ref = new ChannelRef(Scope.site(), BingoDrafts.CHANNEL_PREFIX + id);
        int before = ctx.channels().published(ref).size();
        long version = state(hostCaller(), id).get("version").asLong();

        call(hostCaller(), "draft-move", Map.of("id", id, "cell", 2, "text", "rain"));

        List<ChannelEvent> events = ctx.channels().published(ref);
        assertEquals(before + 1, events.size());
        JsonNode update = events.get(events.size() - 1).data();
        assertEquals(version + 1, update.get("version").asLong());
        assertEquals("rain", update.get("written").get("text").asString());
        assertEquals(2, update.get("written").get("cell").asInt());
        assertFalse(update.get("game").get("seats").get(0).has("cells"), "the cards travel only through state");
        assertEquals("not-your-turn",
                rejected(hostCaller(), "draft-move", Map.of("id", id, "cell", 3, "text", "sun")));
    }

    @Test
    void anEventStaysUnderTheCapWithEightFullCards() {
        String id = create();
        List<UUID> players = new ArrayList<>();
        for (int i = 0; i < 7; i++) {
            UUID u = UUID.randomUUID();
            players.add(u);
            seedPrefs(ctx, u, true, true);
        }
        call(hostCaller(), "draft-invite", Map.of("id", id, "userIds", players.stream().map(UUID::toString).toList()));
        players.forEach(u -> call(Callers.fan(u), "draft-join", Map.of("id", id)));
        Map<String, Object> settings = Map.of("clock", false, "duplicateCheck", false);
        call(hostCaller(), "draft-setup", Map.of("id", id, "settings", settings));
        call(hostCaller(), "draft-start", Map.of("id", id));
        String longText = "x".repeat(BingoDraft.MAX_TEXT - 4);
        int n = 0;
        while (state(hostCaller(), id).get("status").asString().equals("RUNNING")) {
            String who = current(id);
            JsonNode seat = null;
            for (JsonNode s : state(hostCaller(), id).get("game").get("seats")) {
                if (s.get("userId").asString().equals(who)) {
                    seat = s;
                }
            }
            int cell = 0;
            while (!seat.get("cells").get(cell).asString().isEmpty()) {
                cell++;
            }
            call(as(who), "draft-move", Map.of("id", id, "cell", cell, "text", longText + n++));
        }
        ChannelRef ref = new ChannelRef(Scope.site(), BingoDrafts.CHANNEL_PREFIX + id);
        for (ChannelEvent e : ctx.channels().published(ref)) {
            assertTrue(e.data().toString().getBytes(StandardCharsets.UTF_8).length < Channel.MAX_EVENT_BYTES);
        }
    }

    @Test
    void theTurnClockRunsOnATimer() {
        String id = lobbyWithPlayers(Map.of("clock", true, "turnSeconds", 10, "duplicateCheck", true));
        call(hostCaller(), "draft-start", Map.of("id", id));
        assertEquals(host.toString(), current(id));
        ctx.advanceTimers(Duration.ofSeconds(10));
        assertEquals(alice.toString(), current(id), "the host's turn ran out");
        JsonNode hostSeat = state(hostCaller(), id).get("game").get("seats").get(0);
        assertEquals(1, hostSeat.get("skipped").asInt());
    }

    @Test
    void aRestartReArmsARunningRound() {
        String id = lobbyWithPlayers(Map.of("clock", true, "turnSeconds", 10, "duplicateCheck", true));
        call(hostCaller(), "draft-start", Map.of("id", id));
        ctx.advanceTimers(Duration.ofSeconds(4));

        // A new backend on the same store: its memory is empty, the round is not.
        BingoPlugin restarted = new BingoPlugin(new CtxClock(ctx));
        FakePluginContext fresh = ctx;
        restarted.register(fresh);
        ctx.advanceTimers(Duration.ofSeconds(9));
        assertEquals(host.toString(), current(id), "the turn started over at the restart");
        ctx.advanceTimers(Duration.ofSeconds(1));
        assertEquals(alice.toString(), current(id));
    }

    @Test
    void aDuplicateGoesToAVote() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        call(hostCaller(), "draft-move", Map.of("id", id, "cell", 0, "text", "It rains"));
        JsonNode view = call(Callers.fan(alice), "draft-move", Map.of("id", id, "cell", 0, "text", "it rains!"));
        JsonNode vote = view.get("game").get("vote");
        assertEquals(alice.toString(), vote.get("by").asString());
        assertEquals("not-a-voter", rejected(Callers.fan(alice), "draft-vote", Map.of("id", id, "allow", true)));
        call(hostCaller(), "draft-vote", Map.of("id", id, "allow", true));
        call(Callers.fan(bob), "draft-vote", Map.of("id", id, "allow", true));
        assertEquals(bob.toString(), current(id));
    }

    @Test
    void aFinishedRoundBecomesRankedCardsOverAnyPartitionCard() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        // Alice writes a card of her own in another tab; the round is what counts.
        seedCard(ctx, alice, LINE_CARD);
        playOut(id);
        assertEquals("FINISHED", state(hostCaller(), id).get("status").asString());

        plugin.tick();
        assertEquals(9, entryCount(ctx, alice.toString()));
        assertEquals(9, entryCount(ctx, host.toString()));
        assertTrue(rankedInSchema(ctx, alice.toString()));
        long fromPartition = ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                dev.mosaicast.plugin.api.Criteria.where("text", dev.mosaicast.plugin.api.Criteria.Op.EQ, "a"));
        assertEquals(0, fromPartition, "the partition card is never read");
    }

    @Test
    void aPartitionCardIsIgnoredWhileTheRoundRuns() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        seedCard(ctx, alice, LINE_CARD);
        plugin.tick();
        assertEquals(0, entryCount(ctx, alice.toString()));
    }

    @Test
    void aCancelledRoundRecordsNothing() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        call(hostCaller(), "draft-move", Map.of("id", id, "cell", 0, "text", "rain"));
        call(hostCaller(), "draft-cancel", Map.of("id", id));
        plugin.tick();
        assertEquals(0, entryCount(ctx, host.toString()));
        assertEquals(0, ctx.pendingTimers());
    }

    @Test
    void erasureTakesAPlayerOutOfTheRound() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        plugin.eraseUser(host.toString());
        JsonNode view = call(Callers.admin(), "draft-state", Map.of("id", id));
        assertEquals(alice.toString(), view.get("game").get("current").asString());
        assertTrue(view.get("host").asString().startsWith("erased:"));
    }

    @Test
    void theRoundsPagesExistAndTheirCardNamesNobody() {
        String id = create();
        assertTrue(plugin.hasRoute("draft"));
        assertTrue(plugin.hasRoute("draft/" + id));
        assertFalse(plugin.hasRoute("draft/" + UUID.randomUUID()));
        assertFalse(plugin.hasRoute("draft/not-a-uuid"));
        var meta = plugin.metaFor("draft/" + id).orElseThrow();
        assertFalse(meta.title().contains("Episode"));
        assertFalse(meta.description().contains("Host"));
    }

    @Test
    void theHostGetsASeatWhilePlayingAndLosesItWhenNot() {
        String id = create();
        var seat = ctx.store().asUser(host).get(Scope.user(), BingoDocs.SEAT_PREFIX + EPISODE, BingoDrafts.Seat.class);
        assertEquals(id, seat.orElseThrow().draftId(), "the host plays by default, so their tile shows the round");
        call(hostCaller(), "draft-setup", Map.of("id", id, "hostPlays", false));
        assertTrue(ctx.store().asUser(host).get(Scope.user(), BingoDocs.SEAT_PREFIX + EPISODE, BingoDrafts.Seat.class)
                .isEmpty());
    }

    @Test
    void aFinishedRoundStaysUntilPredictionsCloseAndThenGoes() {
        String id = lobbyWithPlayers(untimed());
        call(hostCaller(), "draft-start", Map.of("id", id));
        playOut(id);
        ctx.advanceTimers(BingoDrafts.KEEP_ENDED.plusDays(1));
        plugin.tick();
        assertTrue(plugin.hasRoute("draft/" + id), "still open: the round is what the cards are read from");

        lock(ctx);
        plugin.tick();
        plugin.tick();
        assertFalse(plugin.hasRoute("draft/" + id));
        assertEquals(9, entryCount(ctx, alice.toString()), "the rows are the record now");
    }

    @Test
    void everyHandlerIsDeclaredAndEveryDeclarationHandled() {
        assertEquals(new java.util.TreeSet<>(BingoDrafts.ACTIONS), new java.util.TreeSet<>(ctx.actions().handled()));
        JsonNode names = BingoSchemaFixture.manifest().get("actions").get("names");
        List<String> declared = new ArrayList<>();
        names.propertyNames().forEach(declared::add);
        assertEquals(new java.util.TreeSet<>(BingoDrafts.ACTIONS), new java.util.TreeSet<>(declared));
    }

    /** The plugin's clock, read off the test kit's timer clock so deadlines and timers agree. */
    static final class CtxClock extends Clock {
        private final FakePluginContext ctx;

        CtxClock(FakePluginContext ctx) {
            this.ctx = ctx;
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
            return ctx.now();
        }
    }
}
