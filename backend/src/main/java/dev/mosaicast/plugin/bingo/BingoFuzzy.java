// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Groups the free text people write on their bingo cards, so that "Alex says 'damn it'", "alex says damn
 * it!" and "Alex says: Damn it" are one thing to tick off rather than three.
 *
 * <p>Pure — no {@code PluginContext}, no clock, no I/O — because it is the piece whose behaviour everybody
 * argues about and therefore the piece that has to be trivially testable.
 *
 * <p><strong>Determinism is a requirement, not a nicety.</strong> {@code DocStore.query} promises no
 * ordering, so the same set of cards can arrive in a different order on every tick. Grouping is therefore
 * done over a sorted copy: without that, which spelling becomes a group's label would drift from tick to
 * tick, and the published {@code candidates} document would churn under a podcaster who is mid-tick-off.
 */
public final class BingoFuzzy {

    private BingoFuzzy() {}

    /**
     * Reduces a written entry to the form used for comparison: accents folded, case dropped, punctuation
     * removed, internal whitespace collapsed.
     *
     * <p>This is a comparison key, never something a person is shown — the display spelling is whatever
     * the first author of a group actually typed.
     *
     * @param raw the text as typed; may be {@code null}
     * @return the normalised form, empty when the input carries no comparable characters
     */
    public static String normalise(String raw) {
        if (raw == null) {
            return "";
        }
        // NFKD folds the diacritics but leaves ß alone, and "ß"/"ss" is an everyday spelling choice rather
        // than a typo — worth transliterating explicitly, since edit distance alone puts them four apart.
        String folded = Normalizer.normalize(raw, Normalizer.Form.NFKD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replace("ß", "ss");
        // Keep letters, digits and spaces from any script; everything else is punctuation for our purposes.
        StringBuilder out = new StringBuilder(folded.length());
        for (int i = 0; i < folded.length(); i++) {
            char c = folded.charAt(i);
            if (Character.isLetterOrDigit(c)) {
                out.append(c);
            } else if (!out.isEmpty() && out.charAt(out.length() - 1) != ' ') {
                out.append(' ');
            }
        }
        return out.toString().strip();
    }

    /**
     * Similarity of two already-{@link #normalise(String) normalised} strings, as
     * {@code 1 - editDistance / longerLength} — except that entries which disagree about a number are
     * never the same thing.
     *
     * <p>Edit distance weighs every character the same, and a digit is one character. "3 sponsor reads"
     * and "5 sponsor reads" are one edit apart out of fifteen, and "comet fact 1" and "comet fact 16" are
     * one out of thirteen — both far above any usable threshold, so both would merge into a single thing to
     * tick off. A number is the whole content of such a prediction, though, and folding the two makes one
     * tick score both. So when both sides carry digits and those digits differ, they are held apart
     * outright rather than scored on how few characters separate them.
     *
     * <p>Only <em>both</em> sides: "episode 1" against "episode one" is a spelling choice like any other
     * and is left to edit distance to judge.
     *
     * @return {@code 1.0} for equal inputs (two empty strings included), down to {@code 0.0}
     */
    public static double similarity(String a, String b) {
        if (a.equals(b)) {
            return 1.0;
        }
        String digitsA = digitsOf(a);
        String digitsB = digitsOf(b);
        if (!digitsA.isEmpty() && !digitsB.isEmpty() && !digitsA.equals(digitsB)) {
            return 0.0;
        }
        int longer = Math.max(a.length(), b.length());
        if (longer == 0) {
            return 1.0;
        }
        return 1.0 - ((double) levenshtein(a, b) / longer);
    }

    /**
     * Every digit run in a string, in order, separated so that "1 2" and "12" stay distinguishable.
     *
     * @param text a normalised entry
     * @return the digit signature, empty when the entry carries no digits at all
     */
    private static String digitsOf(String text) {
        StringBuilder out = new StringBuilder();
        boolean inRun = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isDigit(c)) {
                out.append(c);
                inRun = true;
            } else if (inRun) {
                out.append('.');
                inRun = false;
            }
        }
        return out.toString();
    }

    /**
     * Groups every entry into candidates: one row per distinct thing, whatever people called it.
     *
     * <p>An entry joins the first existing group it is similar enough to, so a group's identity is fixed by
     * its first member. Entries whose normalised form is empty are dropped rather than collected into one
     * meaningless group.
     *
     * @param rawTexts  every entry from every card, in any order
     * @param threshold similarity at or above which two entries are the same thing; clamped to [0, 1]
     * @return the grouping, ordered by descending count then canonical form
     */
    public static Grouping group(Collection<String> rawTexts, double threshold) {
        double cut = Math.clamp(threshold, 0.0, 1.0);

        // Sorted so grouping cannot depend on the doc store's arbitrary query order (see the class note).
        List<String> ordered = rawTexts.stream()
                .filter(t -> !normalise(t).isEmpty())
                .sorted(Comparator.comparing(BingoFuzzy::normalise).thenComparing(t -> t))
                .toList();

        List<Bucket> buckets = new ArrayList<>();
        Map<String, String> canonicalByNormalised = new HashMap<>();

        for (String raw : ordered) {
            String normalised = normalise(raw);
            String existing = canonicalByNormalised.get(normalised);
            if (existing != null) {
                bucketFor(buckets, existing).count++;
                continue;
            }
            Bucket match = null;
            for (Bucket b : buckets) {
                if (similarity(normalised, b.canonical) >= cut) {
                    match = b;
                    break;
                }
            }
            if (match == null) {
                match = new Bucket(normalised, raw.strip());
                buckets.add(match);
            }
            match.count++;
            canonicalByNormalised.put(normalised, match.canonical);
        }

        List<Candidate> candidates = buckets.stream()
                .map(b -> new Candidate(b.canonical, b.label, b.count))
                .sorted(Comparator.comparingInt(Candidate::count).reversed()
                        .thenComparing(Candidate::canonical))
                .toList();

        return new Grouping(Map.copyOf(canonicalByNormalised), candidates);
    }

    private static Bucket bucketFor(List<Bucket> buckets, String canonical) {
        for (Bucket b : buckets) {
            if (b.canonical.equals(canonical)) {
                return b;
            }
        }
        throw new IllegalStateException("no bucket for canonical " + canonical);
    }

    private static int levenshtein(String a, String b) {
        int[] previous = new int[b.length() + 1];
        int[] current = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            previous[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            current[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                current[j] = Math.min(Math.min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[b.length()];
    }

    private static final class Bucket {
        private final String canonical;
        private final String label;
        private int count;

        private Bucket(String canonical, String label) {
            this.canonical = canonical;
            this.label = label;
        }
    }

    /**
     * One distinct thing to tick off.
     *
     * @param canonical the comparison key, and the key {@code resolution} is written against
     * @param label     the first spelling anyone used for it — what a person is shown
     * @param count     how many entries across all cards landed in this group
     */
    public record Candidate(String canonical, String label, int count) {}

    /**
     * The result of one grouping pass: the candidate list, plus the lookup that puts an individual card
     * entry back into its group.
     */
    public record Grouping(Map<String, String> canonicalByNormalised, List<Candidate> candidates) {

        /**
         * The canonical form of one written entry.
         *
         * @param rawText the text as typed
         * @return the group's canonical form, or {@code null} if this text was not part of the pass
         */
        public String canonicalOf(String rawText) {
            return canonicalByNormalised.get(normalise(rawText));
        }
    }
}
