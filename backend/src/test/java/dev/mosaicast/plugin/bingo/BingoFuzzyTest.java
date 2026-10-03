// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The grouping is what makes a shared tick-off board possible at all, so it gets the most tests.
 */
class BingoFuzzyTest {

    @Test
    void normalisesAwayCasePunctuationAccentsAndSpacing() {
        assertEquals("alex says damn it", BingoFuzzy.normalise("  Alex says: \"Damn it!\"  "));
        assertEquals("alex says damn it", BingoFuzzy.normalise("alex says damn it"));
        // Diacritics fold away, and ß is transliterated rather than left as a letter: "grüßen" and
        // "gruessen" are one thing spelled two ways, and edit distance alone puts them four apart.
        assertEquals("uber grussen", BingoFuzzy.normalise("Über grüßen"));
        assertEquals(BingoFuzzy.normalise("Weißbier"), BingoFuzzy.normalise("weissbier"));
        assertEquals("", BingoFuzzy.normalise("   "));
        assertEquals("", BingoFuzzy.normalise(null));
    }

    @Test
    void groupsSpellingsOfOneThingIntoOneCandidate() {
        var grouping = BingoFuzzy.group(List.of(
                "Alex says 'damn it'",
                "alex says damn it!",
                "Alex says: Damn it"), 0.82);

        assertEquals(1, grouping.candidates().size());
        assertEquals(3, grouping.candidates().get(0).count());
    }

    @Test
    void keepsGenuinelyDifferentEntriesApart() {
        var grouping = BingoFuzzy.group(List.of(
                "Alex says damn it",
                "Jonas mentions the kraken",
                "someone plugs the merch"), 0.82);

        assertEquals(3, grouping.candidates().size());
    }

    @Test
    void aLowerThresholdMergesMoreAndAHigherOneMergesLess() {
        List<String> entries = List.of("kraken sighting", "kraken sightings");

        assertEquals(1, BingoFuzzy.group(entries, 0.8).candidates().size());
        assertEquals(2, BingoFuzzy.group(entries, 1.0).candidates().size());
    }

    @Test
    void showsTheFirstSpellingRatherThanTheNormalisedKey() {
        var grouping = BingoFuzzy.group(List.of("Alex says: Damn it!", "alex says damn it"), 0.82);

        var candidate = grouping.candidates().get(0);
        assertEquals("alex says damn it", candidate.canonical());
        assertTrue(candidate.label().startsWith("Alex") || candidate.label().startsWith("alex"),
                "the label is a spelling someone actually typed, not the comparison key");
    }

    @Test
    void isDeterministicWhateverOrderTheDocStoreHandsThingsBack() {
        // DocStore.query promises no ordering, so the same cards can arrive shuffled on every tick. If
        // grouping depended on arrival order, the published candidates document would churn under a
        // podcaster who is halfway through ticking answers off.
        List<String> entries = new ArrayList<>(List.of(
                "Alex says damn it", "alex says damn it!", "Jonas mentions the kraken",
                "jonas mentions kraken", "merch plug"));

        var first = BingoFuzzy.group(entries, 0.82);
        java.util.Collections.reverse(entries);
        var second = BingoFuzzy.group(entries, 0.82);

        assertEquals(first.candidates(), second.candidates());
    }

    @Test
    void ordersByHowManyPeoplePickedIt() {
        var grouping = BingoFuzzy.group(List.of(
                "merch plug", "kraken", "kraken", "kraken"), 0.9);

        assertEquals("kraken", grouping.candidates().get(0).canonical());
        assertEquals(3, grouping.candidates().get(0).count());
    }

    @Test
    void dropsBlanksInsteadOfCollectingThemIntoOneMeaninglessGroup() {
        var grouping = BingoFuzzy.group(List.of("", "   ", "!!!", "kraken"), 0.82);

        assertEquals(1, grouping.candidates().size());
        assertEquals("kraken", grouping.candidates().get(0).canonical());
    }

    @Test
    void mapsAnIndividualEntryBackToItsGroup() {
        var grouping = BingoFuzzy.group(List.of("Alex says: Damn it!", "alex says damn it"), 0.82);

        assertNotNull(grouping.canonicalOf("ALEX SAYS DAMN IT"));
        assertEquals(grouping.canonicalOf("Alex says: Damn it!"), grouping.canonicalOf("alex says damn it"));
        assertNull(grouping.canonicalOf("something nobody wrote"));
    }

    @Test
    void similarityIsOneForEqualAndFallsOffWithDistance() {
        assertEquals(1.0, BingoFuzzy.similarity("kraken", "kraken"));
        assertEquals(1.0, BingoFuzzy.similarity("", ""));
        assertTrue(BingoFuzzy.similarity("kraken", "krakens") > 0.8);
        assertTrue(BingoFuzzy.similarity("kraken", "merch plug") < 0.4);
    }

