// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * One draft round: a lobby, then players filling their own cards one square per turn, on a chess clock.
 *
 * <p>Pure, like {@link BingoFuzzy}: no context, no clock, no I/O. Every operation takes the current time in
 * epoch milliseconds and mutates this object, which {@link BingoDrafts} loads from and saves back to the
 * store under a lock. The public fields are the stored shape (Jackson reads and writes them as they are).
 *
 * <p><strong>How a round runs.</strong>
 * <ol>
 *   <li><em>Regular</em>: everyone in order, one turn each, as many rounds as a card has squares. A turn that
 *       runs past the turn limit is skipped and owed.</li>
 *   <li><em>Make-up</em>: rounds over everyone still owing a turn. With no bank, missing one of these ends
 *       that player's card where it is: nothing else would ever stop them being owed a turn.</li>
 *   <li>A player whose bank runs out is out. Once everyone else is done: one player out fills the rest alone
 *       and untimed (<em>solo</em>), two or more play an overtime on reset clocks, which is the same regular
 *       and make-up rounds again over their empty squares. An overtime in which nobody wrote anything ends
 *       the round, or two absent players would play overtimes forever.</li>
 * </ol>
 *
 * <p><strong>Duplicates.</strong> A square close to one on somebody else's card, by the site's threshold,
 * goes to a 30 second vote by the other players while the writer's clock is paused. More yes than no allows
 * it. A tie, or no votes at all, disallows it, and the writer tries again. In the solo stage nobody voting
 * hands the decision to the person running the round, and if that is the writer, it is allowed.
 */
final class BingoDraft {

    static final int MIN_PLAYERS = 2;
    static final int MAX_PLAYERS = 8;
    /** Joined and invited together, so the invite list cannot grow without end. */
    static final int MAX_PEOPLE = 24;
    /** The longest square, in characters. Keeps a move well inside one channel event. */
    static final int MAX_TEXT = 140;
    static final long VOTE_MS = 30_000;
    /** How many close squares a vote shows. Enough to judge by, and a bounded event. */
    static final int MAX_MATCHES = 5;

    enum Status { LOBBY, RUNNING, FINISHED, CANCELLED }

    enum Stage { REGULAR, MAKEUP, SOLO }

    /** Why an operation was refused. The code is what the browser translates. */
    static final class Refused extends RuntimeException {
        private static final long serialVersionUID = 1L;
        final String code;

        Refused(String code) {
            super(code, null, false, false);
            this.code = code;
        }
    }

    /** What the person running the round chose in the lobby. Seconds; {@code null} means no limit. */
    static final class Settings {
        public boolean clock = true;
        public Integer turnSeconds = 60;
        public Integer bankSeconds = 600;
        public Integer incrementSeconds = 10;
        public boolean duplicateCheck = true;

        Settings() {}

        /** The settings with every number inside its bounds, or refused. */
        Settings validated() {
            Settings out = new Settings();
            out.clock = clock;
            out.duplicateCheck = duplicateCheck;
            out.turnSeconds = bounded(turnSeconds, 10, 900);
            out.bankSeconds = bounded(bankSeconds, 60, 7200);
            out.incrementSeconds = incrementSeconds == null ? 0 : bounded(incrementSeconds, 0, 300);
            return out;
        }

        private static Integer bounded(Integer value, int min, int max) {
            if (value == null) {
                return null;
            }
            if (value < min || value > max) {
                throw new Refused("bad-settings");
            }
            return value;
        }

        Long turnMs() {
            return clock && turnSeconds != null ? turnSeconds * 1000L : null;
        }

        Long bankMs() {
            return clock && bankSeconds != null ? bankSeconds * 1000L : null;
        }

        long incrementMs() {
            return clock && incrementSeconds != null ? incrementSeconds * 1000L : 0;
        }
    }

    /** One player during the round. */
    static final class Seat {
        public String userId;
        /** One per square to fill, in the same order a card's entries use; empty means not yet written. */
        public List<String> cells;
        /** What is left on their bank, or {@code null} without one. */
        public Long bankMs;
        /** Turns left in the current regular rounds. */
        public int regularLeft;
        /** Turns owed from a skipped one. */
        public int skipped;
        /** Their bank ran out. */
        public boolean out;
        /** No more turns, whatever is empty. */
        public boolean done;

