// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** The draft round's rules on their own: no context, no store, time passed in by hand. */
class BingoDraftTest {

    static final String A = "a", B = "b", C = "c";

    /** A lobby on a 2x2 (four squares), run by A, with B (and C) joined. */
    static BingoDraft lobby(int size, String... others) {
        BingoDraft d = BingoDraft.create("id", "ep", A, "code", size, false, 0.85, 0);
        d.invite(List.of(others));
        for (String o : others) {
            d.join(o);
        }
        return d;
    }

    static BingoDraft.Settings clock(Integer turn, Integer bank, Integer increment) {
        BingoDraft.Settings s = new BingoDraft.Settings();
        s.turnSeconds = turn;
        s.bankSeconds = bank;
        s.incrementSeconds = increment;
        return s;
    }

    static BingoDraft.Settings noClock() {
        BingoDraft.Settings s = new BingoDraft.Settings();
        s.clock = false;
        return s;
    }

    static BingoDraft started(BingoDraft.Settings settings, int size, String... others) {
        BingoDraft d = lobby(size, others);
        d.setup(settings, true, null);
        d.start(0);
        return d;
    }

    @Test
    void anUntimedRoundTakesTurnsUntilEveryCardIsFull() {
        BingoDraft d = started(noClock(), 2, B);
        assertNull(d.deadline(), "no clock, nothing to time out");
        int n = 0;
        while (d.status == BingoDraft.Status.RUNNING) {
            String who = d.current;
            assertEquals(n % 2 == 0 ? A : B, who, "strict turns in the order set");
            int cell = d.seat(who).cells.indexOf("");
            d.move(who, cell, who + n, 1_000_000L * n);
            n++;
        }
        assertEquals(8, n);
        assertEquals(BingoDraft.Status.FINISHED, d.status);
        assertEquals(List.of("a0", "a2", "a4", "a6"), d.cards().get(A));
    }

    @Test
    void theOrderIsTheHostsAndOnlyTheCurrentPlayerMoves() {
        BingoDraft d = lobby(2, B, C);
        d.setup(noClock(), true, List.of(C, A, B));
        d.start(0);
        assertEquals(C, d.current);
        BingoDraft.Refused refused = assertThrows(BingoDraft.Refused.class, () -> d.move(A, 0, "x", 1));
        assertEquals("not-your-turn", refused.code);
        d.move(C, 0, "x", 1);
        assertEquals(A, d.current);
    }

    @Test
    void anOrderThatIsNotExactlyWhoJoinedIsRefused() {
        BingoDraft d = lobby(2, B);
        BingoDraft.Refused refused = assertThrows(BingoDraft.Refused.class,
                () -> d.setup(null, true, List.of(B, C)));
        assertEquals("stale-order", refused.code);
    }

    @Test
    void theHostCanRunARoundWithoutPlaying() {
        BingoDraft d = lobby(2, B, C);
        d.setup(noClock(), false, null);
        assertEquals(List.of(B, C), d.order);
        d.start(0);
        assertNull(d.seat(A));
    }

    @Test
    void aMoveSpendsTheBankAndEarnsTheIncrement() {
        BingoDraft d = started(clock(30, 60, 10), 2, B);
        assertEquals(30_000L, d.deadline(), "the turn limit is shorter than the bank");
        d.move(A, 0, "x", 5_000);
        assertEquals(65_000L, d.seat(A).bankMs);
        assertEquals(B, d.current);
    }

    @Test
    void aTurnThatRunsOutIsSkippedAndMadeUpAfterTheLastRegularRound() {
        BingoDraft d = started(clock(10, null, 0), 2, B);
        assertTrue(d.expire(10_000), "A's first turn runs out");
        assertEquals(1, d.seat(A).skipped);
        long t = 10_000;
        // Three more regular rounds for A, four for B.
        while (d.stage == BingoDraft.Stage.REGULAR) {
            String who = d.current;
            d.move(who, d.seat(who).cells.indexOf(""), who + t, ++t);
        }
        assertEquals(BingoDraft.Stage.MAKEUP, d.stage);
        assertEquals(A, d.current);
        assertEquals(1, d.seat(A).empty());
        d.move(A, d.seat(A).cells.indexOf(""), "late", ++t);
        assertEquals(BingoDraft.Status.FINISHED, d.status);
    }

