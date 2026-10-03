// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.CrossUserStore;
import dev.mosaicast.plugin.api.EpisodePhase;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;

import tools.jackson.databind.JsonNode;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

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
 * <h2>When predictions close by themselves</h2>
 * A bingo is made for an episode that has not aired: a podcaster plans the episode, prepares the bingo while
 * it is quiet ({@link EpisodePhase#PLANNED}), and players fill in cards once it is announced
 * ({@link EpisodePhase#UPCOMING}). Its release closes predictions. The host says when that happens, twice:
 * {@code onEpisodeReleased} as it happens, best effort, and {@link DisplaySnapshot#phase()} on every tick,
 * which catches what the event missed. Nothing here infers a release from a publication date.
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

    static final int DEFAULT_INGEST_SECONDS = 60;
    static final double DEFAULT_FUZZY_THRESHOLD = 0.82;
    static final int DEFAULT_GRID_SIZE = 3;
    static final int DEFAULT_ARCHIVE_AFTER_DAYS = 30;
    /** How stale the site roll-up may get while none of its inputs visibly moved. */
    static final Duration ROLL_UP_REFRESH = Duration.ofHours(1);

    private final Clock clock;
    private PluginContext ctx;
    /** Every player's partition, read-only. Present because the manifest declares {@code data.readsAllUsers}. */
    private CrossUserStore everyone;
    /**
     * One pass over an episode at a time. The scheduled tick and the release listener run on different host
     * threads, and a pass rewrites a card's rows by deleting and inserting them: two at once would leave a
     * frozen card with its entries twice. The host serialises scheduled ticks across instances (ShedLock);
     * this lock serialises the release event with them, but only within one instance. A release bound on one
     * instance while another runs the tick can still overlap — not a case before core runs several instances
     * (ARCHITECTURE: v3), and the reason this lock is worth revisiting then.
     */
    private final Object passLock = new Object();
    private BingoLifecycle lifecycle;
    private BingoRecord record;
    private BingoPublish publish;
    /** What the last site roll-up was computed from, and when; see {@link #rollUp}. */
    private String lastRollUpInputs;
    private Instant lastRollUp;

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
        this.lifecycle = new BingoLifecycle(ctx, clock);
        this.record = new BingoRecord(ctx, clock);
        this.publish = new BingoPublish(ctx, clock, lifecycle);
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
        // The moment a planned episode goes out, close its predictions rather than up to one interval later,
        // while a fast listener could still rewrite a card with the episode playing. Best effort: the tick
        // reconciles by phase as well, so a release this instance never heard of still closes on time.
        ctx.onEpisodeReleased(this::released);
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
        synchronized (passLock) {
            Pass pass = pass();
            List<String> slugs = ctx.feeds().episodesIn(Scope.site());

            for (String slug : slugs) {
                try {
                    tickEpisode(slug, pass);
                } catch (RuntimeException e) {
                    // One broken episode must not cost every other episode its tick.
                    ctx.logger().warn("bingo tick failed for episode {}", slug, e);
                }
            }

            try {
                rollUp(pass, slugs);
            } catch (RuntimeException e) {
                ctx.logger().warn("bingo stats pass failed", e);
            }
        }
    }

    /**
     * A planned episode was released: one pass over it now, so its predictions close at the release.
     *
     * <p>A full pass, not just a new phase document: the pass that applies a lock is the one that ingests the
     * cards saved in the last moments before it as ranked (see {@link #tickEpisode}), and a phase written on
     * its own would leave the next tick to freeze those cards as latecomers. Idempotent with the tick, which
     * may handle the same release.
     */
    void released(String slug) {
        synchronized (passLock) {
            tickEpisode(slug, pass());
        }
    }

    /**
     * What one pass works from, read once: the configuration, everyone's preferences and everyone's cards.
     *
     * <p>Cards are read here, across every partition at once, rather than per episode: the cross-user read
     * has no filter but a key prefix, so asking once per episode read every card on the site once per
     * episode with a bingo.
     */
    private Pass pass() {
        return new Pass(settings(), readPrefs(), collectCards(), new LinkedHashSet<>());
    }

    /**
     * @param quiet filled during the pass: working-set episodes nobody but a podcaster may know exist
     */
    private record Pass(Settings settings, Map<String, Prefs> prefs, Map<String, List<CardInput>> cards,
                        Set<String> quiet) {}

    /**
     * The site-wide roll-up, recomputed only when something it is computed from moved.
     *
     * <p>It reads every ranked result on the site, so running it every tick for a quiet site was the most
     * expensive thing the plugin did. Its inputs are the result rows ({@link BingoRecord#takeChanged}), who
     * may be listed, how the site ranks, which episodes exist and which of them are still quiet. A slow
     * refresh covers anything else - a feed that changed under an archived episode, say.
     */
    private void rollUp(Pass pass, List<String> slugs) {
        boolean rowsChanged = record.takeChanged();
        List<String> unlisted = pass.prefs().entrySet().stream()
                .filter(e -> !e.getValue().listedOrDefault())
                .map(Map.Entry::getKey)
                .sorted()
                .toList();
        String fingerprint = String.join("|", pass.settings().rankBy().name(), String.join(",", unlisted),
                Integer.toHexString(slugs.hashCode()), String.join(",", new TreeSet<>(pass.quiet())));
        Instant now = now();
        boolean stale = lastRollUp == null || !now.isBefore(lastRollUp.plus(ROLL_UP_REFRESH));
        if (!rowsChanged && !stale && fingerprint.equals(lastRollUpInputs)) {
            return;
        }
        publish.stats(pass.prefs(), pass.settings().rankBy());
        lastRollUpInputs = fingerprint;
        lastRollUp = now;
    }

    /** The configuration one pass works under, read once per pass. */
    private Settings settings() {
        return new Settings(
                doubleConfig("fuzzyThreshold", DEFAULT_FUZZY_THRESHOLD),
                booleanConfig("allowLateEntries", true),
                intConfig("archiveAfterDays", DEFAULT_ARCHIVE_AFTER_DAYS),
                intConfig("defaultGridSize", DEFAULT_GRID_SIZE),
                BingoScore.RankBy.of(ctx.config().get("rankBy", String.class, "lines")));
    }

    private record Settings(double threshold, boolean allowLate, int archiveAfterDays, int defaultGridSize,
                            BingoScore.RankBy rankBy) {}

    private void tickEpisode(String slug, Pass pass) {
        Settings settings = pass.settings();
        Map<String, Prefs> prefs = pass.prefs();
        double threshold = settings.threshold();
        boolean allowLate = settings.allowLate();
        int archiveAfterDays = settings.archiveAfterDays();
        int defaultGridSize = settings.defaultGridSize();
        BingoScore.RankBy rankBy = settings.rankBy();
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

        EpisodePhase release = lifecycle.releasePhaseOf(slug);
        if (release == EpisodePhase.PLANNED) {
            pass.quiet().add(slug);
        }
        PhaseState state = lifecycle.resolvePhase(slug, release, previous, archiveAfterDays, allowLate);
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

        Map<String, List<EntryRow>> rows = record.rowsOf(slug);
        List<CardInput> cards = whatCardsSay(pass.cards().getOrDefault(slug, List.of()), rows, template.get(),
                writtenUnder, allowLate);
        Resolution resolution = ctx.store().get(scope, KEY_RESOLUTION, Resolution.class)
                .orElseGet(() -> new Resolution(Map.of()));
        Map<String, String> pins = ctx.store().get(scope, KEY_GROUPING, GroupingDoc.class)
                .map(GroupingDoc::normalisedPins)
                .orElseGet(Map::of);

        List<String> everyEntry = new ArrayList<>();
        cards.forEach(c -> everyEntry.addAll(c.entries()));
        // Decided groups are seeded so a later entry cannot rename them out from under their decision, and
        // the podcaster's merges and splits are applied over the matching (see BingoFuzzy.group).
        BingoFuzzy.Grouping grouping = BingoFuzzy.group(everyEntry, threshold, resolution.decided(), pins);

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

        record.ingest(slug, cards, rows, grouping, template.get(), writtenUnder, allowLate);
        Leaderboard board = record.score(slug, template.get(), grouping, resolution, prefs, phase, rankBy);
        ctx.store().put(scope, KEY_LEADERBOARD, board);

        publish.showcase(slug, cards, prefs);

        // A notification names the episode and links to it. While the episode is quiet nobody but a
        // podcaster may know it exists, so the news waits until it is announced; who has been told is
        // tracked per person, so the first tick after that sends it.
        if (phase == Phase.RESOLVED && release != EpisodePhase.PLANNED) {
            publish.notifyResolved(slug);
        }
    }

    // ---------------------------------------------------------------- cards and preferences

    /**
     * What each card says for this pass: the live document while it is still read, the frozen record
     * once it is not.
     *
     * <p>Everything derived from cards - the candidate list, its counts, a featured card - is built from
     * this, never straight from the documents. After the freeze a document is a scratchpad its owner can
     * still write, and reading it here let anyone put text in the public candidate list, or change a
     * featured card, that no record carried.
     *
     * <p>A card is read live while predictions were open, or once for a latecomer who has no rows yet and
     * may still play. Someone with rows and no document any more is still on the record.
     */
    private static List<CardInput> whatCardsSay(List<CardInput> live, Map<String, List<EntryRow>> rows,
                                                Template template, Phase writtenUnder, boolean allowLate) {
        Map<String, CardInput> out = new java.util.TreeMap<>();
        for (CardInput card : live) {
            boolean frozen = writtenUnder != Phase.OPEN && rows.containsKey(card.author());
            boolean reading = writtenUnder == Phase.OPEN || (!frozen && allowLate);
            if (reading) {
                out.put(card.author(), card);
            }
        }
        rows.forEach((author, authorRows) -> {
            if (!out.containsKey(author)) {
                out.put(author, new CardInput(author, entriesOf(authorRows, template)));
            }
        });
        return List.copyOf(out.values());
    }

    /** A card's entries back from its rows, in the order they were written, blanks where nothing was. */
    private static List<String> entriesOf(List<EntryRow> rows, Template template) {
        int size = template.gridSize();
        boolean freeCentre = template.hasFreeCentre();
        String[] entries = new String[BingoScore.fillableCells(size, freeCentre)];
        java.util.Arrays.fill(entries, "");
        for (EntryRow row : rows) {
            int index = BingoScore.entryIndex(row.position(), size, freeCentre);
            if (index >= 0 && index < entries.length) {
                entries[index] = row.text();
            }
        }
        return List.of(entries);
    }

    /**
     * Everyone's card, by episode.
     *
     * <p>Read across partitions, because that is the only way anything sees more than its own card. This is
     * backend-only and has no HTTP surface, which is what makes the aggregate honest: the id comes from the
     * partition the document lives in, never from something a client said.
     */
    private Map<String, List<CardInput>> collectCards() {
        Map<String, List<CardInput>> bySlug = new LinkedHashMap<>();
        for (OwnedDocEntry entry : everyone.query(CARD_PREFIX)) {
            String slug = entry.key().substring(CARD_PREFIX.length());
            Card card = read(entry.value(), Card.class);
            if (card != null && !slug.isEmpty()) {
                bySlug.computeIfAbsent(slug, s -> new ArrayList<>())
                        .add(new CardInput(entry.userId().toString(), card.safeEntries()));
            }
        }
        bySlug.values().forEach(cards -> cards.sort(Comparator.comparing(CardInput::author)));
        return bySlug;
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

    private Instant now() {
        return clock.instant();
    }

    private <T> T read(JsonNode node, Class<T> type) {
        return BingoDocs.read(node, type, ctx.logger());
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
        }