        Seat() {}

        Seat(String userId, int squares, Long bankMs) {
            this.userId = userId;
            this.cells = new ArrayList<>(Collections.nCopies(squares, ""));
            this.bankMs = bankMs;
            this.regularLeft = squares;
        }

        int empty() {
            return (int) cells.stream().filter(String::isEmpty).count();
        }
    }

    /** A square on somebody else's card that a new one came close to. */
    static final class Match {
        public String userId;
        public int cell;
        public String text;

        Match() {}

        Match(String userId, int cell, String text) {
            this.userId = userId;
            this.cell = cell;
            this.text = text;
        }
    }

    /** A square waiting on the other players. */
    static final class Vote {
        public String by;
        public int cell;
        public String text;
        public List<Match> matches = new ArrayList<>();
        /** Who may vote, fixed when the vote opens. */
        public List<String> voters = new ArrayList<>();
        public Map<String, Boolean> votes = new LinkedHashMap<>();
        public long deadline;
        /** Nobody voted in the solo stage: the person running the round decides, with no clock. */
        public boolean awaitingHost;
    }

    /** The last square a vote turned down, so everyone can see why the turn goes on. */
    static final class Turned {
        public String by;
        public String text;

        Turned() {}

        Turned(String by, String text) {
            this.by = by;
            this.text = text;
        }
    }

    public String id;
    public String episode;
    /** Who runs the round. */
    public String host;
    /** The invite link's secret. Only the host ever sees it. */
    public String code;
    public Status status = Status.LOBBY;
    public long createdAt;
    public Long startedAt;
    public Long endedAt;
    public int size;
    public boolean freeCentre;
    public double threshold;
    public Settings settings = new Settings();
    public List<String> invited = new ArrayList<>();
    /** Who joined, in turn order. The host is in it while they play. */
    public List<String> order = new ArrayList<>();
    /** Bumped on every change, so a browser can tell a missed event from an old one. */
    public long version;

    public List<Seat> seats = new ArrayList<>();
    public Stage stage;
    /** How many overtimes have started. */
    public int overtime;
    /** Squares written since the current overtime started. */
    public int overtimeMoves;
    public String current;
    public int pointer = -1;
    public long turnStartedAt;
    /** Time the current turn used before a vote paused it. */
    public long usedMs;
    public Vote vote;
    public Turned turnedDown;

    BingoDraft() {}

    static BingoDraft create(String id, String episode, String host, String code, int size, boolean freeCentre,
                             double threshold, long now) {
        BingoDraft d = new BingoDraft();
        d.id = id;
        d.episode = episode;
        d.host = host;
        d.code = code;
        d.size = size;
        d.freeCentre = freeCentre;
        d.threshold = threshold;
        d.createdAt = now;
        d.order.add(host);
        return d;
    }

    // ---------------------------------------------------------------- who is who

    boolean isMember(String user) {
        return host.equals(user) || invited.contains(user) || order.contains(user);
    }

    boolean isPlayer(String user) {
        return order.contains(user);
    }

    Seat seat(String user) {
        for (Seat s : seats) {
            if (s.userId.equals(user)) {
                return s;
            }
        }
        return null;
    }

    int squares() {
        return BingoScore.fillableCells(size, freeCentre);
    }

    boolean active() {
        return status == Status.LOBBY || status == Status.RUNNING;
    }

    // ---------------------------------------------------------------- lobby

    /** Adds people to the invite list. Returns who is new on it. */
    List<String> invite(List<String> users) {
        requireStatus(Status.LOBBY);
        List<String> added = new ArrayList<>();
        for (String u : users) {
            if (u == null || isMember(u) || added.contains(u)) {
                continue;
            }
            if (invited.size() + order.size() + added.size() >= MAX_PEOPLE) {
                throw new Refused("too-many");
            }
            added.add(u);
        }
        invited.addAll(added);
        return added;
    }

    void join(String user) {
        requireStatus(Status.LOBBY);
        if (order.contains(user)) {
            return;
        }
        if (order.size() >= MAX_PLAYERS) {
            throw new Refused("full");
        }
        invited.remove(user);
        order.add(user);
    }