    @Test
    void withoutABankAMissedMakeUpTurnEndsThatCard() {
        BingoDraft d = started(clock(10, null, 0), 2, B);
        d.expire(10_000); // A skips
        long t = 10_000;
        while (d.stage == BingoDraft.Stage.REGULAR) {
            String who = d.current;
            d.move(who, d.seat(who).cells.indexOf(""), who + t, ++t);
        }
        assertEquals(A, d.current);
        assertTrue(d.expire(t + 10_000), "A misses the make-up turn too");
        assertTrue(d.seat(A).done);
        assertEquals(BingoDraft.Status.FINISHED, d.status);
        assertEquals(1, d.seat(A).empty(), "the square stays empty");
    }

    @Test
    void oneFlaggedPlayerFinishesAloneWithNoClock() {
        BingoDraft d = started(clock(null, 60, 0), 2, B);
        assertEquals(60_000L, d.deadline(), "with no turn limit the bank is the limit");
        assertTrue(d.expire(60_000));
        assertTrue(d.seat(A).out);
        long t = 60_000;
        while (d.stage != BingoDraft.Stage.SOLO) {
            assertEquals(B, d.current, "B plays on alone while A is out");
            d.move(B, d.seat(B).cells.indexOf(""), "b" + t, ++t);
        }
        assertEquals(A, d.current);
        assertNull(d.deadline(), "the solo stage is untimed");
        for (int i = 0; i < 4; i++) {
            d.move(A, i, "a" + i, t + 1_000_000L * (i + 1));
        }
        assertEquals(BingoDraft.Status.FINISHED, d.status);
    }

    @Test
    void twoFlaggedPlayersPlayAnOvertimeOnResetClocks() {
        BingoDraft d = started(clock(null, 60, 0), 2, B, C);
        d.expire(60_000);   // A out
        d.expire(120_000);  // B out
        long t = 120_000;
        while (d.overtime == 0) {
            assertEquals(C, d.current);
            d.move(C, d.seat(C).cells.indexOf(""), "c" + t, ++t);
        }
        assertEquals(BingoDraft.Stage.REGULAR, d.stage);
        assertEquals(A, d.current);
        assertEquals(60_000L, d.seat(A).bankMs);
        assertEquals(60_000L, d.seat(B).bankMs);
        assertFalse(d.seat(A).out);
        assertEquals(0, d.seat(C).empty(), "C is done and sits the overtime out");
    }

    @Test
    void anOvertimeInWhichNobodyWritesEndsTheRound() {
        BingoDraft d = started(clock(null, 60, 0), 2, B, C);
        d.expire(60_000);
        d.expire(120_000);
        long t = 120_000;
        while (d.overtime == 0) {
            d.move(C, d.seat(C).cells.indexOf(""), "c" + t, ++t);
        }
        d.expire(t + 60_000);      // A out again
        d.expire(t + 120_000);     // B out again
        assertEquals(BingoDraft.Status.FINISHED, d.status);
    }

    @Test
    void aCloseSquarePausesTheClockForAVote() {
        BingoDraft d = started(clock(30, null, 0), 2, B, C);
        d.move(A, 0, "Alex says damn", 1_000);
        assertEquals(BingoDraft.Outcome.VOTING, d.move(B, 0, "alex says damn!", 3_000));
        assertNotNull(d.vote);
        assertEquals(List.of(A, C), d.vote.voters);
        assertEquals(3_000 + BingoDraft.VOTE_MS, d.deadline(), "the vote's end, the turn is paused");

        BingoDraft.Refused busy = assertThrows(BingoDraft.Refused.class, () -> d.move(B, 1, "x", 4_000));
        assertEquals("vote-open", busy.code);

        d.castVote(A, true, 5_000);
        d.castVote(C, true, 6_000);
        assertNull(d.vote);
        assertEquals("alex says damn!", d.seat(B).cells.get(0));
        assertEquals(C, d.current);
    }

    @Test
    void aTieDisallowsAndTheSamePlayerGoesOnWithTheirClockResumed() {
        BingoDraft d = started(clock(30, null, 0), 2, B, C);
        d.move(A, 0, "rain", 0);
        d.move(B, 0, "rain!", 10_000); // B used 10 s of 30
        d.castVote(A, true, 15_000);
        d.castVote(C, false, 20_000);
        assertNull(d.vote);
        assertEquals("", d.seat(B).cells.get(0));
        assertEquals(B, d.current);
        assertEquals("rain!", d.turnedDown.text);
        assertEquals(20_000 + 20_000L, d.deadline(), "20 s left of the turn, from the vote's end");
    }

