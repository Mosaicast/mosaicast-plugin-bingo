// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.Criteria;
import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.NotificationException;
import dev.mosaicast.plugin.api.NotifyMessage;
import dev.mosaicast.plugin.api.Notifier;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.SchemaStore;
import dev.mosaicast.plugin.api.Scope;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * Everything derived that leaves the tick for other people to read: featured cards, the resolve
 * notification and the site-wide standings.
 */
final class BingoPublish {

    private final PluginContext ctx;
    private final Clock clock;
    private final BingoLifecycle lifecycle;

    BingoPublish(PluginContext ctx, Clock clock, BingoLifecycle lifecycle) {
        this.ctx = ctx;
        this.clock = clock;
        this.lifecycle = lifecycle;
    }

    private Instant now() {
        return clock.instant();
    }

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
    void showcase(String slug, List<CardInput> cards, Map<String, Prefs> prefs) {
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
    void notifyResolved(String slug) {
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
    boolean send(Notifier notifier, List<UUID> ids, NotifyMessage message,
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
    static NotifyMessage rankedMessage(String title, String slug) {
        return new NotifyMessage(Map.of(
                "en", "The bingo for “" + title + "” is resolved. See how your card scored.",
                "de", "Das Bingo für „" + title + "“ ist aufgelöst. "
                        + "Sieh nach, wie deine Karte abgeschnitten hat."))
                .withLink("/episodes/" + slug);
    }

    /** The same news, for someone whose card was never in the running. */
    static NotifyMessage lateMessage(String title, String slug) {
        return new NotifyMessage(Map.of(
                "en", "The bingo for “" + title + "” is resolved. You played after predictions "
                        + "closed, so your card is not ranked — but you can see how it did.",
                "de", "Das Bingo für „" + title + "“ ist aufgelöst. Du hast nach dem "
                        + "Schließen der Tipps gespielt, deine Karte wird daher nicht gewertet — "
                        + "du kannst aber sehen, wie sie abgeschnitten hat."))
                .withLink("/episodes/" + slug);
    }

    /** What to call this episode in a sentence. */
    String episodeTitle(String slug) {
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
     * <p>Only ranked cards count, and only from players who allow being listed — and only from episodes
     * everyone can see. This document is public, so cards played on a quiet planned episode would announce
     * that it exists; and a plan that was cancelled took its documents with it but not these rows.
     *
     * <p>And only from bingos that are resolved. Before that a card's score is whatever the podcaster has
     * ticked off so far, and standings that climb while they tick would leak exactly the progress the
     * episode's own leaderboard withholds until the end.
     */
    void stats(Corpus corpus, Map<String, Prefs> prefs, BingoScore.RankBy rankBy, List<BingoSummary> bingos) {
        List<CardResultRow> rows = corpus.results().stream()
                .filter(CardResultRow::ranked)
                .filter(row -> corpus.resolved().contains(row.episode()))
                .filter(row -> corpus.isPublic(row.episode()))
                .toList();

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

        // An archived bingo was never checked against the feed on this pass; a quiet one was left out already.
        List<BingoSummary> listed = bingos.stream()
                .filter(b -> !Phase.ARCHIVED.name().equals(b.phase()) || corpus.isPublic(b.slug()))
                .toList();
        ctx.store().put(Scope.site(), KEY_STATS,
                new Stats(standings, (int) episodes, listed, now().toString()));
    }

    // ---------------------------------------------------------------- suggestions

    /**
     * Predictions people keep making, for the card editor to offer.
     *
     * <p>Grouped the way a single bingo is, across every ranked entry of every episode everyone can see, and
     * published only where at least {@link #MIN_AUTHORS} different people wrote the same thing: a prediction
     * one person made is their own words, and offering it to everybody else would quietly publish them.
     * Quiet episodes are left out for the same reason the standings leave them out.
     *
     * <p>Run with the site roll-up, so only when something it is computed from changed.
     */
    void suggestions(Corpus corpus, double threshold) {
        // Whether a prediction came true is only settled once its bingo is resolved; counted earlier, the
        // number would move while a podcaster ticks off and give the progress away.
        Set<String> resolved = corpus.resolved();
        List<EntryRow> rows = corpus.entries().stream()
                .filter(EntryRow::ranked)
                .filter(row -> corpus.isPublic(row.episode()))
                .toList();

        BingoFuzzy.Grouping grouping = BingoFuzzy.group(rows.stream().map(EntryRow::text).toList(), threshold);
        Map<String, Set<String>> authors = new LinkedHashMap<>();
        Map<String, Set<String>> episodes = new LinkedHashMap<>();
        Map<String, Set<String>> hitIn = new LinkedHashMap<>();
        for (EntryRow row : rows) {
            String canonical = grouping.canonicalOf(row.text());
            if (canonical == null) {
                continue;
            }
            authors.computeIfAbsent(canonical, c -> new LinkedHashSet<>()).add(row.author());
            episodes.computeIfAbsent(canonical, c -> new LinkedHashSet<>()).add(row.episode());
            if (row.hit() && resolved.contains(row.episode())) {
                hitIn.computeIfAbsent(canonical, c -> new LinkedHashSet<>()).add(row.episode());
            }
        }

        List<Suggestion> items = grouping.candidates().stream()
                .filter(c -> authors.getOrDefault(c.canonical(), Set.of()).size() >= MIN_AUTHORS)
                .map(c -> new Suggestion(c.label(), authors.get(c.canonical()).size(),
                        episodes.get(c.canonical()).size(), hitIn.getOrDefault(c.canonical(), Set.of()).size()))
                .sorted(Comparator.comparingInt(Suggestion::episodes).reversed()
                        .thenComparing(Comparator.comparingInt(Suggestion::people).reversed())
                        .thenComparing(Suggestion::label))
                .limit(MAX_SUGGESTIONS)
                .toList();

        ctx.store().put(Scope.site(), KEY_SUGGESTIONS, new Suggestions(items, now().toString()));
    }

    /** The bingos whose answers are settled: resolved, or archived after being resolved. */
    private static Set<String> resolvedOf(List<BingoSummary> bingos) {
        Set<String> out = new LinkedHashSet<>();
        for (BingoSummary b : bingos) {
            if (Phase.RESOLVED.name().equals(b.phase()) || Phase.ARCHIVED.name().equals(b.phase())) {
                out.add(b.slug());
            }
        }
        return out;
    }

    /** How many different people must have written a prediction before it is offered to anybody else. */
    static final int MIN_AUTHORS = 2;
    /** How many suggestions the document carries; every card editor on the site reads it. */
    static final int MAX_SUGGESTIONS = 30;

    // ---------------------------------------------------------------- the roll-up's rows

    /**
     * Everything the site roll-up is computed from, read once per roll-up and shared by the standings, the
     * suggestions and the history - each used to select the same tables on its own.
     *
     * @param results  every {@code card_result} row, ranked and late
     * @param entries  every {@code entry} row
     * @param visible  each episode in the rows or the bingo list that everyone may see, with its snapshot
     * @param resolved the bingos whose answers are settled
     */
    record Corpus(List<CardResultRow> results, List<EntryRow> entries, Map<String, DisplaySnapshot> visible,
                  Set<String> resolved) {

        boolean isPublic(String slug) {
            return visible.containsKey(slug);
        }
    }

    /** Reads the rows and checks each episode against the feed once. {@code null} without a schema. */
    Corpus corpus(List<BingoSummary> bingos) {
        SchemaStore schema = ctx.schema();
        if (schema == null) {
            return null;
        }
        List<CardResultRow> results = schema.select(ENTITY_CARD_RESULT, Criteria.all(), CardResultRow.class);
        List<EntryRow> entries = schema.select(ENTITY_ENTRY, Criteria.all(), EntryRow.class);
        Set<String> slugs = new LinkedHashSet<>();
        results.forEach(r -> slugs.add(r.episode()));
        bingos.forEach(b -> slugs.add(b.slug()));
        Map<String, DisplaySnapshot> visible = new LinkedHashMap<>();
        for (String slug : slugs) {
            DisplaySnapshot snapshot = lifecycle.snapshotOf(slug);
            if (snapshot != null && snapshot.phase() != dev.mosaicast.plugin.api.EpisodePhase.PLANNED) {
                visible.put(slug, snapshot);
            }
        }
        return new Corpus(results, entries, visible, resolvedOf(bingos));
    }

    // ---------------------------------------------------------------- history

    /**
     * How past bingos went, episode after episode, for the site page's charts (see {@link BingoHistory}).
     * Resolved bingos on episodes everyone may see; series only for players who allow being listed.
     */
    void history(Corpus corpus, Map<String, Prefs> prefs, BingoScore.RankBy rankBy, int minCards,
                 List<BingoSummary> bingos) {
        List<BingoHistory.Input> episodes = new ArrayList<>();
        for (BingoSummary b : bingos) {
            DisplaySnapshot snapshot = corpus.visible().get(b.slug());
            if (snapshot == null || !corpus.resolved().contains(b.slug())) {
                continue;
            }
            episodes.add(new BingoHistory.Input(b.slug(), b.title(), snapshot.feed(), snapshot.season(),
                    snapshot.episodeNo(), snapshot.publishedAt()));
        }
        History history = BingoHistory.compute(episodes, corpus.results(), corpus.entries(),
                author -> prefsFor(prefs, author).listedOrDefault(), rankBy, MAX_PUBLISHED_ROWS, minCards, now());
        ctx.store().put(Scope.site(), KEY_HISTORY, history);
    }
}