    /** Turns an invite down, or leaves the lobby. The host can't leave their own round; they cancel it. */
    void leave(String user) {
        requireStatus(Status.LOBBY);
        if (host.equals(user)) {
            throw new Refused("host-cannot-leave");
        }
        invited.remove(user);
        order.remove(user);
    }

    /**
     * What the host set up: the clock, whether they play, and the turn order.
     *
     * @param order the players in turn order; must be exactly who has joined, give or take the host
     */
    void setup(Settings next, boolean hostPlays, List<String> nextOrder) {
        requireStatus(Status.LOBBY);
        if (next != null) {
            settings = next.validated();
        }
        List<String> joined = new ArrayList<>(order);
        joined.remove(host);
        if (hostPlays) {
            joined.add(host);
        }
        if (nextOrder != null) {
            if (nextOrder.size() != joined.size() || !nextOrder.containsAll(joined)) {
                throw new Refused("stale-order");
            }
            order = new ArrayList<>(nextOrder);
        } else if (hostPlays != order.contains(host)) {
            if (hostPlays) {
                order.add(host);
            } else {
                order.remove(host);
            }
        }
        if (order.size() > MAX_PLAYERS) {
            throw new Refused("full");
        }
    }

    void start(long now) {
        requireStatus(Status.LOBBY);
        if (order.size() < MIN_PLAYERS) {
            throw new Refused("too-few");
        }
        status = Status.RUNNING;
        startedAt = now;
        seats = new ArrayList<>();
        for (String user : order) {
            seats.add(new Seat(user, squares(), settings.bankMs()));
        }
        invited.clear();
        stage = Stage.REGULAR;
        pointer = -1;
        next(now);
    }

    void cancel(long now) {
        if (!active()) {
            throw new Refused("over");
        }
        status = Status.CANCELLED;
        endedAt = now;
        vote = null;
        current = null;
    }

    /** Ends a solo stage nobody is finishing. What's empty stays empty. */
    void end(long now) {
        requireStatus(Status.RUNNING);
        if (stage != Stage.SOLO) {
            throw new Refused("not-solo");
        }
        finish(now);
    }

    // ---------------------------------------------------------------- turns

    enum Outcome { WRITTEN, VOTING }

    Outcome move(String user, int cell, String raw, long now) {
        requireStatus(Status.RUNNING);
        if (vote != null) {
            throw new Refused("vote-open");
        }
        if (!user.equals(current)) {
            throw new Refused("not-your-turn");
        }
        Seat seat = seat(user);
        if (cell < 0 || cell >= seat.cells.size()) {
            throw new Refused("bad-cell");
        }
        if (!seat.cells.get(cell).isEmpty()) {
            throw new Refused("cell-taken");
        }
        String text = raw == null ? "" : raw.strip();
        if (text.isEmpty()) {
            throw new Refused("empty");
        }
        if (text.length() > MAX_TEXT) {
            throw new Refused("too-long");
        }
        String normalised = BingoFuzzy.normalise(text);
        for (String own : seat.cells) {
            if (!own.isEmpty() && !normalised.isEmpty() && normalised.equals(BingoFuzzy.normalise(own))) {
                throw new Refused("repeat");
            }
        }
        turnedDown = null;

        List<Match> matches = settings.duplicateCheck ? matches(user, normalised) : List.of();
        List<String> voters = new ArrayList<>();
        seats.forEach(s -> {
            if (!s.userId.equals(user)) {
                voters.add(s.userId);
            }
        });
        if (!matches.isEmpty() && !voters.isEmpty()) {
            usedMs += Math.max(0, now - turnStartedAt);
            Vote v = new Vote();
            v.by = user;
            v.cell = cell;
            v.text = text;
            v.matches = new ArrayList<>(matches);
            v.voters = voters;
            v.deadline = now + VOTE_MS;
            vote = v;
            return Outcome.VOTING;
        }
        write(seat, cell, text, now);
        return Outcome.WRITTEN;
    }

