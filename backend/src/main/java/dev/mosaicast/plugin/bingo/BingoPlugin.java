// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.CrossUserStore;
import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.NotificationException;
import dev.mosaicast.plugin.api.NotifyMessage;
import dev.mosaicast.plugin.api.Notifier;
import dev.mosaicast.plugin.api.OwnedDocEntry;
import dev.mosaicast.plugin.api.PluginBackend;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.SchemaStore;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.api.UserDataHandler;
import org.pf4j.Extension;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Per-episode bingo: everyone fills in their own card, one shared fuzzy-deduplicated resolution list
 * scores all of them, and a podcaster features a few of them at the top.
 *
 * <h2>Everyone plays as themselves</h2>
 * There is one card shape and it lives in its author's own partition. Nobody types a name anywhere: a
 * player is drawn from {@code ctx.users} at render time, which is what keeps one person from appearing as
 * another. An earlier version had podcaster-authored "host" cards carrying a typed-in name, because before
 * platformApi 0.13.0 a backend could not turn a user id into anything renderable. That reason is gone.
 *
 * <h2>Why anything at all happens on a schedule</h2>
 * A v1 plugin authors no HTTP routes, so no plugin code runs at request time. Cards live in their authors'
 * partitions and are invisible to every browser but their own — the podcaster's included — so the list of
 * things to tick off, the leaderboard, the featured cards and even the list of who <em>could</em> be
 * featured must all be computed here and published as documents. The tick-off board is therefore
 * eventually consistent by construction rather than by choice.
 *
 * <h2>Why a late write cannot be refused, and why that is fine</h2>
 * A person owns their partition: the access floors do not apply to it in either direction, the doc store
 * has no per-key lock, and nothing here runs when they press save. So a player can rewrite their card at
 * any time and no design can stop them. Integrity instead comes from <em>when this class copies the card
 * into the schema</em>: at {@code LOCKED} the entries are frozen, and from then on the row is the record
 * while the document is a scratchpad nothing reads. Scores keep updating past the freeze, because the
 * podcaster is still ticking answers off.
 *
 * <h2>What bounds the work</h2>
 * An episode is in the working set only once a podcaster has created a {@code template}, and it leaves
 * permanently at {@code ARCHIVED}.
 *
 * <p>Every extension point is implemented on this one class: core resolves extensions through PF4J's
 * {@code SingletonExtensionFactory}, so a second {@code @Extension} class would be a separate singleton
 * that {@code register} never reached.
 */
@Extension
public class BingoPlugin implements PluginBackend, UserDataHandler {

    /** Grid and title, written by the podcaster. Its presence is what makes an episode have a bingo. */
    static final String KEY_TEMPLATE = "template";
    /** The podcaster's shared truth list: canonical entry to hit/miss. Client-written. */
    static final String KEY_RESOLUTION = "resolution";
    /** The podcaster's lifecycle <em>intent</em>. Client-written, deliberately not backend-owned. */
    static final String KEY_CONTROL = "control";
    /** Which players the podcaster has chosen to feature, as ids. Client-written. */
    static final String KEY_SHOWCASE = "showcase";

    /** The lifecycle <em>state</em> this class derives from the intent and the feed. Backend-owned. */
    static final String KEY_PHASE = "phase";
    /** The fuzzy-grouped things to tick off, from every card. Backend-owned. */
    static final String KEY_CANDIDATES = "candidates";
    /** Per-episode scores, for players who allow being listed. Backend-owned. */
    static final String KEY_LEADERBOARD = "leaderboard";
    /** Who could be featured, as ids only - the picker's raw material. Backend-owned. */
    static final String KEY_PARTICIPANTS = "participants";
    /** The featured cards, copied out so anyone may read them. Backend-owned. */
    static final String KEY_SHOWCASED = "showcased";
    /** Cumulative standings, in the site scope. Backend-owned. */
    static final String KEY_STATS = "stats";
    /** Who has already been told this bingo resolved, so nobody is told twice. Backend-owned. */
    static final String KEY_NOTIFIED = "notified";

    /** A player's own card, in their own partition: {@code card:<episodeSlug>}. */
    static final String CARD_PREFIX = "card:";
    /** A player's standing visibility choice, in their own partition. Not per episode, on purpose. */
    static final String KEY_PREFS = "prefs";

    static final String ENTITY_ENTRY = "entry";
    static final String ENTITY_CARD_RESULT = "card_result";

    static final int DEFAULT_INGEST_SECONDS = 60;
    static final double DEFAULT_FUZZY_THRESHOLD = 0.82;
    static final int DEFAULT_GRID_SIZE = 3;
    static final int DEFAULT_ARCHIVE_AFTER_DAYS = 30;
    /** How many rows a published board carries at most, so the document cannot grow without end. */
    static final int MAX_PUBLISHED_ROWS = 50;

    private static final ObjectMapper MAPPER = JsonMapper.builder().build();

    private final Clock clock;
    private PluginContext ctx;
    /** Every player's partition, read-only. Present because the manifest declares {@code data.readsAllUsers}. */
    private CrossUserStore everyone;

    public BingoPlugin() {
        this(Clock.systemUTC());
    }

    /** Test seam: the archive transition is the one behaviour that cannot be exercised without a clock. */
    BingoPlugin(Clock clock) {
        this.clock = clock;
    }

    @Override
    public void register(PluginContext ctx) {
        this.ctx = ctx;
        // Cards live in each player's own partition, so without the cross-user read (platformApi 0.16.0,
        // `data.readsAllUsers`) there is no game: every card would be invisible and every board empty, while
        // the tile went on accepting cards. Refusing to register puts the reason in /admin/logs instead.
        this.everyone = Objects.requireNonNull(ctx.allUsers(),
                "bingo needs data.readsAllUsers in plugin.json: it reads every player's card");

        // Publish once at boot as well as on the schedule: `backendOwned` closes a key only from the moment
        // the manifest declares it and does not remove a value a client forged before that.
        tick();

        // A supplier, not a Duration: the host re-reads it before every tick (platformApi 0.15.0), so an
        // operator who saves a new interval gets it within one old period. The Duration overload captured
        // the value here, once - the form reported the save and the plugin kept its old cadence until the
        // host restarted. Cheap on purpose, since it runs on a scheduler thread before each fire.
        ctx.onSchedule(this::ingestInterval, this::tick);
        ctx.logger().info("bingo registered; ingest every {}s, schema={}",
                ingestInterval().toSeconds(), ctx.schema() == null ? "absent" : ctx.schema().namespace());
    }

