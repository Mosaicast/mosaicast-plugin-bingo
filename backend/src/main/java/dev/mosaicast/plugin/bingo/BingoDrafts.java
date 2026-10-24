// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.ActionCall;
import dev.mosaicast.plugin.api.ActionHandler;
import dev.mosaicast.plugin.api.ActionRejectedException;
import dev.mosaicast.plugin.api.Actions;
import dev.mosaicast.plugin.api.Caller;
import dev.mosaicast.plugin.api.Channel;
import dev.mosaicast.plugin.api.ChannelRef;
import dev.mosaicast.plugin.api.Channels;
import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.CrossUserStore;
import dev.mosaicast.plugin.api.DocEntry;
import dev.mosaicast.plugin.api.NotificationException;
import dev.mosaicast.plugin.api.Notifier;
import dev.mosaicast.plugin.api.NotifyMessage;
import dev.mosaicast.plugin.api.OwnedDocEntry;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.Role;
import dev.mosaicast.plugin.api.Scheduled;
import dev.mosaicast.plugin.api.SchemaStore;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.api.ScopeType;
import dev.mosaicast.plugin.api.UserRef;
import dev.mosaicast.plugin.api.Users;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.DoubleSupplier;
import java.util.function.Function;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * Draft rounds, wired to the host: actions, channels, timers, and the store as the truth.
 *
 * <p><strong>The store is the truth, memory a cache of nothing.</strong> Every call loads the round from its
 * {@code draft:<id>} document (site scope, {@code data.backendPrivate}, so no browser reads it raw), changes it
 * through {@link BingoDraft}, saves it with a new version and publishes what changed. A lock per round keeps
 * two calls from applying to the same version. A {@link ReentrantLock}, never {@code synchronized}: handlers,
 * timers and channel callbacks run concurrently on virtual threads (see {@link BingoPlugin#passLock}).
 *
 * <p><strong>Events are deltas.</strong> One {@code update} per version, carrying everything but the cards
 * plus the one square written, if any, so an event stays far below {@code Channel.MAX_EVENT_BYTES} with eight
 * full cards. A browser that sees a version gap, or is told to reset, fetches the whole round through
 * {@code draft-state}.
 *
 * <p><strong>Timers are memory.</strong> One per running round, for the turn or the vote. A restart drops
 * them, so {@link #register} re-arms every running round, restarting the turn in progress.
 */
final class BingoDrafts {

    static final String CHANNEL_INBOX = "inbox";
    static final String CHANNEL_PREFIX = "draft:";
    /** How long a finished or cancelled round is kept, for the list and the tick. */
    static final Duration KEEP_ENDED = Duration.ofDays(30);
    /** A lobby nobody started is dropped after this. */
    static final Duration KEEP_LOBBY = Duration.ofDays(14);
    /** How many people the invite picker is offered at most. */
    static final int MAX_CANDIDATES = 1000;

    static final List<String> ACTIONS = List.of("draft-create", "draft-setup", "draft-players", "draft-invite",
            "draft-start", "draft-cancel", "draft-end", "draft-join", "draft-decline", "draft-state",
            "draft-move", "draft-vote", "draft-inbox");

    private static final SecureRandom RANDOM = new SecureRandom();

    private final PluginContext ctx;
    private final Clock clock;
    private final CrossUserStore everyone;
    private final BingoLifecycle lifecycle;
    private final DoubleSupplier threshold;
    private final Map<String, ReentrantLock> locks = new ConcurrentHashMap<>();
    private final Map<String, Scheduled> timers = new ConcurrentHashMap<>();

    BingoDrafts(PluginContext ctx, Clock clock, CrossUserStore everyone, BingoLifecycle lifecycle,
                DoubleSupplier threshold) {
        this.ctx = ctx;
        this.clock = clock;
        this.everyone = everyone;
        this.lifecycle = lifecycle;
        this.threshold = threshold;
    }

    // ---------------------------------------------------------------- payloads

    record CreateRequest(Boolean hostPlays) {}

    record RoundRequest(String id, String code) {}

    record SetupRequest(String id, BingoDraft.Settings settings, Boolean hostPlays, List<String> order) {}

    record InviteRequest(String id, List<String> userIds) {}

    record MoveRequest(String id, Integer cell, String text) {}

    record VoteRequest(String id, Boolean allow) {}

    /** Where a person stands in their own partition for one episode. A hint for their tile, nothing more. */
    record Seat(String draftId) {}

    // ---------------------------------------------------------------- registration

    /** Registers every action and the channel rules, and re-arms the rounds that were running. */
    void register() {
        Actions actions = ctx.actions();
        Channels channels = ctx.channels();
        if (actions == null || channels == null) {
            ctx.logger().warn("bingo draft rounds need the actions and channels blocks in plugin.json");
            return;
        }
        handle(actions, "draft-create", this::create);
        handle(actions, "draft-setup", call -> {
            SetupRequest r = call.payload(SetupRequest.class);
            Object view = mutate(call, r, true, (d, c) -> {
                boolean hostPlays = r.hostPlays() == null ? d.order.contains(d.host) : r.hostPlays();
                if (hostPlays && !d.order.contains(d.host) && hasCard(d.host, d.episode, d.id)) {
                    throw new BingoDraft.Refused("has-card");
                }
                d.setup(r.settings(), hostPlays, r.order());
            });
            BingoDraft d = load(r.id());
            if (d.host.equals(call.caller().userId().toString())) {
                seat(call, d, d.order.contains(d.host));
            }
            return view;
        });
        handle(actions, "draft-players", this::players);
        handle(actions, "draft-invite", this::invite);
        handle(actions, "draft-start", call -> mutate(call, call.payload(RoundRequest.class), true,
                (d, c) -> d.start(now())));
        handle(actions, "draft-cancel", call -> mutate(call, call.payload(RoundRequest.class), true,
                (d, c) -> d.cancel(now())));
        handle(actions, "draft-end", call -> mutate(call, call.payload(RoundRequest.class), true,
                (d, c) -> d.end(now())));
        handle(actions, "draft-join", this::join);
        handle(actions, "draft-decline", call -> {
            Object result = mutate(call, call.payload(RoundRequest.class), false, (d, c) -> {
                if (!d.isMember(c.userId().toString())) {
                    throw new BingoDraft.Refused("not-invited");
                }
                d.leave(c.userId().toString());
            });
            seat(call, load(call.payload(RoundRequest.class).id()), false);
            return result;
        });
        handle(actions, "draft-state", this::state);
        handle(actions, "draft-move", call -> {
            MoveRequest r = call.payload(MoveRequest.class);
            return mutate(call, r, false, (d, c) -> {
                if (r.cell() == null) {
                    throw new BingoDraft.Refused("bad-cell");
                }
                d.move(c.userId().toString(), r.cell(), r.text(), now());
            });
        });
        handle(actions, "draft-vote", call -> {
            VoteRequest r = call.payload(VoteRequest.class);
            return mutate(call, r, false, (d, c) -> d.castVote(c.userId().toString(),
                    Boolean.TRUE.equals(r.allow()), now()));
        });
        handle(actions, "draft-inbox", this::inbox);

        channels.authorize(this::mayListen);
        channels.onJoin((ref, caller) -> presence(ref));
        channels.onLeave((ref, caller) -> presence(ref));

        rearm();
    }

    /**
     * Puts the caller's seat in their own partition, or takes it away. Only for their tile: whoever plays in a
     * round must not be offered the editor there, since the backend reads only the round's card for them.
     */
    private static void seat(ActionCall call, BingoDraft d, boolean playing) {
        if (playing) {
            call.store().put(Scope.user(), SEAT_PREFIX + d.episode, new Seat(d.id));
        } else {
            call.store().get(Scope.user(), SEAT_PREFIX + d.episode, Seat.class)
                    .filter(s -> d.id.equals(s.draftId()))
                    .ifPresent(s -> call.store().delete(Scope.user(), SEAT_PREFIX + d.episode));
        }
    }

    private interface Change {
        void apply(BingoDraft draft, Caller caller);
    }

    private static void handle(Actions actions, String name, ActionHandler handler) {
        actions.handle(name, call -> {
            try {
                return handler.handle(call);
            } catch (BingoDraft.Refused e) {
                throw new ActionRejectedException(e.code);
            }
        });
    }

    // ---------------------------------------------------------------- the actions

    /** {@code draft-create}, called in the episode's scope: a new lobby, run by the caller. */
    private Object create(ActionCall call) {
        Scope scope = call.scope();
        if (scope.type() != ScopeType.EPISODE) {
            throw new BingoDraft.Refused("not-an-episode");
        }
        String slug = scope.id();
        Template template = ctx.store().get(scope, KEY_TEMPLATE, Template.class)
                .orElseThrow(() -> new BingoDraft.Refused("no-bingo"));
        Phase phase = ctx.store().get(scope, KEY_PHASE, PhaseState.class)
                .map(p -> BingoLifecycle.parsePhase(p.phase()))
                .orElse(Phase.OPEN);
        if (phase != Phase.OPEN) {
            throw new BingoDraft.Refused("closed");
        }
        String host = call.caller().userId().toString();
        String id = UUID.randomUUID().toString();
        BingoDraft d = BingoDraft.create(id, slug, host, newCode(), template.gridSize(),
                template.hasFreeCentre(), threshold.getAsDouble(), now());
        CreateRequest r = call.payload(CreateRequest.class);
        boolean wantsToPlay = r == null || r.hostPlays() == null || r.hostPlays();
        if (!wantsToPlay || hasCard(host, slug, id)) {
            d.order.remove(host);
        }
        save(d);
        seat(call, d, d.order.contains(host));
        return Map.of("id", id);
    }

    /** {@code draft-players}: who the host could invite. Ids only; the picker resolves the names. */
    private Object players(ActionCall call) {
        RoundRequest r = request(call.payload(RoundRequest.class));
        BingoDraft d = load(r.id());
        requireHost(d, call.caller());
        Set<String> known = new LinkedHashSet<>();
        for (String prefix : List.of(CARD_PREFIX, KEY_PREFS, KEY_CLAIM, SEAT_PREFIX)) {
            for (OwnedDocEntry entry : everyone.query(prefix)) {
                known.add(entry.userId().toString());
            }
        }
        Set<String> taken = takenOn(d.episode);
        known.removeIf(u -> taken.contains(u) || d.isMember(u));
        List<String> ids = new ArrayList<>(known);
        if (quiet(d.episode)) {
            ids = staff(ids);
        }
        return Map.of("userIds", ids.size() > MAX_CANDIDATES ? ids.subList(0, MAX_CANDIDATES) : ids);
    }

    /** {@code draft-invite}: adds people, and tells them in the bell and, if they are on the site, live. */
    private Object invite(ActionCall call) {
        InviteRequest r = call.payload(InviteRequest.class);
        if (r == null || r.userIds() == null) {
            throw new BingoDraft.Refused("bad-request");
        }
        List<String> wanted = new ArrayList<>();
        for (String raw : r.userIds()) {
            wanted.add(uuid(raw).toString());
        }
        List<String> added = new ArrayList<>();
        Object view = mutate(call, r, true, (d, c) -> {
            Set<String> taken = takenOn(d.episode);
            List<String> eligible = wanted.stream().filter(u -> !taken.contains(u)).toList();
            if (quiet(d.episode)) {
                eligible = staff(eligible);
            }
            added.addAll(d.invite(eligible));
        });
        if (!added.isEmpty()) {
            BingoDraft d = load(r.id());
            notifyInvited(d, added);
            Channel inbox = ctx.channels().channel(Scope.site(), CHANNEL_INBOX);
            added.forEach(u -> inbox.publishTo(UUID.fromString(u), "invited", Map.of("id", d.id)));
        }
        return view;
    }

    /** {@code draft-join}: an invited person, or anyone holding the link's code, takes a seat. */
    private Object join(ActionCall call) {
        RoundRequest r = request(call.payload(RoundRequest.class));
        Caller caller = call.caller();
        String me = caller.userId().toString();
        Object view = mutate(call, r, false, (d, c) -> {
            boolean admitted = d.invited.contains(me) || d.order.contains(me) || d.host.equals(me)
                    || (r.code() != null && r.code().equals(d.code));
            if (!admitted) {
                throw new BingoDraft.Refused("not-invited");
            }
            if (quiet(d.episode) && caller.role() == Role.FAN) {
                throw new BingoDraft.Refused("quiet");
            }
            if (hasCard(me, d.episode, d.id)) {
                throw new BingoDraft.Refused("has-card");
            }
            if (d.host.equals(me)) {
                d.setup(null, true, null);
            } else {
                d.join(me);
            }
        });
        seat(call, load(r.id()), true);
        return view;
    }

    /** {@code draft-state}: the whole round for a member, or a short preview for somebody holding the code. */
    private Object state(ActionCall call) {
        RoundRequest r = request(call.payload(RoundRequest.class));
        BingoDraft d = load(r.id());
        Caller caller = call.caller();
        String me = caller.userId().toString();
        if (d.isMember(me) || caller.role() == Role.ADMIN) {
            return view(d, caller);
        }
        if (r.code() != null && r.code().equals(d.code)) {
            boolean hidden = quiet(d.episode) && caller.role() == Role.FAN;
            Map<String, Object> preview = new LinkedHashMap<>();
            preview.put("id", d.id);
            preview.put("preview", true);
            preview.put("status", d.status.name());
            preview.put("host", d.host);
            preview.put("players", d.order.size());
            preview.put("quiet", hidden);
            if (!hidden) {
                preview.put("episode", d.episode);
            }
            return preview;
        }
        throw new BingoDraft.Refused("not-invited");
    }

    /** {@code draft-inbox}: the caller's rounds, newest first. */
    private Object inbox(ActionCall call) {
        Caller caller = call.caller();
        String me = caller.userId().toString();
        List<Map<String, Object>> items = new ArrayList<>();
        for (BingoDraft d : all()) {
            if (!d.isMember(me) || d.status == BingoDraft.Status.CANCELLED) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", d.id);
            item.put("status", d.status.name());
            item.put("host", d.host);
            item.put("role", d.host.equals(me) ? "host" : d.order.contains(me) ? "player" : "invited");
            item.put("players", d.order.size());
            item.put("yourTurn", me.equals(d.current));
            item.put("createdAt", d.createdAt);
            if (d.endedAt != null) {
                item.put("endedAt", d.endedAt);
            }
            if (!(quiet(d.episode) && caller.role() == Role.FAN)) {
                item.put("episode", d.episode);
            }
            items.add(item);
        }
        items.sort((a, b) -> Long.compare((long) b.get("createdAt"), (long) a.get("createdAt")));
        return Map.of("items", items);
    }

    /**
     * Loads, changes, saves, publishes, re-arms - all under the round's lock - and answers with the new view.
     *
     * @param hostOnly whether only the person running the round (or an admin) may do this
     */
    private Object mutate(ActionCall call, Object payload, boolean hostOnly, Change change) {
        String id = idOf(payload);
        ReentrantLock lock = lockOf(id);
        lock.lock();
        try {
            BingoDraft d = load(id);
            if (hostOnly) {
                requireHost(d, call.caller());
            }
            Snapshot before = Snapshot.of(d);
            change.apply(d, call.caller());
            commit(d, before);
            return view(d, call.caller());
        } finally {
            lock.unlock();
        }
    }

    /** What a change needs to compare against: which square, if any, it wrote. */
    private record Snapshot(Map<String, List<String>> cells, BingoDraft.Status status) {
        static Snapshot of(BingoDraft d) {
            Map<String, List<String>> cells = new LinkedHashMap<>();
            d.seats.forEach(s -> cells.put(s.userId, List.copyOf(s.cells)));
            return new Snapshot(cells, d.status);
        }
    }

    private void commit(BingoDraft d, Snapshot before) {
        d.version++;
        save(d);
        publishUpdate(d, written(d, before));
        if (before.status() != d.status) {
            Channel inbox = ctx.channels().channel(Scope.site(), CHANNEL_INBOX);
            members(d).forEach(u -> inbox.publishTo(u, "changed", Map.of("id", d.id)));
        }
        arm(d);
    }

    private static Map<String, Object> written(BingoDraft d, Snapshot before) {
        for (BingoDraft.Seat s : d.seats) {
            List<String> was = before.cells().get(s.userId);
            for (int i = 0; i < s.cells.size(); i++) {
                String old = was == null ? "" : was.get(i);
                if (!s.cells.get(i).equals(old)) {
                    return Map.of("userId", s.userId, "cell", i, "text", s.cells.get(i));
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- timers

    private void rearm() {
        for (BingoDraft d : all()) {
            if (d.status != BingoDraft.Status.RUNNING) {
                continue;
            }
            ReentrantLock lock = lockOf(d.id);
            lock.lock();
            try {
                d.resume(now());
                save(d);
                arm(d);
            } finally {
                lock.unlock();
            }
        }
    }

    /** One timer per round, for whatever is due next. Replaces the one before. */
    private void arm(BingoDraft d) {
        Scheduled old = timers.remove(d.id);
        if (old != null) {
            old.cancel();
        }
        Long due = d.deadline();
        if (due == null) {
            return;
        }
        long delay = Math.max(0, due - now());
        String id = d.id;
        timers.put(id, ctx.runAfter(Duration.ofMillis(delay), () -> fire(id)));
    }

    /** A turn or a vote ran out. */
    void fire(String id) {
        ReentrantLock lock = lockOf(id);
        lock.lock();
        try {
            Optional<BingoDraft> found = find(id);
            if (found.isEmpty()) {
                return;
            }
            BingoDraft d = found.get();
            Snapshot before = Snapshot.of(d);
            if (d.expire(now())) {
                commit(d, before);
            } else {
                arm(d); // woke a little early
            }
        } catch (RuntimeException e) {
            ctx.logger().warn("bingo draft round {} could not run its clock", id, e);
        } finally {
            lock.unlock();
        }
    }

    // ---------------------------------------------------------------- channels

    private boolean mayListen(Caller caller, ChannelRef ref) {
        if (ref.scope().type() != ScopeType.SITE) {
            return false;
        }
        if (CHANNEL_INBOX.equals(ref.name())) {
            return true;
        }
        if (!ref.name().startsWith(CHANNEL_PREFIX)) {
            return false;
        }
        return find(ref.name().substring(CHANNEL_PREFIX.length()))
                .map(d -> d.isMember(caller.userId().toString()))
                .orElse(false);
    }

    private void presence(ChannelRef ref) {
        if (!ref.name().startsWith(CHANNEL_PREFIX)) {
            return;
        }
        Channel channel = ctx.channels().channel(ref.scope(), ref.name());
        channel.publish("presence", Map.of("online", online(channel)));
    }

    private static List<String> online(Channel channel) {
        return channel.subscribers().stream().map(UUID::toString).sorted().toList();
    }

    private Channel channelOf(BingoDraft d) {
        return ctx.channels().channel(Scope.site(), CHANNEL_PREFIX + d.id);
    }

    private void publishUpdate(BingoDraft d, Map<String, Object> written) {
        Map<String, Object> event = shared(d, false);
        if (written != null) {
            event.put("written", written);
        }
        channelOf(d).publish("update", event);
    }

    // ---------------------------------------------------------------- views

    /** The round as one member sees it: everything, the cards included, and the code for the host. */
    Map<String, Object> view(BingoDraft d, Caller caller) {
        String me = caller.userId().toString();
        boolean hidden = quiet(d.episode) && caller.role() == Role.FAN;
        Map<String, Object> view = shared(d, true);
        if (hidden) {
            view.remove("episode");
        }
        view.put("quiet", hidden);
        if (caller.role() != Role.FAN) {
            view.put("quietEpisode", quiet(d.episode));
        }
        if (d.host.equals(me)) {
            view.put("code", d.code);
            if (d.status == BingoDraft.Status.LOBBY && !d.order.contains(me)) {
                // So the lobby can say why "I'm playing" is off, instead of offering a switch that's refused.
                view.put("hostHasCard", hasCard(me, d.episode, d.id));
            }
        }
        view.put("online", online(channelOf(d)));
        return view;
    }

    /** What every member may see. {@code cards} adds every seat's squares, which an event leaves out. */
    private Map<String, Object> shared(BingoDraft d, boolean cards) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", d.id);
        v.put("version", d.version);
        v.put("now", now());
        v.put("status", d.status.name());
        if (!quiet(d.episode)) {
            v.put("episode", d.episode);
        }
        v.put("host", d.host);
        v.put("size", d.size);
        v.put("freeCentre", d.freeCentre);
        // The site's threshold when the round was made, so the browser's hint agrees with the backend's check.
        v.put("threshold", d.threshold);
        v.put("settings", d.settings);
        v.put("invited", d.invited);
        v.put("order", d.order);
        v.put("createdAt", d.createdAt);
        if (d.endedAt != null) {
            v.put("endedAt", d.endedAt);
        }
        if (d.status == BingoDraft.Status.LOBBY) {
            return v;
        }
        Map<String, Object> game = new LinkedHashMap<>();
        game.put("stage", d.stage == null ? null : d.stage.name());
        game.put("overtime", d.overtime);
        game.put("current", d.current);
        game.put("turnStartedAt", d.turnStartedAt);
        game.put("usedMs", d.usedMs);
        game.put("turnLimitMs", d.current == null ? null : d.turnLimit(d.seat(d.current)));
        game.put("deadline", d.deadline());
        List<Map<String, Object>> seats = new ArrayList<>();
        for (BingoDraft.Seat s : d.seats) {
            Map<String, Object> seat = new LinkedHashMap<>();
            seat.put("userId", s.userId);
            seat.put("bankMs", s.bankMs);
            seat.put("out", s.out);
            seat.put("done", s.done);
            seat.put("skipped", s.skipped);
            seat.put("filled", s.cells.size() - s.empty());
            if (cards) {
                seat.put("cells", s.cells);
            }
            seats.add(seat);
        }
        game.put("seats", seats);
        if (d.vote != null) {
            Map<String, Object> vote = new LinkedHashMap<>();
            vote.put("by", d.vote.by);
            vote.put("cell", d.vote.cell);
            vote.put("text", d.vote.text);
            vote.put("matches", d.vote.matches);
            vote.put("voters", d.vote.voters);
            // Who has voted, never how: the count is the suspense and the result speaks for itself.
            vote.put("voted", List.copyOf(d.vote.votes.keySet()));
            vote.put("deadline", d.vote.awaitingHost ? null : d.vote.deadline);
            vote.put("awaitingHost", d.vote.awaitingHost);
            game.put("vote", vote);
        }
        if (d.turnedDown != null) {
            game.put("turnedDown", Map.of("by", d.turnedDown.by, "text", d.turnedDown.text));
        }
        v.put("game", game);
        return v;
    }

    // ---------------------------------------------------------------- what the tick reads

    /**
     * What draft rounds say about each episode's cards.
     *
     * @param finished each finished round's cards, by author: these replace anything in the author's partition
     * @param playing  people in a lobby or a running round there: their partition card is not read at all
     */
    record EpisodeDrafts(Map<String, List<String>> finished, Set<String> playing) {}

    /** Every round, read once per tick, as what it means for the cards of each episode. */
    Map<String, EpisodeDrafts> byEpisode() {
        Map<String, EpisodeDrafts> out = new LinkedHashMap<>();
        for (BingoDraft d : all()) {
            if (d.status == BingoDraft.Status.CANCELLED) {
                continue;
            }
            EpisodeDrafts e = out.computeIfAbsent(d.episode,
                    s -> new EpisodeDrafts(new LinkedHashMap<>(), new LinkedHashSet<>()));
            if (d.status == BingoDraft.Status.FINISHED) {
                e.finished().putAll(d.cards());
            } else {
                e.playing().addAll(d.order);
            }
        }
        return out;
    }

    /**
     * Drops rounds nobody needs any more. A finished one stays while its episode's predictions are open: its
     * cards are read from it on every pass until the lock freezes them as rows.
     */
    void prune() {
        long now = now();
        for (BingoDraft d : all()) {
            boolean ended = !d.active() && d.endedAt != null && now - d.endedAt > KEEP_ENDED.toMillis()
                    && (d.status == BingoDraft.Status.CANCELLED || !predictionsOpen(d.episode));
            boolean abandoned = d.status == BingoDraft.Status.LOBBY && now - d.createdAt > KEEP_LOBBY.toMillis();
            if (ended || abandoned) {
                ctx.store().delete(Scope.site(), DRAFT_PREFIX + d.id);
                locks.remove(d.id);
            }
        }
    }

    private boolean predictionsOpen(String slug) {
        return ctx.store().get(Scope.episode(slug), KEY_PHASE, PhaseState.class)
                .map(p -> BingoLifecycle.parsePhase(p.phase()) == Phase.OPEN)
                .orElse(true);
    }

    /** Whether a round with this id exists, for the page routes. */
    boolean exists(String id) {
        try {
            return find(id).isPresent();
        } catch (BingoDraft.Refused e) {
            return false;
        }
    }

    /** Takes an erased person out of every round. */
    void erase(String userId, String pseudonym) {
        for (BingoDraft found : all()) {
            ReentrantLock lock = lockOf(found.id);
            lock.lock();
            try {
                BingoDraft d = load(found.id);
                Snapshot before = Snapshot.of(d);
                if (d.erase(userId, pseudonym, now())) {
                    commit(d, before);
                }
            } finally {
                lock.unlock();
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    private List<BingoDraft> all() {
        List<BingoDraft> out = new ArrayList<>();
        for (DocEntry entry : ctx.store().query(Scope.site(), DRAFT_PREFIX)) {
            BingoDraft d = BingoDocs.read(entry.value(), BingoDraft.class, ctx.logger());
            if (d != null && d.id != null && d.episode != null) {
                out.add(d);
            }
        }
        return out;
    }

    private Optional<BingoDraft> find(String id) {
        return ctx.store().get(Scope.site(), DRAFT_PREFIX + uuid(id), BingoDraft.class);
    }

    private BingoDraft load(String id) {
        return find(id).orElseThrow(() -> new BingoDraft.Refused("not-found"));
    }

    private void save(BingoDraft d) {
        ctx.store().put(Scope.site(), DRAFT_PREFIX + d.id, d);
    }

    private ReentrantLock lockOf(String id) {
        return locks.computeIfAbsent(id, k -> new ReentrantLock());
    }

    private static RoundRequest request(RoundRequest r) {
        if (r == null || r.id() == null) {
            throw new BingoDraft.Refused("bad-request");
        }
        return r;
    }

    private static String idOf(Object payload) {
        String id = switch (payload) {
            case RoundRequest r -> r.id();
            case SetupRequest r -> r.id();
            case InviteRequest r -> r.id();
            case MoveRequest r -> r.id();
            case VoteRequest r -> r.id();
            case null, default -> null;
        };
        return uuid(id).toString();
    }

    private static UUID uuid(String raw) {
        try {
            return UUID.fromString(raw);
        } catch (RuntimeException e) {
            throw new BingoDraft.Refused("not-found");
        }
    }

    private static void requireHost(BingoDraft d, Caller caller) {
        if (!d.host.equals(caller.userId().toString()) && caller.role() != Role.ADMIN) {
            throw new BingoDraft.Refused("not-host");
        }
    }

    private static Set<UUID> members(BingoDraft d) {
        Set<UUID> out = new LinkedHashSet<>();
        Function<String, UUID> parse = s -> {
            try {
                return UUID.fromString(s);
            } catch (IllegalArgumentException e) {
                return null; // an erased person's pseudonym
            }
        };
        for (String u : d.order) {
            out.add(parse.apply(u));
        }
        for (String u : d.invited) {
            out.add(parse.apply(u));
        }
        out.add(parse.apply(d.host));
        out.remove(null);
        return out;
    }

    /** Whether nobody but a podcaster may know the episode exists. */
    private boolean quiet(String slug) {
        return !lifecycle.publiclyVisible(slug);
    }

    /** The podcasters and admins among {@code ids}: the only people a quiet episode's round takes. */
    private List<String> staff(List<String> ids) {
        Users users = ctx.users();
        if (users == null || ids.isEmpty()) {
            return List.of();
        }
        Set<String> allowed = new LinkedHashSet<>();
        for (UserRef ref : users.resolve(ids.stream().map(UUID::fromString).toList())) {
            if (ref.role() != Role.FAN) {
                allowed.add(ref.id().toString());
            }
        }
        return ids.stream().filter(allowed::contains).toList();
    }

    /** Everyone who already has a card on the episode, any way: in their partition, as rows, or in a round. */
    private Set<String> takenOn(String slug) {
        Set<String> out = new LinkedHashSet<>();
        String key = CARD_PREFIX + slug;
        for (OwnedDocEntry entry : everyone.query(key)) {
            if (entry.key().equals(key) && written(entry)) {
                out.add(entry.userId().toString());
            }
        }
        SchemaStore schema = ctx.schema();
        if (schema != null) {
            for (CardResultRow row : schema.select(ENTITY_CARD_RESULT,
                    Criteria.where("episode", Criteria.Op.EQ, slug), CardResultRow.class)) {
                out.add(row.author());
            }
        }
        return out;
    }

    /** {@link #takenOn}, for one person, counting other rounds on the same episode too. */
    private boolean hasCard(String user, String slug, String exceptDraft) {
        if (takenOn(slug).contains(user)) {
            return true;
        }
        for (BingoDraft d : all()) {
            if (!d.id.equals(exceptDraft) && d.episode.equals(slug) && d.status != BingoDraft.Status.CANCELLED
                    && d.order.contains(user)) {
                return true;
            }
        }
        return false;
    }

    private boolean written(OwnedDocEntry entry) {
        Card card = BingoDocs.read(entry.value(), Card.class, ctx.logger());
        return card != null && card.safeEntries().stream().anyMatch(t -> t != null && !t.isBlank());
    }

    private static String newCode() {
        byte[] bytes = new byte[12];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private long now() {
        return clock.millis();
    }

    // ---------------------------------------------------------------- notifications

    private void notifyInvited(BingoDraft d, List<String> added) {
        Notifier notifier = ctx.notifier();
        if (notifier == null) {
            return;
        }
        String name = null;
        Users users = ctx.users();
        if (users != null) {
            name = users.resolve(List.of(UUID.fromString(d.host))).stream()
                    .map(UserRef::displayName).findFirst().orElse(null);
        }
        String title = episodeTitle(d.episode);
        try {
            List<UUID> ids = added.stream().map(UUID::fromString).toList();
            List<UUID> delivered = notifier.send(ids, invitedMessage(name, title, d.id));
            if (delivered.size() < ids.size()) {
                ctx.logger().info("bingo told {} of {} invited people about draft round {}",
                        delivered.size(), ids.size(), d.id);
            }
        } catch (NotificationException e) {
            // The invite stands either way: the person finds it on the bingo page and in the live inbox.
            ctx.logger().info("bingo could not notify invites for draft round {} ({})", d.id, e.reason());
        }
    }

    /** "Alex invited you to a draft round for …", worded here because no catalog exists on a timer. */
    static NotifyMessage invitedMessage(String host, String title, String id) {
        String en;
        String de;
        if (host == null || host.isBlank()) {
            en = "You're invited to a draft round for “" + title + "”. You take turns filling your cards.";
            de = "Du bist zu einer Draftrunde für „" + title + "“ eingeladen. Ihr füllt eure Karten abwechselnd.";
        } else {
            en = host + " invited you to a draft round for “" + title + "”. You take turns filling your cards.";
            de = host + " hat dich zu einer Draftrunde für „" + title + "“ eingeladen. "
                    + "Ihr füllt eure Karten abwechselnd.";
        }
        return new NotifyMessage(Map.of("en", en, "de", de)).withLink("/p/bingo/draft/" + id);
    }

    private String episodeTitle(String slug) {
        dev.mosaicast.plugin.api.DisplaySnapshot snapshot = lifecycle.snapshotOf(slug);
        return snapshot == null || snapshot.title() == null || snapshot.title().isBlank() ? slug : snapshot.title();
    }
}