    /** Squares on other cards close enough to {@code normalised} to count as the same prediction. */
    private List<Match> matches(String user, String normalised) {
        List<Match> out = new ArrayList<>();
        if (normalised.isEmpty()) {
            return out; // nothing comparable, like the grouping
        }
        double cut = Math.clamp(threshold, 0.0, 1.0);
        for (Seat s : seats) {
            if (s.userId.equals(user)) {
                continue;
            }
            for (int i = 0; i < s.cells.size() && out.size() < MAX_MATCHES; i++) {
                String other = s.cells.get(i);
                String key = other.isEmpty() ? "" : BingoFuzzy.normalise(other);
                if (!key.isEmpty() && BingoFuzzy.similarEnough(normalised, key, cut)) {
                    out.add(new Match(s.userId, i, other));
                }
            }
        }
        return out;
    }

    void castVote(String user, boolean allow, long now) {
        requireStatus(Status.RUNNING);
        if (vote == null) {
            throw new Refused("no-vote");
        }
        if (vote.awaitingHost) {
            if (!host.equals(user)) {
                throw new Refused("not-a-voter");
            }
            settle(allow, now);
            return;
        }
        if (!vote.voters.contains(user)) {
            throw new Refused("not-a-voter");
        }
        if (vote.votes.containsKey(user)) {
            throw new Refused("voted");
        }
        vote.votes.put(user, allow);
        if (vote.votes.size() == vote.voters.size()) {
            tally(now);
        }
    }

    private void tally(long now) {
        long yes = vote.votes.values().stream().filter(Boolean.TRUE::equals).count();
        long no = vote.votes.size() - yes;
        if (yes == 0 && no == 0 && stage == Stage.SOLO) {
            if (host.equals(vote.by)) {
                settle(true, now);
            } else {
                vote.awaitingHost = true;
            }
            return;
        }
        settle(yes > no, now);
    }

    private void settle(boolean allowed, long now) {
        Vote v = vote;
        vote = null;
        // The clock was paused for the vote: the turn resumes from what it had used before.
        turnStartedAt = now;
        if (allowed) {
            write(seat(v.by), v.cell, v.text, now);
        } else {
            turnedDown = new Turned(v.by, v.text);
        }
    }

    private void write(Seat seat, int cell, String text, long now) {
        seat.cells.set(cell, text);
        long used = usedMs + Math.max(0, now - turnStartedAt);
        if (seat.bankMs != null) {
            seat.bankMs = Math.max(0, seat.bankMs - used) + settings.incrementMs();
        }
        if (stage == Stage.REGULAR) {
            seat.regularLeft--;
        } else if (stage == Stage.MAKEUP) {
            seat.skipped--;
        }
        if (overtime > 0) {
            overtimeMoves++;
        }
        next(now);
    }

    /**
     * When something has to happen without anybody acting: the vote's end, or the turn's. {@code null} when
     * nothing will, which is a round with no clock, the solo stage, or a vote waiting on the host.
     */
    Long deadline() {
        if (status != Status.RUNNING) {
            return null;
        }
        if (vote != null) {
            return vote.awaitingHost ? null : vote.deadline;
        }
        Long limit = turnLimit(seat(current));
        return limit == null ? null : turnStartedAt + Math.max(0, limit - usedMs);
    }

    /** The most the current turn may take in all, before anything is used. */
    Long turnLimit(Seat seat) {
        if (seat == null || stage == Stage.SOLO) {
            return null;
        }
        Long turn = settings.turnMs();
        Long bank = seat.bankMs;
        if (turn == null) {
            return bank;
        }
        return bank == null ? turn : Math.min(turn, bank);
    }

    /**
     * Applies whatever was due by {@code now}: a vote nobody finished, or a turn that ran out.
     *
     * @return whether anything changed
     */
    boolean expire(long now) {
        Long due = deadline();
        if (due == null || now < due) {
            return false;
        }
        if (vote != null) {
            tally(now);
            return true;
        }
        Seat seat = seat(current);
        long used = usedMs + Math.max(0, now - turnStartedAt);
        if (seat.bankMs != null && used >= seat.bankMs) {
            seat.bankMs = 0L;
            seat.out = true;
        } else {
            if (seat.bankMs != null) {
                seat.bankMs = Math.max(0, seat.bankMs - used);
            }
            if (stage == Stage.REGULAR) {
                seat.skipped++;
            } else if (seat.bankMs == null) {
                seat.done = true; // a missed make-up turn, with nothing else to end them
            }
        }
        if (stage == Stage.REGULAR) {
            seat.regularLeft--;
        }
        next(now);
        return true;
    }