    /**
     * The configured tick period, read fresh on every call. The manifest bounds it to 10..3600 seconds and the
     * host refuses anything outside that on save and treats an older stored value outside it as unset
     * (platformApi 0.16.0), so there is no clamp here to drift from the declaration.
     */
    Duration ingestInterval() {
        return Duration.ofSeconds(intConfig("ingestIntervalSeconds", DEFAULT_INGEST_SECONDS));
    }

    /** One scheduled pass over the working set, then the site-wide roll-up. */
    void tick() {
        double threshold = doubleConfig("fuzzyThreshold", DEFAULT_FUZZY_THRESHOLD);
        boolean allowLate = booleanConfig("allowLateEntries", true);
        int archiveAfterDays = intConfig("archiveAfterDays", DEFAULT_ARCHIVE_AFTER_DAYS);
        int defaultGridSize = intConfig("defaultGridSize", DEFAULT_GRID_SIZE);
        BingoScore.RankBy rankBy = BingoScore.RankBy.of(ctx.config().get("rankBy", String.class, "lines"));

        // One read of everyone's preferences for the whole pass, rather than once per episode.
        Map<String, Prefs> prefs = readPrefs();

        for (String slug : ctx.feeds().episodesIn(Scope.site())) {
            try {
                tickEpisode(slug, threshold, allowLate, archiveAfterDays, prefs, rankBy, defaultGridSize);
            } catch (RuntimeException e) {
                // One broken episode must not cost every other episode its tick.
                ctx.logger().warn("bingo tick failed for episode {}", slug, e);
            }
        }

        try {
            publishStats(prefs, rankBy);
        } catch (RuntimeException e) {
            ctx.logger().warn("bingo stats pass failed", e);
        }
    }

    private void tickEpisode(String slug, double threshold, boolean allowLate, int archiveAfterDays,
                             Map<String, Prefs> prefs, BingoScore.RankBy rankBy, int defaultGridSize) {
        Scope scope = Scope.episode(slug);

        // No template, no bingo - and no reads beyond this one for the vast majority of a back catalogue.
        Optional<Template> found = ctx.store().get(scope, KEY_TEMPLATE, Template.class);
        if (found.isEmpty()) {
            return;
        }
        Optional<Template> template = Optional.of(sized(scope, found.get(), defaultGridSize));

        PhaseState previous = ctx.store().get(scope, KEY_PHASE, PhaseState.class).orElse(null);
        if (previous != null && Phase.ARCHIVED.name().equals(previous.phase())) {
            return; // terminal: this episode has left the working set for good
        }

        PhaseState state = resolvePhase(slug, previous, archiveAfterDays, allowLate);
        ctx.store().put(scope, KEY_PHASE, state);
        Phase phase = Phase.valueOf(state.phase());

        // Which phase to ingest under: predictions were open during this interval if they were open at
        // either end of it. Both directions of the transition need that.
        //
        // Closing - a card saved during the last interval before the lock is first seen by the very pass
        // that applies it. Judged by the new phase it looks like a latecomer and is frozen unranked, which
        // silently disqualifies somebody who saved up to a whole ingestIntervalSeconds inside the deadline,
        // while their tile still said predictions were open.
        //
        // Reopening - the outgoing phase is LOCKED, so going by that alone would leave every card frozen
        // and quietly make "reopen predictions" a button that changes nothing.
        //
        // No phase document yet is OPEN, not the phase being applied: it is what the tile shows while there
        // is none, and what resolvePhase suggests on first sight. Taking the new phase instead froze every
        // card as a latecomer whenever the podcaster locked before the backend's first pass over the bingo.
        Phase previousPhase = previous == null ? Phase.OPEN : Phase.valueOf(previous.phase());
        Phase writtenUnder =
                phase == Phase.OPEN || previousPhase == Phase.OPEN ? Phase.OPEN : phase;

        List<CardInput> cards = collectCards(slug);

        List<String> everyEntry = new ArrayList<>();
        cards.forEach(c -> everyEntry.addAll(c.entries()));
        BingoFuzzy.Grouping grouping = BingoFuzzy.group(everyEntry, threshold);

        // Publish the grouping decision itself, not just its result. Without this the browser would have to
        // re-derive which candidate an entry belongs to, which means a second copy of the fuzzy rules in
        // TypeScript - and two implementations of "are these the same thing" will disagree eventually.
        Map<String, String> assignments = new LinkedHashMap<>();
        for (String text : everyEntry) {
            String canonical = grouping.canonicalOf(text);
            if (canonical != null) {
                assignments.putIfAbsent(text.strip(), canonical);
            }
        }
        // How many *cards* carry each candidate, which is not how many entries landed in it: one person can
        // write near enough the same prediction twice. A podcaster reading "on 3 cards" is judging how
        // widely a thing was predicted, so counting authors is the only reading of that label that is true.
        Map<String, Set<String>> authorsByCanonical = new LinkedHashMap<>();
        for (CardInput card : cards) {
            for (String text : card.entries()) {
                String canonical = grouping.canonicalOf(text);
                if (canonical != null) {
                    authorsByCanonical.computeIfAbsent(canonical, c -> new LinkedHashSet<>())
                            .add(card.author());
                }
            }
        }
        Map<String, Integer> cardCounts = new LinkedHashMap<>();
        authorsByCanonical.forEach((canonical, authors) -> cardCounts.put(canonical, authors.size()));

        // Ordered by that same count, so the list a podcaster reads top-down agrees with the number beside
        // each row rather than with a tally nothing on screen shows.
        List<BingoFuzzy.Candidate> items = grouping.candidates().stream()
                .sorted(Comparator
                        .comparingInt((BingoFuzzy.Candidate c) -> cardCounts.getOrDefault(c.canonical(), 0))
                        .reversed()
                        .thenComparing(Comparator.comparingInt(BingoFuzzy.Candidate::count).reversed())
                        .thenComparing(BingoFuzzy.Candidate::canonical))
                .toList();

        ctx.store().put(scope, KEY_CANDIDATES,
                new Candidates(items, assignments, cardCounts, now().toString()));

        if (phase == Phase.ARCHIVED) {
            // Newly archived this tick: the documents above are its final state, and nothing is ingested.
            return;
        }

        Resolution resolution = ctx.store().get(scope, KEY_RESOLUTION, Resolution.class)
                .orElseGet(() -> new Resolution(Map.of()));

        ingest(slug, cards, grouping, template.get(), writtenUnder, allowLate);
        Leaderboard board = score(slug, template.get(), resolution, prefs, phase, rankBy);
        ctx.store().put(scope, KEY_LEADERBOARD, board);

        publishShowcase(slug, cards, prefs);

        if (phase == Phase.RESOLVED) {
            notifyResolved(slug);
        }
    }

