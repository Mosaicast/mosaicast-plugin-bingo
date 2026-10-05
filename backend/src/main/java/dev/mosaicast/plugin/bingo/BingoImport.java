// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.CrossUserStore;
import dev.mosaicast.plugin.api.DocEntry;
import dev.mosaicast.plugin.api.OwnedDocEntry;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.SchemaStore;
import dev.mosaicast.plugin.api.Scope;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * Bingos played before this site existed, and the claims that link them to the people who played them.
 *
 * <h2>Importing</h2>
 * The import script writes one {@code import:*} document per past bingo with a podcaster's token; a plugin
 * authors no routes, so this is the same intent-document path as every other podcaster action. Each pass
 * turns them into what a live bingo leaves behind - template, frozen ranked rows, a resolution, the
 * podcaster's pins - and the normal tick scores them from there, so an imported bingo is drawn, ranked and
 * charted exactly like one played here.
 *
 * <p><strong>Scores reproduce exactly.</strong> Each square says whether it came true back then. Grouping
 * still runs, so spellings of one thing become one candidate, but a group whose squares were judged
 * differently is split, and every imported spelling is pinned to its group. A later change of threshold
 * therefore cannot regroup history.
 *
 * <h2>Nobody is attached to an account by somebody else</h2>
 * Imported cards carry pseudonyms only ({@code import:<uuid>}); a real account id is refused. Such a player
 * counts exactly like somebody who opted out of the leaderboard - in places, averages and hit rates, never
 * named. The script prints one claim code per player; whoever enters it on the bingo page moves that
 * pseudonym's cards onto their own account. Codes live here as SHA-256 hashes only, because every document
 * is publicly readable.
 */
final class BingoImport {

    private static final Pattern PSEUDONYM = Pattern.compile("^import:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
    private static final Pattern HASH = Pattern.compile("^[0-9a-f]{64}$");
    /** How many applied and rejected imports the report keeps; the latest are the ones anybody looks for. */
    private static final int REPORT_KEEP = 200;

    private final PluginContext ctx;
    private final Clock clock;
    private final CrossUserStore everyone;
    private final BingoLifecycle lifecycle;

    BingoImport(PluginContext ctx, Clock clock, CrossUserStore everyone, BingoLifecycle lifecycle) {
        this.ctx = ctx;
        this.clock = clock;
        this.everyone = everyone;
        this.lifecycle = lifecycle;
    }

    /** Why an import was refused, in words for the report the script prints. */
    static final class Refused extends RuntimeException {
        Refused(String reason) {
            super(reason);
        }
    }

    /**
     * Takes in every waiting import, then every unclaim, then every claim.
     *
     * @param threshold the site's grouping threshold
     * @return whether any rows changed, so the site roll-up runs
     */
    boolean run(double threshold) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return false;
        }
        State state = new State(ctx.store().get(Scope.site(), KEY_IMPORTS, Imports.class).orElseGet(Imports::empty));
        boolean rows = false;

        for (DocEntry doc : ctx.store().query(Scope.site(), IMPORT_PREFIX)) {
            String id = doc.key();
            try {
                ImportDoc imported = BingoDocs.read(doc.value(), ImportDoc.class, ctx.logger());
                if (imported == null) {
                    throw new Refused("not an import document");
                }
                state.applied.add(apply(id, imported, threshold, state));
                rows = true;
            } catch (Refused e) {
                state.rejected.add(new ImportRejected(id, e.getMessage(), now()));
            } catch (RuntimeException e) {
                ctx.logger().warn("bingo could not import {}", id, e);
                state.rejected.add(new ImportRejected(id, "failed: " + e.getClass().getSimpleName(), now()));
            }
            ctx.store().delete(Scope.site(), id);
            state.changed = true;
        }