    /**
     * Restarts the turn in progress, for a backend that just started: whatever ran while it was down was
     * nobody's turn. A vote gets its full time again.
     */
    void resume(long now) {
        if (status != Status.RUNNING) {
            return;
        }
        if (vote != null) {
            if (!vote.awaitingHost) {
                vote.deadline = now + VOTE_MS;
            }
            return;
        }
        turnStartedAt = now;
    }

    private boolean eligible(Seat s) {
        if (s.empty() == 0) {
            return false;
        }
        return switch (stage) {
            case REGULAR -> !s.out && !s.done && s.regularLeft > 0;
            case MAKEUP -> !s.out && !s.done && s.skipped > 0;
            case SOLO -> s.out && !s.done;
        };
    }

    /** Hands the turn on: the next eligible player after the last one, or the next stage when there's none. */
    private void next(long now) {
        usedMs = 0;
        turnStartedAt = now;
        while (true) {
            int n = seats.size();
            for (int step = 1; step <= n; step++) {
                int i = Math.floorMod(pointer + step, n);
                if (eligible(seats.get(i))) {
                    pointer = i;
                    current = seats.get(i).userId;
                    return;
                }
            }
            pointer = -1;
            if (stage == Stage.REGULAR) {
                stage = Stage.MAKEUP;
                continue;
            }
            if (stage == Stage.SOLO) {
                finish(now);
                return;
            }
            List<Seat> out = seats.stream().filter(s -> s.out && !s.done && s.empty() > 0).toList();
            if (out.isEmpty() || (overtime > 0 && overtimeMoves == 0)) {
                finish(now);
                return;
            }
            if (out.size() == 1) {
                stage = Stage.SOLO;
                continue;
            }
            overtime++;
            overtimeMoves = 0;
            for (Seat s : out) {
                s.out = false;
                s.bankMs = settings.bankMs();
                s.regularLeft = s.empty();
                s.skipped = 0;
            }
            stage = Stage.REGULAR;
        }
    }

    private void finish(long now) {
        status = Status.FINISHED;
        endedAt = now;
        current = null;
        vote = null;
    }

    private void requireStatus(Status wanted) {
        if (status != wanted) {
            throw new Refused(status == Status.LOBBY ? "not-started" : "over");
        }
    }

    // ---------------------------------------------------------------- what the record keeps

    /** Each player's card as a card's entries, once the round is over. */
    Map<String, List<String>> cards() {
        Map<String, List<String>> out = new LinkedHashMap<>();
        if (status == Status.FINISHED) {
            seats.forEach(s -> out.put(s.userId, List.copyOf(s.cells)));
        }
        return out;
    }

    /**
     * Takes an erased person out of the round. In the lobby they simply go (and a host's round with them);
     * while it runs they play no more turns; afterwards their card stays, under a pseudonym, like their rows.
     *
     * @return whether the round mentioned them at all
     */
    boolean erase(String user, String pseudonym, long now) {
        if (!isMember(user) && seat(user) == null) {
            return false;
        }
        if (status == Status.LOBBY) {
            if (host.equals(user)) {
                cancel(now);
            } else {
                invited.remove(user);
                order.remove(user);
                return true;
            }
        } else if (status == Status.RUNNING) {
            Seat seat = seat(user);
            if (seat != null) {
                seat.done = true;
                if (vote != null && vote.by.equals(user)) {
                    vote = null;
                }
                if (vote != null) {
                    vote.voters.remove(user);
                    vote.votes.remove(user);
                }
                if (user.equals(current)) {
                    next(now);
                }
            }
        }
        replace(user, pseudonym);
        return true;
    }

    /** Swaps an erased person's id for a pseudonym everywhere it appears. */
    void replace(String user, String pseudonym) {
        if (Objects.equals(host, user)) {
            host = pseudonym;
        }
        invited.replaceAll(u -> u.equals(user) ? pseudonym : u);
        order.replaceAll(u -> u.equals(user) ? pseudonym : u);
        seats.forEach(s -> {
            if (s.userId.equals(user)) {
                s.userId = pseudonym;
            }
        });
        if (Objects.equals(current, user)) {
            current = pseudonym;
        }
    }
}