    // ---------------------------------------------------------------- lifecycle

    /**
     * Merges the podcaster's stated intent with what the feed implies, and applies the archive timer.
     *
     * <p>The intent always wins: auto-locking when an episode gains a {@code publishedAt} is a default, not
     * a wall, and reopening a locked episode is a thing a podcaster is allowed to do.
     */
    private PhaseState resolvePhase(String slug, PhaseState previous, int archiveAfterDays,
                                    boolean allowLate) {
        Scope scope = Scope.episode(slug);

        boolean releasedNow = isReleased(slug);
        // Sticky, and decided the first time this bingo is seen: a bingo that existed before the episode
        // came out is one publication can meaningfully close.
        boolean openedBeforeRelease = previous != null ? previous.openedBeforeRelease() : !releasedNow;
        Phase suggested = openedBeforeRelease && releasedNow ? Phase.LOCKED : Phase.OPEN;

        Phase target = ctx.store().get(scope, KEY_CONTROL, Control.class)
                .map(Control::phase)
                .map(BingoPlugin::parsePhase)
                .orElse(suggested);

        Instant lockedAt = previous == null ? null : parseInstant(previous.lockedAt());
        Instant resolvedAt = previous == null ? null : parseInstant(previous.resolvedAt());
        Instant now = now();

        switch (target) {
            case OPEN -> {
                // Reopening genuinely reopens: the freeze and the resolution timestamp both fall away, and
                // the next ingest re-reads live documents and ranks them again.
                lockedAt = null;
                resolvedAt = null;
            }
            case LOCKED -> {
                lockedAt = lockedAt == null ? now : lockedAt;
                resolvedAt = null;
            }
            case RESOLVED, ARCHIVED -> {
                lockedAt = lockedAt == null ? now : lockedAt;
                resolvedAt = resolvedAt == null ? now : resolvedAt;
            }
        }

        Instant archiveAt = resolvedAt == null ? null : resolvedAt.plus(archiveAfterDays, ChronoUnit.DAYS);
        Phase effective = target;
        if (target == Phase.RESOLVED && archiveAt != null && !now.isBefore(archiveAt)) {
            effective = Phase.ARCHIVED;
        }

        return new PhaseState(
                effective.name(),
                suggested.name(),
                openedBeforeRelease,
                allowLate,
                lockedAt == null ? null : lockedAt.toString(),
                resolvedAt == null ? null : resolvedAt.toString(),
                archiveAt == null ? null : archiveAt.toString());
    }

