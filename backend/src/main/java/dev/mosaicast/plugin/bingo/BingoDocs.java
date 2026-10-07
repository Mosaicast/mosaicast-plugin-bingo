// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Criteria;
import org.slf4j.Logger;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Every document and row shape this plugin reads or writes, and the keys they live under.
 *
 * <p>Kept in one place, mirrored by {@code frontend/src/keys.ts} and {@code types.ts}, so the two halves cannot
 * drift apart silently. Nothing here touches a context: these are shapes, not behaviour.
 */
final class BingoDocs {

    private BingoDocs() {}

    /** Grid and title, written by the podcaster. Its presence is what makes an episode have a bingo. */
    static final String KEY_TEMPLATE = "template";
    /** The podcaster's shared truth list: canonical entry to hit/miss. Client-written. */
    static final String KEY_RESOLUTION = "resolution";
    /** The podcaster's lifecycle <em>intent</em>. Client-written, deliberately not backend-owned. */
    static final String KEY_CONTROL = "control";
    /**
     * The podcaster's corrections to the automatic grouping: which entry belongs to which group. Client-written,
     * deliberately not backend-owned - it is an intent, applied on the next pass.
     */
    static final String KEY_GROUPING = "grouping";
    /** Which players the podcaster has chosen to feature, as ids. Client-written. */
    static final String KEY_SHOWCASE = "showcase";

    /** The lifecycle <em>state</em> this class derives from the intent and the feed. Backend-owned. */
    static final String KEY_PHASE = "phase";
    /** The fuzzy-grouped things to tick off, from every card. Backend-owned. */
    static final String KEY_CANDIDATES = "candidates";
    /** Per-episode scores, for players who allow being listed. Backend-owned. */
    static final String KEY_LEADERBOARD = "leaderboard";
    /** What happened in one bingo, in a few lines - once it is resolved. Backend-owned. */
    static final String KEY_RECAP = "recap";
    /**
     * What came true, copied out of {@code resolution} once the bingo is resolved and empty before. Fans
     * read this; {@code resolution} itself is the podcaster's working list and floored to them, so a
     * half-ticked list never reaches anyone else. Backend-owned.
     */
    static final String KEY_ANSWERS = "answers";
    /** Who could be featured, as ids only - the picker's raw material. Backend-owned. */
    static final String KEY_PARTICIPANTS = "participants";
    /** The featured cards, copied out so anyone may read them. Backend-owned. */
    static final String KEY_SHOWCASED = "showcased";
    /** Predictions people keep making, in the site scope, for the card editor to offer. Backend-owned. */
    static final String KEY_SUGGESTIONS = "suggestions";
    /**
     * A bingo played before this site existed, waiting to be taken in: {@code import:<batch>-<n>}, site scope.
     * Client-written by the import script with a podcaster's token, and deleted by the backend once applied.
     */
    static final String IMPORT_PREFIX = "import:";
    /** A request to take a claim back and rotate its code: {@code unclaim:<hash>}, site scope. Client-written. */
    static final String UNCLAIM_PREFIX = "unclaim:";
    /** What became of each import and claim, in the site scope. Backend-owned. */
    static final String KEY_IMPORTS = "imports";
    /** A player's claim codes for imported cards, in their own partition. */
    static final String KEY_CLAIM = "claim";
    /** How past bingos went, episode after episode, in the site scope. Backend-owned. */
    static final String KEY_HISTORY = "history";
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

    /** How many rows a published board carries at most, so the document cannot grow without end. */
    static final int MAX_PUBLISHED_ROWS = 50;

    static final ObjectMapper MAPPER = JsonMapper.builder().build();

    static Criteria byCard(String episode, String author) {
        return Criteria.where("episode", Criteria.Op.EQ, episode).and("author", Criteria.Op.EQ, author);
    }

    static Criteria byAuthor(String author) {
        return Criteria.where("author", Criteria.Op.EQ, author);
    }

    static Instant parseInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** A document as {@code type}, or {@code null} - logged - when somebody wrote something else there. */
    static <T> T read(JsonNode node, Class<T> type, Logger log) {
        try {
            return MAPPER.treeToValue(node, type);
        } catch (RuntimeException e) {
            log.warn("bingo could not read a {} document", type.getSimpleName(), e);
            return null;
        }
    }