    @Test
    void entriesThatDisagreeAboutANumberAreNeverTheSameThing() {
        // One character apart out of fifteen, so edit distance alone would call these the same prediction -
        // and then one tick would score both. The number is the entire content of the guess.
        assertEquals(0.0, BingoFuzzy.similarity("3 sponsor reads", "5 sponsor reads"));
        assertEquals(0.0, BingoFuzzy.similarity("comet fact 1", "comet fact 16"));
        assertEquals(0.0, BingoFuzzy.similarity("episode 1", "episode 2"));
    }

    @Test
    void aNumberOnOneSideOnlyIsLeftToEditDistance() {
        // "1" against "one" is a spelling choice like any other, so nothing special happens here.
        assertTrue(BingoFuzzy.similarity("episode 1", "episode one") > 0.0);
        assertTrue(BingoFuzzy.similarity("3 sponsor reads", "sponsor reads") > 0.0);
    }

    @Test
    void numberedEntriesStayApartInsteadOfCollapsingIntoOneCandidate() {
        var grouping = BingoFuzzy.group(
                List.of("comet fact 1", "comet fact 2", "comet fact 3", "comet fact 16"), 0.82);

        assertEquals(4, grouping.candidates().size(),
                "four different predictions, so four things to tick off");
    }

    @Test
    void theSameNumberStillMergesAcrossSpellings() {
        var grouping = BingoFuzzy.group(List.of("3 sponsor reads", "3 Sponsor Reads!"), 0.82);

        assertEquals(1, grouping.candidates().size(), "same number, same thing");
    }

    // ---------------------------------------------------------------- the pruned comparison

    /**
     * The pruned comparison must never change an answer: it exists only to skip work whose result is
     * already known. Checked against the plain definition over a corpus built to sit near the threshold -
     * short words with single-character edits, so many pairs land right on the boundary.
     */
    @Test
    void thePrunedComparisonAgreesWithTheDefinitionEverywhere() {
        java.util.Random random = new java.util.Random(20261003L);
        String alphabet = "aabcdeeiklmnorstu 12";
        List<String> corpus = new ArrayList<>();
        for (int i = 0; i < 300; i++) {
            StringBuilder word = new StringBuilder();
            int length = 1 + random.nextInt(18);
            for (int c = 0; c < length; c++) {
                word.append(alphabet.charAt(random.nextInt(alphabet.length())));
            }
            corpus.add(BingoFuzzy.normalise(word.toString()));
        }
        double[] cuts = { 0.0, 0.5, 0.7, 0.75, 0.8, 0.82, 0.9, 0.95, 1.0 };
        for (double cut : cuts) {
            for (String a : corpus) {
                for (String b : corpus) {
                    assertEquals(BingoFuzzy.similarity(a, b) >= cut, BingoFuzzy.similarEnough(a, b, cut),
                            () -> "'" + a + "' vs '" + b + "' at " + cut);
                }
            }
        }
    }

    @Test
    void groupingIsUnchangedByThePruning() {
        java.util.Random random = new java.util.Random(7L);
        String[] stems = { "alex says damn it", "kraken", "merch plug", "sponsor read", "guest is late",
                "3 sponsor reads", "comet fact 16", "über grüßen" };
        List<String> entries = new ArrayList<>();
        for (int i = 0; i < 400; i++) {
            StringBuilder text = new StringBuilder(stems[random.nextInt(stems.length)]);
            int edits = random.nextInt(4);
            for (int e = 0; e < edits && text.length() > 1; e++) {
                int at = random.nextInt(text.length());
                switch (random.nextInt(3)) {
                    case 0 -> text.deleteCharAt(at);
                    case 1 -> text.insert(at, (char) ('a' + random.nextInt(26)));
                    default -> text.setCharAt(at, (char) ('a' + random.nextInt(26)));
                }
            }
            entries.add(random.nextBoolean() ? text.toString().toUpperCase() : text + "!");
        }

        for (double cut : new double[] { 0.6, 0.82, 0.9 }) {
            assertEquals(oracle(entries, cut), BingoFuzzy.group(entries, cut).canonicalByNormalised(),
                    "at " + cut);
        }
    }

    /** The grouping as first written: first matching bucket by plain similarity, over a sorted copy. */
    private static java.util.Map<String, String> oracle(List<String> raw, double cut) {
        List<String> sorted = raw.stream().map(BingoFuzzy::normalise).filter(s -> !s.isEmpty()).sorted().toList();
        List<String> buckets = new ArrayList<>();
        java.util.Map<String, String> out = new java.util.HashMap<>();
        for (String n : sorted) {
            if (out.containsKey(n)) {
                continue;
            }
            String match = null;
            for (String b : buckets) {
                if (BingoFuzzy.similarity(n, b) >= cut) {
                    match = b;
                    break;
                }
            }
            if (match == null) {
                match = n;
                buckets.add(n);
            }
            out.put(n, match);
        }
        return out;
    }
}