    /** Whether the feed says this episode is out yet. An unknown ref counts as not yet released. */
    private boolean isReleased(String slug) {
        try {
            return ctx.feeds().display(slug).publishedAt() != null;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static Phase parsePhase(String raw) {
        if (raw == null) {
            return Phase.OPEN;
        }
        try {
            return Phase.valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return Phase.OPEN;
        }
    }

    // ---------------------------------------------------------------- cards and preferences

    /**
     * Everyone's card for one episode.
     *
     * <p>Read across partitions, because that is the only way anything sees more than its own card. This is
     * backend-only and has no HTTP surface, which is what makes the aggregate honest: the id comes from the
     * partition the document lives in, never from something a client said.
     */
    private List<CardInput> collectCards(String slug) {
        String wanted = CARD_PREFIX + slug;
        List<CardInput> cards = new ArrayList<>();

        for (OwnedDocEntry entry : everyone.query(CARD_PREFIX)) {
            if (!wanted.equals(entry.key())) {
                continue;
            }
            Card card = read(entry.value(), Card.class);
            if (card != null) {
                cards.add(new CardInput(entry.userId().toString(), card.safeEntries()));
            }
        }

        cards.sort(Comparator.comparing(CardInput::author));
        return cards;
    }

    /**
     * Everyone's standing visibility choice.
     *
     * <p>Two separate switches, because the two exposures are not alike: being listed shows a name and a
     * score, while being featured shows a person's whole card. Both default to yes for someone who has
     * never saved a preference - the toggles sit next to the save button, so the choice is in front of
     * anyone who wants it, and defaulting a leaderboard to empty would quietly remove the feature.
     */
    private Map<String, Prefs> readPrefs() {
        Map<String, Prefs> prefs = new LinkedHashMap<>();
        for (OwnedDocEntry entry : everyone.query(KEY_PREFS)) {
            if (!KEY_PREFS.equals(entry.key())) {
                continue;
            }
            Prefs p = read(entry.value(), Prefs.class);
            if (p != null) {
                prefs.put(entry.userId().toString(), p);
            }
        }
        return prefs;
    }

    private static Prefs prefsFor(Map<String, Prefs> prefs, String author) {
        Prefs p = prefs.get(author);
        return p == null ? Prefs.DEFAULT : p;
    }

    /**
     * Settles a template that never said how big it is.
     *
     * <p>{@code defaultGridSize} is configured on the backend, and there is no {@code ctx.config} in a
     * browser - so a template left silent would be read as one size here and, independently, as the
     * frontend's own fallback there. Writing the number into the template the first time it is seen means
     * the question is answered once, in one place, and both sides read the same answer forever after.
     *
     * @param scope   the episode this template belongs to
     * @param template the template as stored
     * @param configured the operator's default grid size
     * @return the template to work from, with a size it states outright
     */
    private Template sized(Scope scope, Template template, int configured) {
        if (template.size() != null && template.size() >= 2) {
            return template;
        }
        Template settled = new Template(Math.max(2, configured), template.title(), template.freeCentre());
        ctx.store().put(scope, KEY_TEMPLATE, settled);
        return settled;
    }

    // ---------------------------------------------------------------- ingest

    /**
     * Copies cards into the schema, which is where the freeze actually happens.
     *
     * <ul>
     *   <li>{@code OPEN} - rewrite from the live document every tick, so editing a card before the lock is
     *       free and costs nothing but a delete-and-insert.</li>
     *   <li>{@code LOCKED} or later - a card that already has rows is never re-read; a card arriving now is
     *       taken once and marked {@code ranked = false}, so catch-up listeners still get to play without
     *       reaching the board.</li>
     * </ul>
     *
     * <p>{@code phase} here is the phase the cards were <em>written</em> under, not the one this pass has
     * just derived. On the tick that closes predictions the two differ, and using the new one would demote
     * everybody who saved inside the last interval - up to a whole {@code ingestIntervalSeconds}, which is
     * exactly when people rush to fill a card - to a latecomer who never reaches the board.
     */
    private void ingest(String slug, List<CardInput> cards, BingoFuzzy.Grouping grouping,
                        Template template, Phase phase, boolean allowLate) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        Instant now = now();

        for (CardInput card : cards) {
            boolean hasRows = schema.count(ENTITY_ENTRY, byCard(slug, card.author())) > 0;

            if (phase == Phase.OPEN) {
                schema.delete(ENTITY_ENTRY, byCard(slug, card.author()));
                insertEntries(schema, slug, card, grouping, template, true, now);
            } else if (!hasRows) {
                if (!allowLate) {
                    continue;
                }
                insertEntries(schema, slug, card, grouping, template, false, now);
            }
            // else: frozen - the document may have changed, and nothing here reads it again.
        }
    }

    private void insertEntries(SchemaStore schema, String slug, CardInput card,
                               BingoFuzzy.Grouping grouping, Template template, boolean ranked,
                               Instant now) {
        List<String> entries = card.entries();
        for (int index = 0; index < entries.size(); index++) {
            String text = entries.get(index);
            String canonical = grouping.canonicalOf(text);
            if (canonical == null) {
                continue; // blank or uncomparable
            }
            // Stored, not recomputed on read: the host adds no ORDER BY unless one is asked for, so the
            // order rows come back in guarantees nothing and a line could not be found again.
            int position = BingoScore.gridPosition(index, template.gridSize(), template.hasFreeCentre());
            if (position < 0) {
                continue; // written for a bigger grid than this template has
            }
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("episode", slug);
            values.put("author", card.author());
            values.put("position", position);
            values.put("text", text.strip());
            values.put("canonical", canonical);
            values.put("hit", false);
            values.put("ranked", ranked);
            values.put("recordedAt", now);
            schema.insert(ENTITY_ENTRY, values);
        }
    }

    // ---------------------------------------------------------------- scoring

    /**
     * Rescores every frozen card against the current resolution and republishes the leaderboard.
     *
     * <p>Scoring runs on every tick right up to {@code ARCHIVED}, including long after the entries froze:
     * the podcaster is still ticking answers off, and a frozen card whose score never moved would be a card
     * that never got resolved.
     *
     * <p>Everyone is scored; only those who allow it are <em>published</em>. Someone who has opted out of
     * the leaderboard still has rows, still has a score, and still sees it on their own card - the tile
     * works that out from their own document without asking anybody.
     */
    private Leaderboard score(String slug, Template template, Resolution resolution,
                              Map<String, Prefs> prefs, Phase phase, BingoScore.RankBy rankBy) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return Leaderboard.empty(now().toString());
        }

        List<EntryRow> rows = schema.select(ENTITY_ENTRY,
                Criteria.where("episode", Criteria.Op.EQ, slug), EntryRow.class);

        Map<String, List<EntryRow>> byAuthor = new LinkedHashMap<>();
        for (EntryRow row : rows) {
            byAuthor.computeIfAbsent(row.author(), a -> new ArrayList<>()).add(row);
        }

        int size = template.gridSize();
        boolean freeCentre = template.hasFreeCentre();
        Instant now = now();
        List<Row> ranked = new ArrayList<>();
        List<Row> late = new ArrayList<>();
        // Everyone scored, listed or not. Opting out is a choice about whether a name and a score are shown
        // to other people; it is not a choice to stop having taken part, so it must not shrink the
        // headcount or thin out the tally that places the very people no row is published for.
        List<Row> everyRanked = new ArrayList<>();
        int everyPlayer = 0;