    static Prefs prefsFor(Map<String, Prefs> prefs, String author) {
        if (author.startsWith(IMPORT_PREFIX)) {
            // An imported player nobody has claimed yet chose nothing, so nothing is shown: counted like
            // somebody who opted out, never named, never featured. Claiming makes their own choice apply.
            return Prefs.UNCLAIMED;
        }
        Prefs p = prefs.get(author);
        return p == null ? Prefs.DEFAULT : p;
    }

    // ---------------------------------------------------------------- documents and rows

    /** The lifecycle an episode's bingo moves through. Only {@code ARCHIVED} is terminal. */
    enum Phase { OPEN, LOCKED, RESOLVED, ARCHIVED }

    /**
     * Grid, title, and whether the middle square is a gift. Its presence in the episode scope is what makes
     * an episode have a bingo at all.
     *
     * <p>{@code freeCentre} is decided per bingo when it is created rather than derived from the size, and
     * absent means yes - which is both the traditional game and what a template written before this field
     * existed meant.
     */
    record Template(Integer size, String title, Boolean freeCentre) {
        int gridSize() {
            return size == null || size < 2 ? BingoPlugin.DEFAULT_GRID_SIZE : size;
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
        static final Prefs UNCLAIMED = new Prefs(false, false);

        boolean listedOrDefault() {
            return !Boolean.FALSE.equals(listed);
        }

        boolean showcasableOrDefault() {
            return !Boolean.FALSE.equals(showcasable);
        }
    }

    /** The podcaster's shared truth list, keyed by a candidate's canonical form. */
    /** {@link #KEY_ANSWERS}: the resolution's decisions, keyed by canonical form, or none before RESOLVED. */
    record Answers(Map<String, Boolean> hits) {}

    record Resolution(Map<String, Boolean> hits) {
        boolean isHit(String canonical) {
            return hits != null && Boolean.TRUE.equals(hits.get(canonical));
        }

        /** Every group somebody has decided on, hit or miss: the ones whose identity must not move. */
        java.util.Set<String> decided() {
            return hits == null ? java.util.Set.of() : hits.keySet();
        }
    }