    @Test
    void nobodyVotingDisallows() {
        BingoDraft d = started(clock(30, null, 0), 2, B);
        d.move(A, 0, "rain", 0);
        d.move(B, 0, "rain", 1_000);
        assertTrue(d.expire(1_000 + BingoDraft.VOTE_MS));
        assertEquals("", d.seat(B).cells.get(0));
        assertEquals(B, d.current);
    }

    @Test
    void theDuplicateCheckCanBeTurnedOff() {
        BingoDraft.Settings s = noClock();
        s.duplicateCheck = false;
        BingoDraft d = started(s, 2, B);
        d.move(A, 0, "rain", 0);
        assertEquals(BingoDraft.Outcome.WRITTEN, d.move(B, 0, "rain", 1));
    }

    @Test
    void repeatingYourOwnSquareIsRefusedOutright() {
        BingoDraft d = started(noClock(), 2, B);
        d.move(A, 0, "Rain", 0);
        d.move(B, 0, "sun", 1);
        BingoDraft.Refused refused = assertThrows(BingoDraft.Refused.class, () -> d.move(A, 1, "rain!", 2));
        assertEquals("repeat", refused.code);
    }

    @Test
    void inTheSoloStageNobodyVotingLeavesItToTheHost() {
        BingoDraft d = started(clock(null, 60, 0), 2, B);
        // B runs out; A finishes first, so B fills alone.
        d.move(A, 0, "rain", 1_000);
        d.expire(1_000 + 60_000);
        assertTrue(d.seat(B).out);
        long t = 61_000;
        while (d.stage != BingoDraft.Stage.SOLO) {
            d.move(A, d.seat(A).cells.indexOf(""), "a" + t, ++t);
        }
        assertEquals(B, d.current);
        d.move(B, 0, "rain", t + 1);
        d.expire(t + 1 + BingoDraft.VOTE_MS);
        assertTrue(d.vote.awaitingHost);
        assertNull(d.deadline(), "the host decides with no clock");
        d.castVote(A, true, t + 100_000);
        assertEquals("rain", d.seat(B).cells.get(0));
    }

    @Test
    void inTheSoloStageAHostWithNoVotesIsAllowed() {
        BingoDraft d = started(clock(null, 60, 0), 2, B);
        d.expire(60_000); // A, the host, runs out
        long t = 60_000;
        while (d.stage != BingoDraft.Stage.SOLO) {
            d.move(B, d.seat(B).cells.indexOf(""), "b" + t, ++t);
        }
        d.move(A, 0, d.seat(B).cells.get(0), t + 1);
        d.expire(t + 1 + BingoDraft.VOTE_MS);
        assertEquals(d.seat(B).cells.get(0), d.seat(A).cells.get(0));
    }

    @Test
    void aRestartGivesTheTurnInProgressItsTimeAgain() {
        BingoDraft d = started(clock(30, null, 0), 2, B);
        d.resume(500_000);
        assertEquals(530_000L, d.deadline());
    }

    @Test
    void anErasedPlayerPlaysNoMoreTurns() {
        BingoDraft d = started(noClock(), 2, B, C);
        assertTrue(d.erase(A, "erased:x", 10));
        assertEquals(B, d.current);
        assertEquals("erased:x", d.host);
        assertTrue(d.seat("erased:x").done);
    }

    @Test
    void aLobbyTakesAtMostEightPlayers() {
        BingoDraft d = BingoDraft.create("id", "ep", A, "code", 2, false, 0.85, 0);
        for (int i = 1; i < BingoDraft.MAX_PLAYERS; i++) {
            d.join("p" + i);
        }
        BingoDraft.Refused refused = assertThrows(BingoDraft.Refused.class, () -> d.join("one-more"));
        assertEquals("full", refused.code);
    }

    @Test
    void settingsOutsideTheirBoundsAreRefused() {
        BingoDraft d = lobby(2, B);
        BingoDraft.Refused refused = assertThrows(BingoDraft.Refused.class,
                () -> d.setup(clock(1, null, 0), true, null));
        assertEquals("bad-settings", refused.code);
    }
}