        for (Map.Entry<String, List<EntryRow>> e : byAuthor.entrySet()) {
            List<EntryRow> cardRows = e.getValue();
            List<int[]> marks = BingoScore.marks();
            boolean isRanked = true;
            for (EntryRow row : cardRows) {
                boolean hit = resolution.isHit(row.canonical());
                if (hit != row.hit()) {
                    schema.update(ENTITY_ENTRY, row.id(), Map.of("hit", hit));
                }
                marks.add(new int[] { row.position(), hit ? 1 : 0 });
                isRanked = isRanked && row.ranked();
            }

            String author = e.getKey();
            BingoScore.Score score = BingoScore.of(marks, size, freeCentre);

            // The row is kept whatever the preference says: it is what the standings are recomputed from,
            // and dropping it would make an aggregate that quietly disagrees with what happened.
            schema.delete(ENTITY_CARD_RESULT, byCard(slug, author));
            Map<String, Object> values = new LinkedHashMap<>();
            values.put("episode", slug);
            values.put("author", author);
            values.put("fields", score.fields());
            values.put("lines", score.lines());
            values.put("cells", score.cells());
            values.put("ranked", isRanked);
            values.put("recordedAt", now);
            schema.insert(ENTITY_CARD_RESULT, values);

            Row row = new Row(author, score.fields(), score.lines(), score.cells(), isRanked);
            everyPlayer++;
            if (isRanked) {
                everyRanked.add(row);
            }
            if (prefsFor(prefs, author).listedOrDefault()) {
                (isRanked ? ranked : late).add(row);
            }
        }

        int players = everyPlayer;

        // Nothing is published before the answers are known. Two reasons, and the second is the one that
        // matters: a board of identical scores says nothing, and a board that creeps upward while a
        // podcaster ticks answers off tells anyone watching how much has already come true - which is
        // exactly what the spoiler cover over the grid is there to prevent.
        if (phase != Phase.RESOLVED && phase != Phase.ARCHIVED) {
            return new Leaderboard(List.of(), List.of(), players, players, false, List.of(),
                    name(rankBy), now.toString());
        }

