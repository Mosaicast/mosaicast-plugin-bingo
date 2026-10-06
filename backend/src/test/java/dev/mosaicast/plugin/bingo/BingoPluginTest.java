// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.api.NotifyMessage;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakeNotifier;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.FakeSchemaStore;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import dev.mosaicast.plugin.testkit.UserDataHandlerHarness;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Backend tests against the SDK test kit — no core, no Postgres, no browser.
 *
 * <p>{@code FakePluginContext} runs scheduled tasks synchronously and immediately, so {@code register}
 * alone exercises a whole tick. {@code InMemoryDocStore.asUser(...)} stands in for the browser, which is
 * the only thing that can ever write a {@code USER} partition — there is no production counterpart, and
 * that absence is the security property the design leans on.
 */
class BingoPluginTest extends BingoTestSupport {

    // ---------------------------------------------------------------- working set

    @Test
    void anEpisodeWithoutATemplateIsNeverTouched() {
        var ctx = ctx(published(false));

        new BingoPlugin(clock).register(ctx);

        assertTrue(ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_PHASE, Object.class).isEmpty(),
                "no template means no bingo, and no work at all for a back catalogue");
        assertTrue(ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_CANDIDATES, Object.class).isEmpty());
    }

    @Test
    void registerPublishesTheComputedKeysAtBootAndSchedulesOneTask() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);

        new BingoPlugin(clock).register(ctx);

        // Written at boot, not only on the schedule: `backendOwned` closes a key from the moment it is
        // declared but never removes a value forged before that.
        assertTrue(phase(ctx).isPresent());
        assertTrue(ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_CANDIDATES, Object.class).isPresent());
        assertTrue(ctx.store().get(Scope.site(), BingoDocs.KEY_STATS, Object.class).isPresent());
        assertEquals(1, ctx.scheduledCount());
    }

    // ---------------------------------------------------------------- OPEN

    @Test
    void tellsHowManyArePlayingWithoutPublishingAnythingBeforeItIsResolved() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedCard(ctx, bob, List.of("merch plug"));

        new BingoPlugin(clock).register(ctx);

        var board = leaderboard(ctx);
        assertFalse(board.published(), "a board that creeps upward while answers are ticked off is a spoiler");
        assertTrue(board.ranked().isEmpty());
        assertEquals(2, board.players(), "but how many are taking part is worth showing early");
    }

    @Test
    void whileOpenEveryCardIsIngestedAndRanked() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("Alex says damn it", "kraken"));
        seedCard(ctx, alice, List.of("alex says damn it!", "merch plug"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals("OPEN", phase(ctx).orElseThrow().phase());

        control(ctx, "RESOLVED");
        plugin.tick();

        var board = leaderboard(ctx);
        assertEquals(2, board.ranked().size());
        assertTrue(board.late().isEmpty());
    }

    @Test
    void theCandidateListMergesSpellingsAcrossCardsIncludingTheOnesTheBrowserCannotSee() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("Alex says damn it"));
        seedCard(ctx, alice, List.of("alex says damn it!"));

        new BingoPlugin(clock).register(ctx);

        var candidates = ctx.store()
                .get(Scope.episode(EPISODE), BingoDocs.KEY_CANDIDATES, BingoDocs.Candidates.class)
                .orElseThrow();
        assertEquals(1, candidates.items().size(), "one thing to tick off, not two");
        assertEquals(2, candidates.items().get(0).count());
    }

    @Test
    void editingACardBeforeTheLockOverwritesItsRows() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken", "merch plug"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        seedCard(ctx, alice, List.of("kraken"));
        plugin.tick();

        assertEquals(1, ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                dev.mosaicast.plugin.api.Criteria.where("author", dev.mosaicast.plugin.api.Criteria.Op.EQ,
                        alice.toString())),
                "a pre-lock edit is free and simply replaces what was there");
    }

    // ---------------------------------------------------------------- LOCKED

    @Test
    void theLockFreezesWhatACardSaysWhileScoresKeepMoving() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken", "merch plug"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();

        // Alice rewrites her card after the lock. Nothing can refuse that write — her partition is hers —
        // so what has to hold is that it changes nothing.
        seedCard(ctx, alice, List.of("kraken", "merch plug", "a third thing she made up"));
        plugin.tick();
        assertEquals(2, entryCount(ctx, alice.toString()), "the entries froze at the lock");

        // The podcaster is still ticking answers off, so scores must keep updating past the freeze.
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        plugin.tick();
        assertEquals(2, rowFor(ctx, alice.toString()).fields(), "one hit plus the free centre");
    }

    @Test
    void aLockAppliedByTheVeryFirstPassStillRanksTheCardsWrittenBeforeIt() {
        // Found in a real browser: the podcaster created a bingo, a fan filled in a card, and the podcaster
        // locked it - all before the backend's first pass over this bingo. That pass saw no phase document
        // at all, took the lock it was applying as the phase the card had been written under, and froze the
        // card as a latecomer, while the fan's tile had said "Predictions open" throughout. Without a phase
        // document the tile shows OPEN and the backend's own first suggestion is OPEN, so that is what an
        // absent one means.
        var ctx = ctx(published(false));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx); // no template yet: the bingo is created after boot, as it is in production

        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("kraken"));
        lock(ctx);
        plugin.tick();

        assertEquals("LOCKED", phase(ctx).orElseThrow().phase());
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        plugin.tick();

        var board = leaderboard(ctx);
        assertEquals(List.of(bob.toString()), board.ranked().stream().map(BingoDocs.Row::author).toList(),
                "written while the tile said predictions were open");
        assertTrue(board.late().isEmpty());
    }

    @Test
    void aCardArrivingAfterTheLockIsScoredButNotRanked() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();

        seedCard(ctx, bob, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        plugin.tick();

        var board = leaderboard(ctx);
        assertEquals(List.of(alice.toString()), board.ranked().stream().map(BingoDocs.Row::author).toList());
        assertEquals(List.of(bob.toString()), board.late().stream().map(BingoDocs.Row::author).toList());
        assertEquals(2, board.late().get(0).fields(), "a latecomer still finds out how they did");
    }

    @Test
    void lateEntriesCanBeTurnedOff() {
        var ctx = ctx(published(false), new MapPluginConfig().with("allowLateEntries", false));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();

        seedCard(ctx, bob, List.of("kraken"));
        plugin.tick();

        assertEquals(0, entryCount(ctx, bob.toString()));
    }

    // ---------------------------------------------------------------- intent beats suggestion

    @Test
    void publishingAnEpisodeLocksABingoThatWasAlreadyOpen() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals("OPEN", phase(ctx).orElseThrow().phase());

        release();
        plugin.tick();

        assertEquals("LOCKED", phase(ctx).orElseThrow().phase(),
                "publication closes a window that was actually open");
    }

    @Test
    void aBingoMadeForAnAlreadyPublishedEpisodeStartsOpen() {
        // Otherwise setting one up for an existing episode produces a board on which nobody can ever be
        // ranked: the very first tick would lock it before anyone had a chance to fill anything in.
        var ctx = ctx(published(true));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));

        new BingoPlugin(clock).register(ctx);

        assertEquals("OPEN", phase(ctx).orElseThrow().phase());
        assertEquals(1, leaderboard(ctx).players());
        assertTrue(rankedInSchema(ctx, alice.toString()), "and they are in the running, not a latecomer");
    }

    @Test
    void anExplicitPhaseBeatsTheDerivedSuggestionInBothDirections() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        release();
        plugin.tick();
        assertEquals("LOCKED", phase(ctx).orElseThrow().phase()); // the feed says "locked"

        control(ctx, "OPEN"); // the podcaster says otherwise, and the podcaster wins
        plugin.tick();

        var state = phase(ctx).orElseThrow();
        assertEquals("OPEN", state.phase());
        assertEquals("LOCKED", state.suggested(), "the suggestion is still reported, just not obeyed");
        assertEquals(null, state.lockedAt(), "reopening genuinely reopens");
    }

    @Test
    void reopeningReRanksACardThatHadBeenFrozen() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();

        seedCard(ctx, bob, List.of("kraken"));
        plugin.tick();
        assertFalse(rankedInSchema(ctx, bob.toString()), "a latecomer is out of the running");

        control(ctx, "OPEN");
        plugin.tick();

        assertTrue(rankedInSchema(ctx, bob.toString()), "reopening puts them back in it");
    }

    @Test
    void aCardSavedBeforeTheLockIsRankedEvenWhenTheSameTickAppliesTheLock() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        // Both land inside one interval: somebody fills their card in, the podcaster closes predictions,
        // and the next pass is the first to see either. That pass must not treat the card as a latecomer -
        // it was written while the tile still said predictions were open.
        seedCard(ctx, bob, List.of("kraken"));
        lock(ctx);
        plugin.tick();

        assertEquals("LOCKED", phase(ctx).orElseThrow().phase(), "the lock still applies on this pass");
        assertTrue(rankedInSchema(ctx, bob.toString()),
                "saved before the lock, so ranked - however close to the deadline it landed");
    }

    @Test
    void aCardArrivingAfterTheLockIsStillALatecomer() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();

        seedCard(ctx, bob, List.of("kraken"));
        plugin.tick();

        assertFalse(rankedInSchema(ctx, bob.toString()),
                "the lock was already in force for a whole interval before this card existed");
    }

    @Test
    void theHeadcountAndTheTallyCountPeopleWhoAskedNotToBeNamed() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("kraken"));
        seedCard(ctx, alice, List.of("kraken"));
        seedPrefs(ctx, alice, false, true);
        resolve(ctx, Map.of("kraken", true));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();

        var board = leaderboard(ctx);
        assertEquals(2, board.players(), "both played, whatever either agreed to have shown");
        assertEquals(1, board.ranked().size(), "only one of them agreed to be named");

        // The tally exists so a reader with no published row can still place themselves, and somebody who
        // opted out has no published row by definition - leaving them out empties it of its whole purpose.
        int counted = board.distribution().stream().mapToInt(BingoDocs.Tally::count).sum();
        assertEquals(2, counted, "the tally places everyone, including the people it names nowhere");
    }

    @Test
    void aCandidateIsCountedByCardsNotByHowManyTimesItWasTyped() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        // One person, one prediction, spelled two ways on the same card.
        seedCard(ctx, bob, List.of("kraken", "krakken"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        var candidates = ctx.store()
                .get(Scope.episode(EPISODE), BingoDocs.KEY_CANDIDATES, BingoDocs.Candidates.class)
                .orElseThrow();
        var first = candidates.items().get(0);
        assertEquals(2, first.count(), "two entries did land in the group");
        assertEquals(1, candidates.cards().get(first.canonical()),
                "but they are one card, and 'on n cards' is what the podcaster is shown");
    }

    @Test
    void aTemplateThatNeverSaidItsSizeTakesTheConfiguredDefault() {
        var ctx = ctx(published(false), new MapPluginConfig().with("defaultGridSize", 5));
        // As a hand-written template would be: no size at all.
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, Map.of("title", "Bingo"));

        new BingoPlugin(clock).register(ctx);

        var template = ctx.store()
                .get(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, BingoDocs.Template.class)
                .orElseThrow();
        // Written back rather than merely assumed: there is no ctx.config in a browser, so a template that
        // stays silent would be read as one size here and another there.
        assertEquals(5, template.size(), "the operator's default, settled into the document itself");
    }

    @Test
    void aSavedIntervalReachesTheScheduleWithoutARestart() {
        // Before platformApi 0.15.0 the period was a Duration captured once in register(): an operator saved
        // a new interval, the admin form reported it, and the plugin kept its old cadence until a restart.
        // scheduledPeriods() re-reads every registered supplier, so a captured value would fail here.
        var config = new MapPluginConfig().with("ingestIntervalSeconds", 60);
        var ctx = ctx(published(false), config);
        new BingoPlugin(clock).register(ctx);
        assertEquals(List.of(Duration.ofSeconds(60)), ctx.scheduledPeriods());

        config.with("ingestIntervalSeconds", 10);
        assertEquals(List.of(Duration.ofSeconds(10)), ctx.scheduledPeriods(),
                "the new interval is picked up without registering again");
    }

    @Test
    void theIntervalBoundsLiveInTheManifestWhereTheHostEnforcesThem() {
        // Since platformApi 0.16.0 the host refuses an out-of-range save and reads a stored one as unset, so
        // the plugin's old floor at one second is gone. What replaces it has to exist, and has to admit the
        // default, or the host refuses the manifest at load.
        var field = BingoSchemaFixture.manifest().path("config").path("ingestIntervalSeconds");
        assertEquals(10, field.path("min").asInt());
        assertEquals(3600, field.path("max").asInt());
        assertTrue(field.path("min").asInt() <= BingoPlugin.DEFAULT_INGEST_SECONDS
                && BingoPlugin.DEFAULT_INGEST_SECONDS <= field.path("max").asInt());
        assertEquals(BingoPlugin.DEFAULT_INGEST_SECONDS, field.path("default").asInt(),
                "the code's fallback and the manifest's default are one number");
    }

    // ---------------------------------------------------------------- RESOLVED and stats

    @Test
    void standingsCountRankedCardsOnlyAndAreRecomputedNeverIncremented() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("kraken", "merch plug"));
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        var first = stats(ctx);
        assertEquals(2, first.players().size());
        int score = first.players().get(0).fields();

        plugin.tick();
        plugin.tick();

        assertEquals(score, stats(ctx).players().get(0).fields(),
                "recomputed from the rows, so running the tick again cannot double-count");
        assertEquals(1, stats(ctx).players().get(0).cards());
    }

    @Test
    void standingsWaitForTheResolutionLikeTheBoardDoes() {
        // Locked and half ticked off: a card's score is the podcaster's progress so far, which the episode's
        // own board withholds until the end. Standings that climbed meanwhile would give it away.
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        lock(ctx);
        resolve(ctx, Map.of("kraken", true));
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        assertTrue(stats(ctx).players().isEmpty());
        assertEquals(0, stats(ctx).episodes());

        control(ctx, "RESOLVED");
        plugin.tick();
        assertEquals(1, stats(ctx).players().size());
    }

    @Test
    void aSecondIdenticalTickChangesNothing() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("kraken"));
        seedCard(ctx, alice, List.of("kraken"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        var afterFirst = leaderboard(ctx);
        long entriesAfterFirst = ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                dev.mosaicast.plugin.api.Criteria.all());

        plugin.tick();

        assertEquals(entriesAfterFirst,
                ctx.schema().count(BingoDocs.ENTITY_ENTRY, dev.mosaicast.plugin.api.Criteria.all()));
        assertEquals(afterFirst.ranked(), leaderboard(ctx).ranked());
    }

    // ---------------------------------------------------------------- ARCHIVED

    @Test
    void archivesAfterTheConfiguredDelayAndThenStopsEntirely() {
        var ctx = ctx(published(false), new MapPluginConfig().with("archiveAfterDays", 30));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();
        assertEquals("RESOLVED", phase(ctx).orElseThrow().phase());
        assertNotNull(phase(ctx).orElseThrow().archiveAt());

        clock.advance(Duration.ofDays(31));
        plugin.tick();
        assertEquals("ARCHIVED", phase(ctx).orElseThrow().phase());

        // Terminal: a later write records nothing, and the episode has left the working set for good.
        long entries = ctx.schema().count(BingoDocs.ENTITY_ENTRY, dev.mosaicast.plugin.api.Criteria.all());
        seedCard(ctx, bob, List.of("kraken"));
        plugin.tick();
        assertEquals(entries, ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                dev.mosaicast.plugin.api.Criteria.all()));
    }

    // ---------------------------------------------------------------- lines and fields

    @Test
    void countsCompletedLinesAndLetsThemDecideTheOrder() {
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx); // no free centre, so every square is under the test's control
        seedCard(ctx, alice, LINE_CARD);
        seedCard(ctx, bob, SCATTER_CARD);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        resolve(ctx, HITS);
        control(ctx, "RESOLVED");
        plugin.tick();

        var ranked = leaderboard(ctx).ranked();
        assertEquals(alice.toString(), ranked.get(0).author(), "one line beats four loose hits");
        assertEquals(1, ranked.get(0).lines());
        assertEquals(3, ranked.get(0).fields());
        assertEquals(0, ranked.get(1).lines());
        assertEquals(4, ranked.get(1).fields(), "and it wins despite having fewer fields");
    }

    @Test
    void letsTheOperatorRankOnFieldsInstead() {
        var ctx = ctx(published(false), new MapPluginConfig().with("rankBy", "fields"));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, LINE_CARD);
        seedCard(ctx, bob, SCATTER_CARD);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        resolve(ctx, HITS);
        control(ctx, "RESOLVED");
        plugin.tick();

        assertEquals(bob.toString(), leaderboard(ctx).ranked().get(0).author());
    }

    @Test
    void aBingoCanBeMadeWithoutAFreeCentre() {
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, List.of("a", "b", "c", "d", "e", "f", "g", "h", "i"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();

        // Nothing is resolved, so nothing is a hit - and with no gift the score really is zero.
        assertEquals(0, leaderboard(ctx).ranked().get(0).fields());
    }

    @Test
    void aFreeCentreIsAGiftEveryoneGetsAndNobodyEarned() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("a", "b", "c", "d", "e", "f", "g", "h"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();

        assertEquals(1, leaderboard(ctx).ranked().get(0).fields());
    }

    @Test
    void aTemplateThatSaysNothingKeepsEverySquareFillable() {
        // Absent means no. The opposite default hands everyone a point they never earned, and hides a
        // square they meant to write in.
        var ctx = ctx(published(false));
        ctx.store().put(Scope.episode(EPISODE), BingoDocs.KEY_TEMPLATE, Map.of("size", 3));
        seedCard(ctx, alice, List.of("a", "b", "c", "d", "e", "f", "g", "h", "i"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();

        assertEquals(0, leaderboard(ctx).ranked().get(0).fields(), "nothing resolved, so nothing scored");
        assertEquals(9, ctx.schema().count(BingoDocs.ENTITY_ENTRY,
                dev.mosaicast.plugin.api.Criteria.all()), "all nine squares are the player's to write");
    }

    @Test
    void publishesEnoughForSomeoneOffTheBoardToPlaceThemselves() {
        // The board is capped; the tally is not, and it costs a row per distinct score rather than per
        // player. Counting how many scored better places somebody exactly, and names nobody.
        var ctx = ctx(published(false));
        seedPlainTemplate(ctx);
        seedCard(ctx, alice, LINE_CARD);
        seedCard(ctx, bob, SCATTER_CARD);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        resolve(ctx, HITS);
        control(ctx, "RESOLVED");
        plugin.tick();

        var tally = leaderboard(ctx).distribution();
        assertEquals(2, tally.size(), "two distinct scores, so two entries however many people played");
        assertEquals(1, tally.get(0).count());
        assertEquals(2, tally.stream().mapToInt(BingoDocs.Tally::count).sum());
    }

    // ---------------------------------------------------------------- how people choose to appear

    @Test
    void leavesSomeoneOffThePublicBoardWhenTheyAskedToBe() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedCard(ctx, bob, List.of("kraken"));
        seedPrefs(ctx, bob, false, false);

        // Play first, resolve after: a bingo that is already resolved on its very first tick has no
        // players in the running at all, only latecomers.
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();

        assertEquals(List.of(alice.toString()),
                leaderboard(ctx).ranked().stream().map(BingoDocs.Row::author).toList());
    }

    @Test
    void stillScoresAndStillRecordsSomeoneWhoOptedOut() {
        // Opting out is a choice about what other people see, not a request to stop playing.
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("kraken"));
        seedPrefs(ctx, bob, false, false);
        resolve(ctx, Map.of("kraken", true));

        new BingoPlugin(clock).register(ctx);

        assertEquals(1, ctx.schema().count(BingoDocs.ENTITY_CARD_RESULT,
                dev.mosaicast.plugin.api.Criteria.where("author",
                        dev.mosaicast.plugin.api.Criteria.Op.EQ, bob.toString())));
    }

    @Test
    void tellsSomeoneWhoOptedOutOfTheBoardAnyway() {
        var ctx = ctx(published(false));
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);
        seedTemplate(ctx);
        seedCard(ctx, bob, List.of("kraken"));
        seedPrefs(ctx, bob, false, false);
        control(ctx, "RESOLVED");

        new BingoPlugin(clock).register(ctx);

        assertEquals(1, notifier.messagesFor(bob).size(),
                "not being on a public board is not a request to stop hearing about your own game");
    }

    @Test
    void treatsSomeoneWhoNeverChoseAsWillingToBeSeen() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        control(ctx, "RESOLVED");
        plugin.tick();

        assertEquals(1, leaderboard(ctx).ranked().size());
        assertEquals(1, participants(ctx).items().size());
    }

    // ---------------------------------------------------------------- featuring

    @Test
    void offersOnlyPeopleWhoAllowTheirCardToBeFeatured() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedCard(ctx, bob, List.of("merch plug"));
        seedPrefs(ctx, bob, true, false); // happy on the board, not happy to be featured

        new BingoPlugin(clock).register(ctx);

        assertEquals(List.of(alice.toString()),
                participants(ctx).items().stream().map(BingoDocs.Participant::userId).toList());
    }

    @Test
    void copiesAFeaturedCardOutSoAnyoneCanReadIt() {
        // No browser can read another person's partition, so without this copy there is nothing to draw.
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken", "merch plug"));
        seedShowcase(ctx, alice);

        new BingoPlugin(clock).register(ctx);

        var showcased = showcased(ctx).items();
        assertEquals(1, showcased.size());
        assertEquals(alice.toString(), showcased.get(0).userId());
        assertEquals(List.of("kraken", "merch plug"), showcased.get(0).entries());
    }

    @Test
    void stopsFeaturingSomeoneWhoChangesTheirMind() {
        // The pick is checked against the preference on every tick, not trusted from when it was made:
        // only the backend can see both, so a stale selection must stop publishing them.
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        seedShowcase(ctx, alice);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals(1, showcased(ctx).items().size());

        seedPrefs(ctx, alice, true, false);
        plugin.tick();

        assertTrue(showcased(ctx).items().isEmpty());
    }

    // ---------------------------------------------------------------- planned episodes (platformApi 0.18.0)

    @Test
    void listensForReleases() {
        var ctx = ctx(published(false));

        new BingoPlugin(clock).register(ctx);

        assertEquals(1, ctx.episodeReleasedListenerCount());
    }

    @Test
    void aReleaseClosesPredictionsWithoutWaitingForTheNextTick() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        new BingoPlugin(clock).register(ctx);
        // Saved after the last tick and before the release: inside the deadline, so it must count.
        seedCard(ctx, bob, List.of("kraken"));

        release();
        ctx.fireEpisodeReleased(EPISODE);

        assertEquals("LOCKED", phase(ctx).orElseThrow().phase(), "closed at the release, not an interval later");
        assertTrue(rankedInSchema(ctx, bob.toString()),
                "the pass that applies the lock still takes the last cards as ranked, not as latecomers");
        assertTrue(ctx.logger().events(org.slf4j.event.Level.ERROR).isEmpty());
    }

    @Test
    void aBingoPreparedWhileTheEpisodeIsQuietLocksWhenItIsReleased() {
        var ctx = ctx(snapshot(EpisodePhase.PLANNED));
        seedTemplate(ctx);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertEquals("OPEN", phase(ctx).orElseThrow().phase());
        assertTrue(phase(ctx).orElseThrow().openedBeforeRelease());

        feeds.withPhase(EPISODE, EpisodePhase.UPCOMING); // announced: still open, now for everyone
        plugin.tick();
        assertEquals("OPEN", phase(ctx).orElseThrow().phase());

        release(); // and the event is missed: the tick reconciles by phase on its own
        plugin.tick();
        assertEquals("LOCKED", phase(ctx).orElseThrow().phase());
    }

    @Test
    void withdrawingAReleasedEpisodeDoesNotReopenItsBingo() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        release();
        plugin.tick();

        feeds.withPhase(EPISODE, EpisodePhase.WITHDRAWN);
        plugin.tick();

        assertEquals("LOCKED", phase(ctx).orElseThrow().phase(), "it came out; dropping from the feed undoes nothing");
    }

    @Test
    void aQuietEpisodeStaysOutOfThePublicStandings() {
        // Site stats are readable by anyone, so a podcaster rehearsing on a quiet episode would otherwise
        // announce that something is coming.
        var ctx = ctx(snapshot(EpisodePhase.PLANNED));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertTrue(stats(ctx).players().isEmpty());
        assertEquals(0, stats(ctx).episodes());

        feeds.withPhase(EPISODE, EpisodePhase.UPCOMING);
        plugin.tick();
        assertEquals(1, stats(ctx).players().size(), "announced, so it counts");
    }

    @Test
    void theNewsOfAResolvedQuietBingoWaitsUntilTheEpisodeIsAnnounced() {
        var ctx = ctx(snapshot(EpisodePhase.PLANNED));
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        assertTrue(notifier.delivered().isEmpty(), "a notification names and links an episode nobody may see");

        feeds.withPhase(EPISODE, EpisodePhase.UPCOMING);
        plugin.tick();
        assertEquals(1, notifier.messagesFor(alice).size(), "told on the first tick after the announcement");
    }

    // ---------------------------------------------------------------- telling people

    @Test
    void tellsRankedAndLatePlayersApartWhenTheBingoResolves() {
        var ctx = ctx(published(false));
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        lock(ctx);
        plugin.tick();
        seedCard(ctx, bob, List.of("kraken")); // arrives after the lock: played, not ranked
        plugin.tick();
        assertTrue(notifier.delivered().isEmpty(), "nothing is announced before it is resolved");

        control(ctx, "RESOLVED");
        plugin.tick();

        String toAlice = notifier.messagesFor(alice).get(0).textFor("en");
        String toBob = notifier.messagesFor(bob).get(0).textFor("en");
        assertTrue(toAlice.contains("resolved"), toAlice);
        assertFalse(toAlice.contains("not ranked"), "a ranked player is not told they were left out");
        assertTrue(toBob.contains("not ranked"), toBob);
    }

    @Test
    void saysItInEveryLanguageItKnowsAndPointsAtTheEpisode() {
        // The set of languages is fixed when a notification is sent and read possibly days later, so all of
        // them travel with it rather than one sentence rendered in whatever the shell was showing then.
        var ctx = resolvedBingo();
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);

        new BingoPlugin(clock).register(ctx);

        NotifyMessage message = notifier.messagesFor(alice).get(0);
        assertTrue(message.text().containsKey("en"), "en is the one language a site cannot switch off");
        assertTrue(message.text().containsKey("de"));
        assertNotEquals(message.textFor("en"), message.textFor("de"));
        assertEquals("/episodes/" + EPISODE, message.link());
    }

    @Test
    void tellsEachPersonExactlyOnceHoweverOftenItTicks() {
        var ctx = resolvedBingo();
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        int afterFirst = notifier.delivered().size();
        plugin.tick();
        plugin.tick();

        assertEquals(1, afterFirst);
        assertEquals(afterFirst, notifier.delivered().size(),
                "a tick every minute for a month must not become a notification every minute for a month");
    }

    @Test
    void tellsSomeoneWhoJoinsAfterTheResolution() {
        // Tracking people rather than "did we announce yet" is what makes this work.
        var ctx = resolvedBingo();
        var notifier = new FakeNotifier(ctx.store());
        ctx.withNotifier(notifier);

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);
        seedCard(ctx, bob, List.of("kraken"));
        plugin.tick();

        assertEquals(1, notifier.messagesFor(bob).size());
        assertEquals(1, notifier.messagesFor(alice).size(), "and the first player is not told twice");
    }

    @Test
    void holdsTheBatchWhenItIsOverTheSendCap() {
        var ctx = resolvedBingo();
        var notifier = new FakeNotifier(ctx.store()).withPerUserPerDay(1);
        ctx.withNotifier(notifier);

        var plugin = new BingoPlugin(clock);
        try {
            // Something else already used up this person's allowance today.
            notifier.send(List.of(alice), new NotifyMessage("earlier today"));
        } catch (Exception e) {
            throw new AssertionError(e);
        }

        plugin.register(ctx); // refused: over the cap
        assertEquals(1, notifier.messagesFor(alice).size());
        assertTrue(ctx.store().get(Scope.episode(EPISODE), BingoDocs.KEY_NOTIFIED, Object.class).isEmpty(),
                "nobody is marked as told, so a later tick will try again rather than dropping it");
    }

    @Test
    void resolvesFineWithoutANotificationsBlock() {
        var ctx = resolvedBingo(); // no withNotifier: ctx.notifier() is null

        new BingoPlugin(clock).register(ctx);

        assertEquals("RESOLVED", phase(ctx).orElseThrow().phase());
    }

    /** A bingo with one ranked player, already resolved. */
    private FakePluginContext resolvedBingo() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));
        control(ctx, "RESOLVED");
        return ctx;
    }

    // ---------------------------------------------------------------- the manifest's security claims

    @Test
    void theManifestDeclaresTheCrossUserReadItCannotPlayWithout() {
        assertTrue(BingoSchemaFixture.manifest().path("data").path("readsAllUsers").asBoolean(false),
                "every card lives in its player's own partition; without the declaration allUsers() is null");
    }

    @Test
    void registeringWithoutTheCrossUserReadFailsLoudly() {
        FakeSchemaStore schema = BingoSchemaFixture.schema();
        var withheld = new FakePluginContext(new InMemoryDocStore(), new MapPluginConfig(),
                new FakeFeedAccess(Map.of(Scope.site(), List.of(EPISODE))).withDisplay(EPISODE, published(true)),
                schema);

        // A bingo that registered anyway would accept every card and never see one.
        var refused = assertThrows(NullPointerException.class, () -> new BingoPlugin(clock).register(withheld));
        assertTrue(refused.getMessage().contains("readsAllUsers"), "the log line names the missing declaration");
    }

    @Test
    void backendOwnedMatchesTheManifestAndLeavesClientKeysAlone() {
        var store = new InMemoryDocStore().withBackendOwned(BingoSchemaFixture.backendOwned());
        var mallory = UUID.randomUUID();
        Scope scope = Scope.episode(EPISODE);

        // The backend writes its computed keys freely; a client forging them is refused (a 403 in the host).
        store.put(scope, BingoDocs.KEY_LEADERBOARD, Map.of("ranked", List.of()));
        assertThrows(IllegalStateException.class,
                () -> store.asUser(mallory).put(scope, BingoDocs.KEY_LEADERBOARD, Map.of("forged", true)));
        assertThrows(IllegalStateException.class,
                () -> store.asUser(mallory).put(Scope.site(), BingoDocs.KEY_STATS, Map.of("forged", true)));
        assertThrows(IllegalStateException.class,
                () -> store.asUser(mallory).put(scope, BingoDocs.KEY_SHOWCASED, Map.of("items", List.of())),
                "a featured card is a copy the backend made, not something a client may plant");
        assertThrows(IllegalStateException.class,
                () -> store.asUser(mallory).put(scope, BingoDocs.KEY_PARTICIPANTS, Map.of("items", List.of())));

        // …and the keys the browser has to write are deliberately NOT reserved, or the plugin would 403
        // against its own UI.
        store.asUser(mallory).put(scope, BingoDocs.KEY_TEMPLATE, Map.of("size", 3));
        store.asUser(mallory).put(scope, BingoDocs.KEY_RESOLUTION, Map.of("hits", Map.of()));
        store.asUser(mallory).put(scope, BingoDocs.KEY_CONTROL, Map.of("phase", "LOCKED"));
        store.asUser(mallory).put(scope, BingoDocs.KEY_SHOWCASE, Map.of("userIds", List.of()));
    }

    @Test
    void aFansOwnPartitionIsNeverReservedEvenThoughTheBackendOwnsOtherKeys() {
        var store = new InMemoryDocStore().withBackendOwned(BingoSchemaFixture.backendOwned());
        store.asUser(alice).put(Scope.user(), BingoDocs.CARD_PREFIX + EPISODE, Map.of("label", "Alice"));
        assertEquals(1, store.docsOf(alice).size());
    }

    // ---------------------------------------------------------------- account deletion

    @Test
    void erasureCutsTheIdentityLinkSurvivesARetryAndKeepsTheRecordTrue() {
        var ctx = ctx(published(false));
        seedTemplate(ctx);
        seedCard(ctx, alice, List.of("kraken"));
        resolve(ctx, Map.of("kraken", true));

        var plugin = new BingoPlugin(clock);
        plugin.register(ctx);

        var harness = new UserDataHandlerHarness(plugin);
        assertTrue(harness.export(alice.toString()).isPresent(), "an export is a request in its own right");

        harness.eraseTwice(alice.toString()); // fails loudly if the second call is not a no-op

        assertEquals(0, entryCount(ctx, alice.toString()), "nothing is attributable to her any more");
        assertEquals(1, ctx.schema().count(BingoDocs.ENTITY_ENTRY, dev.mosaicast.plugin.api.Criteria.all()),
                "but the game she played is still part of the record");
        assertTrue(leaderboard(ctx).ranked().stream().noneMatch(r -> r.author().equals(alice.toString())));
    }
}