        Map<String, String> claimantByHash = claimants();
        for (DocEntry doc : ctx.store().query(Scope.site(), UNCLAIM_PREFIX)) {
            UnclaimDoc unclaim = BingoDocs.read(doc.value(), UnclaimDoc.class, ctx.logger());
            if (unclaim != null) {
                rows |= unclaim(unclaim, claimantByHash, state);
            }
            ctx.store().delete(Scope.site(), doc.key());
            state.changed = true;
        }
        for (Map.Entry<String, String> claim : claimantByHash.entrySet()) {
            rows |= claim(claim.getKey(), claim.getValue(), state);
        }

        if (state.changed) {
            ctx.store().put(Scope.site(), KEY_IMPORTS, state.toDoc(now()));
        }
        return rows;
    }

    // ---------------------------------------------------------------- importing

    private ImportApplied apply(String id, ImportDoc doc, double threshold, State state) {
        SchemaStore schema = ctx.schema();
        String slug = require(doc.slug(), "no episode");
        if (lifecycle.snapshotOf(slug) == null) {
            throw new Refused("unknown episode " + slug);
        }
        int size = doc.size() == null ? 0 : doc.size();
        if (size < 3 || size > 5) {
            throw new Refused("size must be 3, 4 or 5");
        }
        if (doc.freeCentre() == null) {
            throw new Refused("freeCentre must be stated");
        }
        boolean freeCentre = doc.freeCentre();
        if (freeCentre && size % 2 == 0) {
            throw new Refused("a " + size + "x" + size + " grid has no single middle square to give away");
        }
        List<ImportCard> cards = doc.cards() == null ? List.of() : doc.cards();
        if (cards.isEmpty()) {
            throw new Refused("no cards");
        }
        int squares = BingoScore.fillableCells(size, freeCentre);

        // Every check before anything is written: a bingo comes in whole or not at all.
        Set<String> authors = new LinkedHashSet<>();
        Map<String, Boolean> judged = new LinkedHashMap<>();
        for (int c = 0; c < cards.size(); c++) {
            ImportCard card = cards.get(c);
            String author = require(card.author(), "cards[" + c + "] has no author");
            if (!PSEUDONYM.matcher(author).matches()) {
                throw new Refused("cards[" + c + "]: authors must be import:<uuid>; an account is linked only by its own claim");
            }
            if (!authors.add(author)) {
                throw new Refused("cards[" + c + "]: " + author + " has two cards");
            }
            List<ImportSquare> list = card.squares() == null ? List.of() : card.squares();
            if (list.size() != squares) {
                throw new Refused("cards[" + c + "]: " + list.size() + " squares, a " + size + "x" + size
                        + (freeCentre ? " with a free centre" : "") + " needs " + squares);
            }
            boolean any = false;
            for (ImportSquare square : list) {
                String text = square == null || square.text() == null ? "" : square.text().strip();
                if (BingoFuzzy.normalise(text).isEmpty()) {
                    continue;
                }
                any = true;
                Boolean before = judged.put(BingoFuzzy.normalise(text), Boolean.TRUE.equals(square.hit()));
                if (before != null && before != Boolean.TRUE.equals(square.hit())) {
                    throw new Refused("\"" + text + "\" is marked true on one card and false on another");
                }
            }
            if (!any) {
                throw new Refused("cards[" + c + "] is empty");
            }
        }

        Scope scope = Scope.episode(slug);
        Optional<Template> existing = ctx.store().get(scope, KEY_TEMPLATE, Template.class);
        boolean merge = existing.isPresent();
        if (merge) {
            if (!"merge".equals(doc.onExisting())) {
                throw new Refused("the episode already has a bingo; pass --existing=merge to add these cards to it");
            }
            String phase = ctx.store().get(scope, KEY_PHASE, PhaseState.class).map(PhaseState::phase).orElse("OPEN");
            if (!Phase.RESOLVED.name().equals(phase)) {
                throw new Refused("only a resolved bingo can take imported cards (this one is " + phase + ")");
            }
            if (existing.get().gridSize() != size || existing.get().hasFreeCentre() != freeCentre) {
                throw new Refused("the grid does not match the bingo already there");
            }
            for (String author : authors) {
                if (schema.count(ENTITY_ENTRY, byCard(slug, author)) > 0) {
                    throw new Refused(author + " already has a card in this bingo");
                }
            }
        }

        // What happened, as the resolution and the pins that make it reproduce.
        Map<String, Boolean> decisions = new LinkedHashMap<>(ctx.store().get(scope, KEY_RESOLUTION, Resolution.class)
                .map(Resolution::hits).orElseGet(Map::of));
        Map<String, String> pins = new LinkedHashMap<>(ctx.store().get(scope, KEY_GROUPING, GroupingDoc.class)
                .map(GroupingDoc::pins).filter(p -> p != null).orElseGet(Map::of));
        Map<String, String> target = settle(judged, decisions, pins, slug, threshold);

        Instant now = clock.instant();
        if (!merge) {
            ctx.store().put(scope, KEY_TEMPLATE, new Template(size, blankToNull(doc.title()), freeCentre));
        }
        for (ImportCard card : cards) {
            boolean ranked = card.ranked() == null || card.ranked();
            for (int i = 0; i < card.squares().size(); i++) {
                ImportSquare square = card.squares().get(i);
                String text = square == null || square.text() == null ? "" : square.text().strip();
                String key = BingoFuzzy.normalise(text);
                if (key.isEmpty()) {
                    continue;
                }
                String canonical = target.get(key);
                Map<String, Object> values = new LinkedHashMap<>();
                values.put("episode", slug);
                values.put("author", card.author());
                values.put("position", BingoScore.gridPosition(i, size, freeCentre));
                values.put("text", text);
                values.put("canonical", canonical);
                values.put("hit", Boolean.TRUE.equals(decisions.get(canonical)));
                values.put("ranked", ranked);
                values.put("recordedAt", now);
                schema.insert(ENTITY_ENTRY, values);
                pins.put(text, canonical);
            }
        }
        ctx.store().put(scope, KEY_RESOLUTION, new Resolution(decisions));
        ctx.store().put(scope, KEY_GROUPING, Map.of("pins", pins, "updatedAt", now.toString()));
        if (!merge) {
            ctx.store().put(scope, KEY_CONTROL, new Control(Phase.RESOLVED.name(), now.toString()));
        }

        if (doc.claims() != null) {
            doc.claims().forEach((hash, pseudonym) -> {
                if (hash != null && HASH.matcher(hash).matches() && authors.contains(pseudonym)
                        && !state.claimed.containsKey(hash)) {
                    state.claims.put(hash, pseudonym);
                }
            });
        }
        return new ImportApplied(id, slug, cards.size(), merge, now.toString());
    }

    /**
     * Decides which group every imported spelling belongs to, adding a decision for each new group.
     *
     * <p>Spellings join the group the matcher puts them in when that group's decision agrees with how they
     * were judged; otherwise they become a group of their own. That is what keeps a fuzzy merge from giving
     * anybody a hit they did not have.
     *
     * @return normalised spelling to the canonical form it is pinned to
     */
    private Map<String, String> settle(Map<String, Boolean> judged, Map<String, Boolean> decisions,
                                       Map<String, String> pins, String slug, double threshold) {
        List<String> texts = new ArrayList<>(judged.keySet());
        Set<String> already = new LinkedHashSet<>();
        for (EntryRow row : ctx.schema().select(ENTITY_ENTRY, dev.mosaicast.plugin.api.Criteria.where(
                "episode", dev.mosaicast.plugin.api.Criteria.Op.EQ, slug), EntryRow.class)) {
            texts.add(row.text());
            already.add(BingoFuzzy.normalise(row.text()));
        }
        Map<String, String> normalisedPins = new GroupingDoc(pins, null).normalisedPins();
        BingoFuzzy.Grouping grouping = BingoFuzzy.group(texts, threshold, decisions.keySet(), normalisedPins);

        // Groups the import creates: one decision when its spellings agree, a split when they do not.
        Map<String, List<String>> fresh = new LinkedHashMap<>();
        Map<String, String> target = new HashMap<>();
        for (Map.Entry<String, Boolean> e : judged.entrySet()) {
            String group = grouping.canonicalOf(e.getKey());
            if (group == null) {
                group = e.getKey();
            }
            if (decisions.containsKey(group)) {
                if (decisions.get(group) != e.getValue().booleanValue() && already.contains(e.getKey())) {
                    // Groups follow the words, so the same words cannot be true for one card and false for
                    // another in one bingo: splitting them would flip the cards already here as well.
                    throw new Refused("\"" + e.getKey() + "\" is decided "
                            + (decisions.get(group) ? "true" : "false") + " in this bingo but marked "
                            + (e.getValue() ? "true" : "false") + " in the import");
                }
                target.put(e.getKey(), decisions.get(group) == e.getValue().booleanValue()
                        ? group : ownKey(e.getKey(), e.getValue(), decisions, judged));
            } else {
                fresh.computeIfAbsent(group, g -> new ArrayList<>()).add(e.getKey());
            }
        }
        for (Map.Entry<String, List<String>> group : fresh.entrySet()) {
            Set<Boolean> verdicts = new LinkedHashSet<>();
            group.getValue().forEach(t -> verdicts.add(judged.get(t)));
            if (verdicts.size() == 1) {
                decisions.put(group.getKey(), verdicts.iterator().next());
                group.getValue().forEach(t -> target.put(t, group.getKey()));
            } else {
                for (String t : group.getValue()) {
                    target.put(t, ownKey(t, judged.get(t), decisions, judged));
                }
            }
        }
        return target;
    }

    /** A group of the spelling's own, with its decision: its normalised form, or a variant of it if taken. */
    private static String ownKey(String normalised, boolean hit, Map<String, Boolean> decisions,
                                 Map<String, Boolean> judged) {
        String key = normalised;
        for (int n = 2; decisions.containsKey(key) && decisions.get(key) != hit; n++) {
            key = normalised + " imported " + n;
            while (judged.containsKey(key)) {
                key = key + " " + n;
            }
        }
        decisions.put(key, hit);
        return key;
    }

    // ---------------------------------------------------------------- claims

    /** Every code anybody has entered, as hash to claimant. A hash already used stays with its first user. */
    private Map<String, String> claimants() {
        Map<String, String> byHash = new LinkedHashMap<>();
        for (OwnedDocEntry entry : everyone.query(KEY_CLAIM)) {
            if (!KEY_CLAIM.equals(entry.key())) {
                continue;
            }
            ClaimDoc claim = BingoDocs.read(entry.value(), ClaimDoc.class, ctx.logger());
            if (claim == null || claim.codes() == null) {
                continue;
            }
            for (String code : claim.codes()) {
                String hash = hashOf(code);
                if (hash != null) {
                    byHash.putIfAbsent(hash, entry.userId().toString());
                }
            }
        }
        return byHash;
    }

    /** Moves a pseudonym's cards onto the claimant, except where they already have a card of their own. */
    private boolean claim(String hash, String user, State state) {
        String pseudonym = state.claims.get(hash);
        if (pseudonym == null || state.claimed.containsKey(hash)) {
            return false;
        }
        SchemaStore schema = ctx.schema();
        Map<String, List<EntryRow>> byEpisode = new LinkedHashMap<>();
        for (EntryRow row : schema.select(ENTITY_ENTRY, byAuthor(pseudonym), EntryRow.class)) {
            byEpisode.computeIfAbsent(row.episode(), e -> new ArrayList<>()).add(row);
        }
        List<String> moved = new ArrayList<>();
        int skipped = 0;
        for (Map.Entry<String, List<EntryRow>> e : byEpisode.entrySet()) {
            String slug = e.getKey();
            if (schema.count(ENTITY_ENTRY, byCard(slug, user)) > 0) {
                skipped++; // their own card is the record; the imported one stays anonymous and still counts
                continue;
            }
            move(slug, pseudonym, user);
            quiet(slug, user);
            moved.add(slug);
        }
        state.claims.remove(hash);
        state.claimed.put(hash, new ClaimResult(pseudonym, moved.size(), skipped, moved, now()));
        state.changed = true;
        return !moved.isEmpty();
    }

    /**
     * Takes a claim back and rotates its code: a leaked code someone else used, say. The cards go back to
     * the pseudonym, and the old code stops working, since it is still in the claimant's own partition and
     * would otherwise be claimed again on the next pass.
     */
    private boolean unclaim(UnclaimDoc unclaim, Map<String, String> claimantByHash, State state) {
        String hash = unclaim.hash();
        if (hash == null) {
            return false;
        }
        boolean rows = false;
        ClaimResult result = state.claimed.remove(hash);
        String pseudonym = result != null ? result.pseudonym() : state.claims.remove(hash);
        if (result != null) {
            String user = claimantByHash.get(hash);
            if (user != null) {
                for (String slug : result.episodes()) {
                    move(slug, user, pseudonym);
                }
                rows = !result.episodes().isEmpty();
            }
        }
        // The old code may still sit in the claimant's partition; with its hash gone it unlocks nothing.
        claimantByHash.remove(hash);
        if (pseudonym != null && unclaim.newHash() != null && HASH.matcher(unclaim.newHash()).matches()) {
            state.claims.put(unclaim.newHash(), pseudonym);
        }
        state.changed = true;
        return rows;
    }

    private void move(String slug, String from, String to) {
        SchemaStore schema = ctx.schema();
        for (EntryRow row : schema.select(ENTITY_ENTRY, byCard(slug, from), EntryRow.class)) {
            schema.update(ENTITY_ENTRY, row.id(), Map.of("author", to));
        }
        for (CardResultRow row : schema.select(ENTITY_CARD_RESULT, byCard(slug, from), CardResultRow.class)) {
            schema.update(ENTITY_CARD_RESULT, row.id(), Map.of("author", to));
        }
    }

    /** Counts the claimant as told already: news of a years-old resolution is not news. */
    private void quiet(String slug, String user) {
        Scope scope = Scope.episode(slug);
        NotifyState told = ctx.store().get(scope, KEY_NOTIFIED, NotifyState.class).orElse(null);
        Set<String> ids = new LinkedHashSet<>(told == null || told.userIds() == null ? List.of() : told.userIds());
        if (ids.add(user)) {
            ctx.store().put(scope, KEY_NOTIFIED, new NotifyState(List.copyOf(ids), now()));
        }
    }

    // ---------------------------------------------------------------- helpers

    /**
     * The hash a claim code is known by: SHA-256 over the code with everything but letters and digits
     * removed and upper-cased, so {@code gop-7k2m q9xd} and {@code GOP7K2MQ9XD} are one code. The script
     * hashes the same way.
     */
    static String hashOf(String code) {
        if (code == null) {
            return null;
        }
        String clean = code.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.ROOT);
        if (clean.length() < 12) {
            return null;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(clean.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String require(String value, String reason) {
        if (value == null || value.isBlank()) {
            throw new Refused(reason);
        }
        return value.strip();
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.strip();
    }

    private String now() {
        return clock.instant().toString();
    }

    /** The report, being changed during one pass. */
    private static final class State {
        final List<ImportApplied> applied;
        final List<ImportRejected> rejected;
        final Map<String, String> claims;
        final Map<String, ClaimResult> claimed;
        boolean changed;

        State(Imports doc) {
            applied = new ArrayList<>(doc.applied() == null ? List.of() : doc.applied());
            rejected = new ArrayList<>(doc.rejected() == null ? List.of() : doc.rejected());
            claims = new LinkedHashMap<>(doc.claims() == null ? Map.of() : doc.claims());
            claimed = new LinkedHashMap<>(doc.claimed() == null ? Map.of() : doc.claimed());
        }

        Imports toDoc(String now) {
            return new Imports(last(applied), last(rejected), claims, claimed, now);
        }

        private static <T> List<T> last(List<T> list) {
            return List.copyOf(list.subList(Math.max(0, list.size() - REPORT_KEEP), list.size()));
        }
    }
}