        Comparator<Row> best = comparing(rankBy).thenComparing(Row::author);
        ranked.sort(best);
        late.sort(best);
        return new Leaderboard(cap(ranked), cap(late), players, players, true,
                distributionOf(everyRanked), name(rankBy), now.toString());
    }

    /**
     * How the operator ranks, as the browser sees it.
     *
     * <p>Published rather than looked up: there is no {@code ctx.config} on the frontend, so a tile that
     * wants to lead with the quantity that actually decides places has no other way to learn which it is.
     */
    private static String name(BingoScore.RankBy rankBy) {
        return rankBy.name().toLowerCase(java.util.Locale.ROOT);
    }

    /** Best first, by whatever the operator ranks on, with the other quantity breaking the tie. */
    private static Comparator<Row> comparing(BingoScore.RankBy rankBy) {
        Comparator<BingoScore.Score> ordering = BingoScore.ordering(rankBy);
        return (a, b) -> ordering.compare(a.asScore(), b.asScore());
    }

    /** A published board is bounded: every visitor reads this document, however many people played. */
    private static List<Row> cap(List<Row> rows) {
        return List.copyOf(rows.subList(0, Math.min(rows.size(), MAX_PUBLISHED_ROWS)));
    }

    /**
     * How many people share each score.
     *
     * <p>This is what lets somebody in 73rd place still learn they are 73rd. The board itself is capped, so
     * their row is not in it; counting how many scored better is enough to place them exactly, and it costs
     * a row per <em>distinct score</em> rather than per player — bounded by the size of the grid, not by
     * how many turned up. It also names nobody, so publishing it gives away less than the board does.
     *
     * <p>Counted over every ranked card, including the ones nobody else may see. A reader with no published
     * row is precisely who this exists for, and someone who opted out has no published row by definition —
     * leaving them out would empty the tally of the only readers who need it, and would misplace everyone
     * else by however many of them there are.
     */
    private static List<Tally> distributionOf(List<Row> ranked) {
        Map<String, Tally> byScore = new LinkedHashMap<>();
        for (Row row : ranked) {
            byScore.merge(row.lines() + ":" + row.fields(),
                    new Tally(row.lines(), row.fields(), 1),
                    (a, b) -> new Tally(a.lines(), a.fields(), a.count() + b.count()));
        }
        return List.copyOf(byScore.values());
    }

    // ---------------------------------------------------------------- featuring

    /**
     * Publishes who may be featured, and the cards of those a podcaster actually chose.
     *
     * <p>Both halves have to exist because nobody's browser can read anybody else's card. The picker is
     * built from {@code participants} plus {@code ctx.users}; the tabs are built from {@code showcased},
     * which is this method copying a card out of its author's partition into the open.
     *
     * <p>The copy is gated on the author's own choice, checked here rather than trusted from the
     * podcaster's pick: a stale selection made before someone opted out must stop publishing them, and only
     * the backend can see both the pick and the preference.
     */
    private void publishShowcase(String slug, List<CardInput> cards, Map<String, Prefs> prefs) {
        Scope scope = Scope.episode(slug);

        List<Participant> participants = new ArrayList<>();
        for (CardInput card : cards) {
            if (prefsFor(prefs, card.author()).showcasableOrDefault()) {
                participants.add(new Participant(card.author()));
            }
        }
        ctx.store().put(scope, KEY_PARTICIPANTS, new Participants(participants, now().toString()));

        Set<String> chosen = new LinkedHashSet<>(ctx.store().get(scope, KEY_SHOWCASE, Showcase.class)
                .map(Showcase::safeUserIds)
                .orElseGet(List::of));

        List<ShowcasedCard> showcased = new ArrayList<>();
        for (CardInput card : cards) {
            if (chosen.contains(card.author()) && prefsFor(prefs, card.author()).showcasableOrDefault()) {
                showcased.add(new ShowcasedCard(card.author(), card.entries()));
            }
        }
        ctx.store().put(scope, KEY_SHOWCASED, new Showcased(showcased, now().toString()));
    }

    // ---------------------------------------------------------------- telling people

    /**
     * Tells this episode's players that their bingo has been resolved.
     *
     * <p>This is the one surface that writes into somebody else's experience, so it is bounded on both
     * sides. The host allows it only for users this plugin already holds {@code USER}-scope data for -
     * exactly the people who filled in a card - and this method keeps a record of who has been told, so a
     * tick that runs every minute for the next month sends nothing more.
     *
     * <p>Tracking <em>people</em> rather than "did we send yet" is what makes a latecomer work: someone who
     * fills in a card after the resolution is simply a participant nobody has told.
     *
     * <p>Read from the schema rather than the leaderboard, deliberately: the board omits anyone who opted
     * out of being listed, and they are owed the news as much as anybody. Not appearing on a public board
     * is a choice about what other people see, not a request to stop hearing about your own game.
     */
    private void notifyResolved(String slug) {
        Notifier notifier = ctx.notifier();
        SchemaStore schema = ctx.schema();
        if (notifier == null || schema == null) {
            return; // no notifications block in the manifest
        }

        Scope scope = Scope.episode(slug);
        NotifyState state = ctx.store().get(scope, KEY_NOTIFIED, NotifyState.class).orElse(null);
        Set<String> already = new LinkedHashSet<>(
                state == null || state.userIds() == null ? List.of() : state.userIds());

        List<UUID> ranked = new ArrayList<>();
        List<UUID> late = new ArrayList<>();
        for (CardResultRow row : schema.select(ENTITY_CARD_RESULT,
                Criteria.where("episode", Criteria.Op.EQ, slug), CardResultRow.class)) {
            if (already.contains(row.author())) {
                continue;
            }
            try {
                (row.ranked() ? ranked : late).add(UUID.fromString(row.author()));
            } catch (IllegalArgumentException e) {
                // A pseudonymised author ("erased:...") is not a user any more; there is nobody to tell.
            }
        }
        if (ranked.isEmpty() && late.isEmpty()) {
            return;
        }

        String title = episodeTitle(slug);
        Set<String> told = new LinkedHashSet<>(already);

        // Two audiences, two different things worth saying. Sent separately because one NotifyMessage goes
        // to every recipient in a call.
        boolean settled = send(notifier, ranked, rankedMessage(title, slug), told, slug);
        settled &= send(notifier, late, lateMessage(title, slug), told, slug);

        if (told.size() != already.size()) {
            ctx.store().put(scope, KEY_NOTIFIED, new NotifyState(List.copyOf(told), now().toString()));
        }
        if (!settled) {
            ctx.logger().info("bingo is holding notifications for {} until a later tick", slug);
        }
    }

    /**
     * Sends to one audience.
     *
     * @return {@code false} when the batch should be held for a later tick
     */
    private boolean send(Notifier notifier, List<UUID> ids, NotifyMessage message,
                         Set<String> told, String slug) {
        if (ids.isEmpty()) {
            return true;
        }
        try {
            List<UUID> delivered = notifier.send(ids, message);
            if (delivered.size() < ids.size()) {
                // A partial send is ordinary - an erased account is still in our rows - but a silent one
                // would make a plugin working from a stale list look exactly like a healthy one.
                ctx.logger().info("bingo notified {} of {} players for {}", delivered.size(), ids.size(), slug);
            }
            // Everyone asked for is marked, not only those delivered: an ineligible recipient is one whose
            // account is gone, and that will be just as true on the next tick.
            ids.forEach(id -> told.add(id.toString()));
            return true;
        } catch (NotificationException e) {
            if (e.retryable()) {
                return false; // over the send cap: hold the batch rather than dropping it
            }
            // A bad link or message fails identically forever, so retrying would only log once a minute.
            ctx.logger().error("bingo dropped a notification for {} ({})", slug, e.reason(), e);
            ids.forEach(id -> told.add(id.toString()));
            return true;
        }
    }

    /**
     * The notification wording, in every language this plugin can say it.
     *
     * <p>These sentences live here rather than in {@code locales/*.json} because a notification is written
     * on a backend timer, where no Web Component is mounted and the frontend catalogs are not loaded. The
     * host has no plugin catalog surface to resolve a key against, so a key would reach the reader as the
     * literal string. Every language travels with the message because it may be read days later, by someone
     * whose shell is in a different language than it was when this ran.
     */
    private static NotifyMessage rankedMessage(String title, String slug) {
        return new NotifyMessage(Map.of(
                "en", "The bingo for “" + title + "” is resolved. See how your card scored.",
                "de", "Das Bingo für „" + title + "“ ist aufgelöst. "
                        + "Sieh nach, wie deine Karte abgeschnitten hat."))
                .withLink("/episodes/" + slug);
    }

    /** The same news, for someone whose card was never in the running. */
    private static NotifyMessage lateMessage(String title, String slug) {
        return new NotifyMessage(Map.of(
                "en", "The bingo for “" + title + "” is resolved. You played after predictions "
                        + "closed, so your card is not ranked — but you can see how it did.",
                "de", "Das Bingo für „" + title + "“ ist aufgelöst. Du hast nach dem "
                        + "Schließen der Tipps gespielt, deine Karte wird daher nicht gewertet — "
                        + "du kannst aber sehen, wie sie abgeschnitten hat."))
                .withLink("/episodes/" + slug);
    }

    /** What to call this episode in a sentence. */
    private String episodeTitle(String slug) {
        try {
            DisplaySnapshot snapshot = ctx.feeds().display(slug);
            if (snapshot.title() != null && !snapshot.title().isBlank()) {
                return snapshot.title();
            }
        } catch (RuntimeException e) {
            // fall through to the slug
        }
        return slug;
    }

    // ---------------------------------------------------------------- site roll-up

    /**
     * Cumulative standings, recomputed from the rows rather than incremented - a tick that runs twice must
     * not count anything twice, and the cheapest way to guarantee that is to never carry a running total.
     *
     * <p>Only ranked cards count, and only from players who allow being listed.
     */
    private void publishStats(Map<String, Prefs> prefs, BingoScore.RankBy rankBy) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        List<CardResultRow> rows = schema.select(ENTITY_CARD_RESULT,
                Criteria.where("ranked", Criteria.Op.EQ, true), CardResultRow.class);

        Map<String, StandingRow> byAuthor = new LinkedHashMap<>();
        for (CardResultRow row : rows) {
            if (!prefsFor(prefs, row.author()).listedOrDefault()) {
                continue;
            }
            byAuthor.merge(row.author(),
                    new StandingRow(row.author(), row.fields(), row.lines(), 1, row.cells()),
                    (a, b) -> new StandingRow(a.author(), a.fields() + b.fields(), a.lines() + b.lines(),
                            a.cards() + b.cards(), a.cells() + b.cells()));
        }

        Comparator<BingoScore.Score> ordering = BingoScore.ordering(rankBy);
        List<StandingRow> standings = byAuthor.values().stream()
                .sorted(((Comparator<StandingRow>) (a, b) -> ordering.compare(a.asScore(), b.asScore()))
                        .thenComparing(StandingRow::author))
                .limit(MAX_PUBLISHED_ROWS)
                .toList();
        long episodes = rows.stream().map(CardResultRow::episode).distinct().count();

        ctx.store().put(Scope.site(), KEY_STATS, new Stats(standings, (int) episodes, now().toString()));
    }

    // ---------------------------------------------------------------- account deletion

    /**
     * {@inheritDoc}
     *
     * <p>The backend cannot delete a {@code USER} partition - {@code DocStore} throws on that scope - so the
     * person's own card and preferences go with their account, and what is left here is the derived record.
     * Those rows are pseudonymised rather than dropped: a leaderboard that silently loses a competitor stops
     * being a true record of what happened, and the entry corpus is what the whole statistics feature is
     * built on. The link to the person is what has to go, not the fact that a game was played.
     *
     * <p>A featured card is different, and is removed outright: it is the person's own words on display,
     * which is not something an aggregate needs.
     *
     * <p>Idempotent, as the host's retry requires: a second call finds nothing under the original id.
     */
    @Override
    public void eraseUser(String userId) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return;
        }
        // A fresh opaque id per erasure, so two erased people never merge into one competitor.
        String pseudonym = "erased:" + UUID.randomUUID();

        for (EntryRow row : schema.select(ENTITY_ENTRY, byAuthor(userId), EntryRow.class)) {
            schema.update(ENTITY_ENTRY, row.id(), Map.of("author", pseudonym));
        }
        for (CardResultRow row : schema.select(ENTITY_CARD_RESULT, byAuthor(userId), CardResultRow.class)) {
            schema.update(ENTITY_CARD_RESULT, row.id(), Map.of("author", pseudonym));
        }

        // Published documents are documents, not rows: an archived episode is never recomputed, so its copy
        // would keep the old id for good unless it is rewritten here.
        for (String slug : ctx.feeds().episodesIn(Scope.site())) {
            Scope scope = Scope.episode(slug);
            ctx.store().get(scope, KEY_LEADERBOARD, Leaderboard.class)
                    .map(board -> board.pseudonymise(userId, pseudonym))
                    .ifPresent(board -> ctx.store().put(scope, KEY_LEADERBOARD, board));
            ctx.store().get(scope, KEY_SHOWCASED, Showcased.class)
                    .map(showcased -> showcased.without(userId))
                    .ifPresent(showcased -> ctx.store().put(scope, KEY_SHOWCASED, showcased));
            ctx.store().get(scope, KEY_PARTICIPANTS, Participants.class)
                    .map(participants -> participants.without(userId))
                    .ifPresent(participants -> ctx.store().put(scope, KEY_PARTICIPANTS, participants));
        }

        ctx.logger().info("bingo erased the identity link on a user's rows");
    }

    @Override
    public Optional<Map<String, Object>> exportUser(String userId) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return Optional.empty();
        }
        List<EntryRow> entries = schema.select(ENTITY_ENTRY, byAuthor(userId), EntryRow.class);
        List<CardResultRow> results = schema.select(ENTITY_CARD_RESULT, byAuthor(userId), CardResultRow.class);
        if (entries.isEmpty() && results.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(Map.of("entries", entries, "results", results));
    }

    // ---------------------------------------------------------------- helpers

    private static Criteria byCard(String episode, String author) {
        return Criteria.where("episode", Criteria.Op.EQ, episode).and("author", Criteria.Op.EQ, author);
    }

    private static Criteria byAuthor(String author) {
        return Criteria.where("author", Criteria.Op.EQ, author);
    }

    private Instant now() {
        return clock.instant();
    }

    private static Instant parseInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private <T> T read(JsonNode node, Class<T> type) {
        try {
            return MAPPER.treeToValue(node, type);
        } catch (RuntimeException e) {
            ctx.logger().warn("bingo could not read a {} document", type.getSimpleName(), e);
            return null;
        }
    }

    private int intConfig(String key, int fallback) {
        return ctx.config().get(key, Integer.class, fallback);
    }

    private double doubleConfig(String key, double fallback) {
        return ctx.config().get(key, Double.class, fallback);
    }

    private boolean booleanConfig(String key, boolean fallback) {
        return ctx.config().get(key, Boolean.class, fallback);
    }

    // ---------------------------------------------------------------- documents and rows

    /** The lifecycle an episode's bingo moves through. Only {@code ARCHIVED} is terminal. */
    enum Phase { OPEN, LOCKED, RESOLVED, ARCHIVED }

    /** Grid and title. Its presence in the episode scope is what makes an episode have a bingo at all. */
    /**
     * Grid, title, and whether the middle square is a gift.
     *
     * <p>{@code freeCentre} is decided per bingo when it is created rather than derived from the size, and
     * absent means yes - which is both the traditional game and what a template written before this field
     * existed meant.
     */
    record Template(Integer size, String title, Boolean freeCentre) {
        int gridSize() {
            return size == null || size < 2 ? DEFAULT_GRID_SIZE : size;
        }

        /**
         * Whether the middle square is a gift rather than a square to fill in.
         *
         * <p>Absent means <strong>no</strong>: a bingo says so explicitly or every square is yours to write.
         * The opposite default would quietly hand everyone a point they never earned, which is exactly how
         * this was found. Only an odd grid has a single middle square at all.
         */
        boolean hasFreeCentre() {
            return Boolean.TRUE.equals(freeCentre) && gridSize() % 2 == 1;
        }
    }

    /** One person's card, as they wrote it. It carries no name: they are resolved at render. */
    record Card(List<String> entries) {
        List<String> safeEntries() {
            return entries == null ? List.of() : entries;
        }
    }

    /**
     * How a person wants to appear. Standing, not per episode.
     *
     * @param listed      whether their name and score may go on the public leaderboard
     * @param showcasable whether a podcaster may feature their whole card
     */
    record Prefs(Boolean listed, Boolean showcasable) {
        static final Prefs DEFAULT = new Prefs(null, null);

        boolean listedOrDefault() {
            return !Boolean.FALSE.equals(listed);
        }

        boolean showcasableOrDefault() {
            return !Boolean.FALSE.equals(showcasable);
        }
    }

    /** The podcaster's shared truth list, keyed by a candidate's canonical form. */
    record Resolution(Map<String, Boolean> hits) {
        boolean isHit(String canonical) {
            return hits != null && Boolean.TRUE.equals(hits.get(canonical));
        }
    }

    /** The podcaster's stated intent. Client-written, and it always beats the derived suggestion. */
    record Control(String phase, String updatedAt) {}

    /** Whom the podcaster picked to feature. Client-written. */
    record Showcase(List<String> userIds) {
        List<String> safeUserIds() {
            return userIds == null ? List.of() : userIds;
        }
    }

    /**
     * The lifecycle state this class derives. Backend-owned.
     *
     * <p>{@code openedBeforeRelease} is sticky and decided on first sight. Without it, a bingo created for
     * an episode that is already out would auto-lock on the next tick and produce a board on which nobody
     * could ever be ranked - the normal case while a podcaster is still setting one up.
     */
    record PhaseState(String phase, String suggested, boolean openedBeforeRelease,
                      boolean allowLate, String lockedAt, String resolvedAt, String archiveAt) {}

    /**
     * The things there are to tick off, from every card including the ones the browser cannot see.
     *
     * <p>{@code cards} is how many distinct cards carry each candidate, keyed by canonical form.
     * {@code Candidate.count} is how many entries landed in it, which is a larger number whenever somebody
     * wrote the same prediction twice — the two are not interchangeable, and only the former is what
     * "on n cards" means.
     */
    record Candidates(List<BingoFuzzy.Candidate> items, Map<String, String> assignments,
                      Map<String, Integer> cards, String computedAt) {}

    /** One card's standing. Only an id - the person is drawn from {@code ctx.users} at render. */
    record Row(String author, int fields, int lines, int cells, boolean ranked) {
        BingoScore.Score asScore() {
            return new BingoScore.Score(fields, lines, cells);
        }
    }

    /**
     * Per-episode scores. {@code late} is everyone who joined after the lock - played, but not ranked.
     *
     * <p>{@code published} is false until the bingo is resolved, and the row lists are empty then: a board
     * that creeps upward while somebody ticks answers off is a spoiler channel. {@code players} still says
     * how many are taking part, which is the part worth showing early — everybody who played, not only
     * those who agreed to be named, so it agrees with the featured-card picker on the same tile.
     */
    record Leaderboard(List<Row> ranked, List<Row> late, int players, int totalPlayers,
                       boolean published, List<Tally> distribution, String rankBy, String computedAt) {

        static Leaderboard empty(String computedAt) {
            return new Leaderboard(List.of(), List.of(), 0, 0, false, List.of(),
                    BingoScore.RankBy.LINES.name().toLowerCase(java.util.Locale.ROOT), computedAt);
        }

        Leaderboard pseudonymise(String author, String pseudonym) {
            return new Leaderboard(
                    ranked.stream().map(r -> r.author().equals(author)
                            ? new Row(pseudonym, r.fields(), r.lines(), r.cells(), r.ranked()) : r).toList(),
                    late.stream().map(r -> r.author().equals(author)
                            ? new Row(pseudonym, r.fields(), r.lines(), r.cells(), r.ranked()) : r).toList(),
                    players, totalPlayers, published, distribution, rankBy, computedAt);
        }
    }

    /** How many ranked cards share one score. Named nobody, bounded by the grid rather than the crowd. */
    record Tally(int lines, int fields, int count) {}

    /** Someone a podcaster could feature. An id only: the picker resolves it itself. */
    record Participant(String userId) {}

    /** Who could be featured for one episode. Backend-owned. */
    record Participants(List<Participant> items, String computedAt) {
        Participants without(String userId) {
            return new Participants(items.stream().filter(p -> !p.userId().equals(userId)).toList(),
                    computedAt);
        }
    }

    /** A featured card, copied out of its author's partition so anyone may read it. */
    record ShowcasedCard(String userId, List<String> entries) {}

    /** The featured cards for one episode. Backend-owned. */
    record Showcased(List<ShowcasedCard> items, String computedAt) {
        Showcased without(String userId) {
            return new Showcased(items.stream().filter(c -> !c.userId().equals(userId)).toList(),
                    computedAt);
        }
    }

    /** One player's cumulative standing across every resolved episode. */
    record StandingRow(String author, int fields, int lines, int cards, int cells) {
        BingoScore.Score asScore() {
            return new BingoScore.Score(fields, lines, cells);
        }
    }

    /** Cumulative standings, in the site scope. */
    record Stats(List<StandingRow> players, int episodes, String computedAt) {}

    /** Who has already been told this bingo resolved. Backend-owned, and why nobody is told twice. */
    record NotifyState(List<String> userIds, String updatedAt) {}

    /** A row of {@code plugin_bingo_entry}. The {@code id} component is assigned by the platform. */
    record EntryRow(long id, String episode, String author, int position, String text,
                    String canonical, boolean hit, boolean ranked, Instant recordedAt) {}

    /** A row of {@code plugin_bingo_card_result}. */
    record CardResultRow(long id, String episode, String author, int fields, int lines, int cells,
                         boolean ranked, Instant recordedAt) {}

    /** A card as collected for one tick, before it becomes rows. */
    private record CardInput(String author, List<String> entries) {}
}