    /**
     * The podcaster's corrections to the grouping, keyed by an entry as written.
     *
     * <p>The value is the canonical form of the group the entry belongs in (a merge), or an empty string for
     * "a group of its own" (a split). Keyed by the written text rather than its normalised form so the
     * browser, which only ever sees written texts, never needs its own copy of the normalisation rules.
     */
    record GroupingDoc(Map<String, String> pins, String updatedAt) {
        /** The pins as {@link BingoFuzzy#group} takes them: normalised entry to canonical form. */
        Map<String, String> normalisedPins() {
            Map<String, String> out = new java.util.LinkedHashMap<>();
            if (pins == null) {
                return out;
            }
            pins.forEach((text, target) -> {
                String key = BingoFuzzy.normalise(text);
                if (key.isEmpty()) {
                    return;
                }
                String value = target == null || target.isBlank() ? key : BingoFuzzy.normalise(target);
                out.put(key, value.isEmpty() ? key : value);
            });
            return out;
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
     * The lifecycle state the backend derives. Backend-owned.
     *
     * <p>{@code openedBeforeRelease} is sticky and decided on first sight. Without it, a bingo created for
     * an episode that is already out would auto-lock on the next tick and produce a board on which nobody
     * could ever be ranked - the normal case while a podcaster is still setting one up.
     *
     * <p>{@code fuzzyThreshold} rides along because there is no {@code ctx.config} in a browser, and the card
     * editor warns about two squares that will count as one by the same threshold the tick groups with.
     */
    record PhaseState(String phase, String suggested, boolean openedBeforeRelease,
                      boolean allowLate, String lockedAt, String resolvedAt, String archiveAt,
                      Double fuzzyThreshold) {

        PhaseState withThreshold(double threshold) {
            return new PhaseState(phase, suggested, openedBeforeRelease, allowLate, lockedAt, resolvedAt,
                    archiveAt, threshold);
        }
    }

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

    /**
     * One bingo in a few lines. Backend-owned, and empty until it is resolved, for the same reason the board
     * is: "the most predicted thing came true" is the spoiler.
     *
     * @param players   everyone who played, late ones included
     * @param ranked    how many cards were in the running
     * @param avgFields squares that came true on an average ranked card, the free centre included
     * @param withLine  the share of ranked cards, 0 to 1, with at least one complete line
     */
    record Recap(boolean published, int players, int ranked, double avgFields, double withLine,
                 Highlight mostPredicted, Highlight rarestHit, Highlight biggestMiss, String computedAt) {

        static Recap unpublished(int players, String computedAt) {
            return new Recap(false, players, 0, 0, 0, null, null, null, computedAt);
        }
    }

    /** A candidate worth naming in a recap: what people called it, on how many cards, whether it happened. */
    record Highlight(String label, int cards, boolean hit) {}

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
    record Stats(List<StandingRow> players, int episodes, List<BingoSummary> bingos, String computedAt) {}

    /**
     * One bingo, as the site page lists it. Only episodes everyone may know about.
     *
     * @param title   the bingo's own name, if the podcaster gave one; the episode's title is read live
     * @param players everyone who played, or {@code null} for an archived bingo, which is never read again
     */
    record BingoSummary(String slug, String title, String phase, Integer players) {}

    /**
     * One prediction people keep making.
     *
     * @param label    the first spelling of it anyone used
     * @param people   how many different people wrote it - never fewer than two
     * @param episodes on how many episodes' cards it appeared
     * @param hits     on how many of those it came true
     */
    record Suggestion(String label, int people, int episodes, int hits) {}

    /** Predictions people keep making, for the card editor. Site scope, backend-owned. */
    record Suggestions(List<Suggestion> items, String computedAt) {}

    /** Who has already been told this bingo resolved. Backend-owned, and why nobody is told twice. */
    record NotifyState(List<String> userIds, String updatedAt) {}

    /** A row of {@code plugin_bingo_entry}. The {@code id} component is assigned by the platform. */
    record EntryRow(long id, String episode, String author, int position, String text,
                    String canonical, boolean hit, boolean ranked, Instant recordedAt) {}

    /** A row of {@code plugin_bingo_card_result}. */
    record CardResultRow(long id, String episode, String author, int fields, int lines, int cells,
                         boolean ranked, Instant recordedAt) {}

    /** A card as collected for one tick, before it becomes rows. */
                    record CardInput(String author, List<String> entries) {}

    // ---------------------------------------------------------------- history (see BingoHistory)

    /**
     * How past bingos went, for the site page's charts. Site scope, backend-owned, resolved and public
     * bingos only. A series, a place on it and a record name a player, so only listed players get one;
     * everything that names nobody counts every ranked card.
     *
     * @param episodes     oldest first
     * @param players      at most {@code MAX_PUBLISHED_ROWS}, best cumulative score first
     * @param distribution how many ranked cards ended with each number of lines
     */
    record History(List<HistoryEpisode> episodes, List<PlayerSeries> players, List<LineCount> distribution,
                   Map<String, ScopeStats> scopes, String rankBy, String computedAt) {}

    /**
     * Rankings and records within one scope: {@code "all"}, or one season as {@code <feed>:<season>}.
     *
     * @param byTotal   the best listed players by total score
     * @param byAverage the best listed players by score per card, among those with at least {@code bar} cards
     * @param bar       how many cards the per-card ranking asks for here
     * @param belowBar  how many listed players have fewer; counted, never named
     * @param bingos    how many bingos the scope holds
     */
    record ScopeStats(List<StandingRow> byTotal, List<AverageRow> byAverage, int bar, int belowBar,
                      HistoryRecords records, int bingos) {}

    /** One player's score per card within a scope. */
    record AverageRow(String author, int cards, double fields, double lines) {}

    /**
     * One resolved bingo in the history.
     *
     * @param title      the bingo's own name, if it has one; the episode's title is read live
     * @param players    every card, late ones included
     * @param ranked     the cards that were in the running; the averages are over these
     * @param hitRate    the share, 0 to 1, of distinct predictions that came true
     * @param candidates how many distinct predictions there were
     * @param lineCounts how many ranked cards ended with 0, 1, 2… lines, by index - so a filtered view can
     *                   add up its own distribution
     */
    record HistoryEpisode(String slug, String title, String feed, Integer season, Integer episodeNo,
                          String publishedAt, int players, int ranked, int late, double avgFields, double avgLines,
                          double withLine, double hitRate, int candidates, List<Integer> lineCounts) {}

    /** One listed player's ranked cards, oldest first. */
    record PlayerSeries(String author, int cards, List<Point> points) {}

    /**
     * One card on a series.
     *
     * @param e the episode's index in {@link History#episodes()}
     * @param f squares that came true
     * @param l lines
     * @param p place among every ranked card of that episode, 1 the best, ties sharing a place
     */
    record Point(int e, int f, int l, int p) {}

    /** How many ranked cards ended with this many lines. */
    record LineCount(int lines, int cards) {}

    /** The history's records. Each names a listed player or an episode, or is {@code null}. */
    record HistoryRecords(CardRecord bestCard, PlayerCount mostCards, PlayerCount longestStreak,
                          EpisodeRate mostPredictable, EpisodeRate leastPredictable) {}

    /** One player's single best card. */
    record CardRecord(String author, String slug, int fields, int lines, int cells) {}

    /** A player and how many of something they have. */
    record PlayerCount(String author, int count) {}

    /** An episode and the share of its predictions that came true. */
    record EpisodeRate(String slug, double hitRate) {}

    // ---------------------------------------------------------------- imports and claims (see BingoImport)

    /**
     * One past bingo as the import script hands it over. Cards carry pseudonymous authors only
     * ({@code import:<uuid>}); nobody is attached to an account except by their own claim.
     *
     * @param onExisting {@code "merge"} to add these cards to a resolved bingo already on the episode;
     *                   anything else refuses such an episode
     * @param claims     claim-code hash (SHA-256, hex) to the pseudonym it unlocks
     */
    record ImportDoc(String slug, String title, Integer size, Boolean freeCentre, String onExisting,
                     List<ImportCard> cards, Map<String, String> claims) {}

    /** One imported card: its pseudonymous author, whether it was in the running, its squares in order. */
    record ImportCard(String author, Boolean ranked, List<ImportSquare> squares) {}

    /** One square of an imported card, as written and as judged back then. */
    record ImportSquare(String text, Boolean hit) {}

    /** A request to take a claim back: the code's hash, and the hash of the code that replaces it. */
    record UnclaimDoc(String hash, String newHash) {}

    /** A player's claim codes, in their own partition. */
    record ClaimDoc(List<String> codes) {}

    /**
     * What became of every import and claim. Backend-owned and public, so it holds hashes only: a claim
     * code is the secret, and only its holder can find their own result here.
     *
     * @param claims  unused code hash to the pseudonym it unlocks
     * @param claimed used code hash to what claiming it did
     */
    record Imports(List<ImportApplied> applied, List<ImportRejected> rejected, Map<String, String> claims,
                   Map<String, ClaimResult> claimed, String updatedAt) {

        static Imports empty() {
            return new Imports(List.of(), List.of(), Map.of(), Map.of(), null);
        }
    }

    /** An import that became (or joined) a bingo. */
    record ImportApplied(String id, String slug, int cards, boolean merged, String at) {}

    /** An import that was refused, and why. */
    record ImportRejected(String id, String reason, String at) {}

    /**
     * What one claim did.
     *
     * @param linked   bingos whose imported card moved to the claimant
     * @param skipped  bingos left anonymous because the claimant already had their own card there
     * @param episodes the episodes that moved, so the claim can be taken back
     */
    record ClaimResult(String pseudonym, int linked, int skipped, List<String> episodes, String at,
                       Sealed sealed) {

        ClaimResult withSealed(Sealed next) {
            return new ClaimResult(pseudonym, linked, skipped, episodes, at, next);
        }
    }

    /**
     * The claimed cards, encrypted with the claim code, so the claimant's browser - the only thing that can
     * write their partition, and the only thing besides them that knows the code - can copy them in.
     * AES-256-GCM under a PBKDF2-HMAC-SHA256 key from the code (see {@code BingoImport.seal}).
     *
     * @param iv       base64, 12 bytes
     * @param data     base64 ciphertext with its tag: JSON {@code {slug: [entries…]}}
     * @param episodes the slugs sealed, so a later change re-seals
     */
    record Sealed(String iv, String data, List<String> episodes) {}
}
