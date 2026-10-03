// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.OgMeta;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.api.UserRef;
import dev.mosaicast.plugin.api.Users;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * The plugin's pages under {@code /p/bingo/}: which subpaths exist, and how a link to one reads when it is
 * shared.
 *
 * <ul>
 *   <li>{@code ""} - the site page: standings and every bingo there is.</li>
 *   <li>{@code e/<slug>} - one bingo: how it went, and a way into the episode.</li>
 *   <li>{@code e/<slug>/u/<userId>} - one player's published result, the link a player shares.</li>
 * </ul>
 *
 * <p>Both questions run on a visitor's request, so each is a few document reads, never a scan. Neither
 * answers for an episode nobody may know about yet: a quiet episode's bingo is a 404 and has no share card.
 *
 * <p><strong>What a share card never says.</strong> A link preview is read in a chat by people who may not
 * have heard the episode, and no spoiler cover reaches into a chat. So a card says how many played and how a
 * card scored - never what was predicted or what came true.
 */
final class BingoPages {

    private final PluginContext ctx;
    private final BingoLifecycle lifecycle;

    BingoPages(PluginContext ctx, BingoLifecycle lifecycle) {
        this.ctx = ctx;
        this.lifecycle = lifecycle;
    }

    /** See {@link dev.mosaicast.plugin.api.PageRouteProvider#hasRoute}. */
    boolean hasRoute(String subpath) {
        List<String> parts = segments(subpath);
        if (parts.isEmpty()) {
            return true; // the site page
        }
        if (!parts.get(0).equals("e")) {
            return false;
        }
        if (parts.size() == 2) {
            return isPublicBingo(parts.get(1));
        }
        if (parts.size() == 4 && parts.get(2).equals("u")) {
            return sharedResult(parts.get(1), parts.get(3)).isPresent();
        }
        return false;
    }

    /** See {@link dev.mosaicast.plugin.api.ShareMetadataProvider#metaFor}. */
    Optional<OgMeta> metaFor(String subpath) {
        List<String> parts = segments(subpath);
        String locale = language();
        if (parts.isEmpty()) {
            return Optional.of(new OgMeta("Bingo", text(locale,
                    "Predict what happens in the next episode, and see how everyone's card did.",
                    "Tippe, was in der nächsten Folge passiert, und sieh, wie alle Karten abgeschnitten haben."),
                    null, locale));
        }
        if (!parts.get(0).equals("e") || parts.size() < 2 || !isPublicBingo(parts.get(1))) {
            return Optional.empty();
        }
        String slug = parts.get(1);
        DisplaySnapshot episode = snapshot(slug);
        String episodeTitle = episode == null ? slug : episode.title();
        String image = episode == null ? null : episode.artwork();

        if (parts.size() == 4 && parts.get(2).equals("u")) {
            Optional<Row> row = sharedResult(slug, parts.get(3));
            if (row.isPresent()) {
                return Optional.of(new OgMeta(
                        text(locale, nameOf(parts.get(3), locale) + "'s bingo for “" + episodeTitle + "”",
                                "Das Bingo von " + nameOf(parts.get(3), locale) + " für „" + episodeTitle + "“"),
                        scoreLine(row.get(), slug, locale), image, locale));
            }
        }

        Phase phase = phaseOf(slug);
        Leaderboard board = ctx.store().get(Scope.episode(slug), KEY_LEADERBOARD, Leaderboard.class).orElse(null);
        int players = board == null ? 0 : board.players();
        String description = switch (phase) {
            case OPEN -> text(locale, "Fill in your card before the episode is out.",
                    "Füll deine Karte aus, bevor die Folge erscheint.");
            case LOCKED -> text(locale, "Predictions are closed. " + players + " card(s) in play.",
                    "Die Tipps sind geschlossen. " + players + " Karte(n) im Spiel.");
            case RESOLVED, ARCHIVED -> text(locale, "Resolved: " + players + " card(s) played. See how they did.",
                    "Aufgelöst: " + players + " Karte(n) gespielt. Sieh nach, wie sie abgeschnitten haben.");
        };
        return Optional.of(new OgMeta(text(locale, "Bingo: " + episodeTitle, "Bingo: " + episodeTitle),
                description, image, locale));
    }

    /** A bingo exists here and everyone may know the episode does. */
    private boolean isPublicBingo(String slug) {
        return ctx.store().get(Scope.episode(slug), KEY_TEMPLATE, Template.class).isPresent()
                && lifecycle.publiclyVisible(slug);
    }

    /**
     * A player's result as the published board shows it - nothing more. Someone who opted out, someone
     * past the board's cap and an unresolved bingo all have no shareable result, and the page falls back to
     * the bingo itself.
     */
    private Optional<Row> sharedResult(String slug, String userId) {
        if (!isPublicBingo(slug)) {
            return Optional.empty();
        }
        return ctx.store().get(Scope.episode(slug), KEY_LEADERBOARD, Leaderboard.class)
                .filter(Leaderboard::published)
                .flatMap(board -> Stream.concat(rows(board.ranked()), rows(board.late()))
                        .filter(row -> row.author().equals(userId))
                        .findFirst());
    }

    private static Stream<Row> rows(List<Row> rows) {
        return rows == null ? Stream.empty() : rows.stream();
    }

    private String scoreLine(Row row, String slug, String locale) {
        Template template = ctx.store().get(Scope.episode(slug), KEY_TEMPLATE, Template.class).orElse(null);
        int size = template == null ? BingoPlugin.DEFAULT_GRID_SIZE : template.gridSize();
        String late = row.ranked() ? "" : text(locale, " (played late)", " (nachgespielt)");
        return text(locale,
                row.lines() + " of " + BingoScore.lineCount(size) + " lines, " + row.fields() + " of "
                        + row.cells() + " squares" + late,
                row.lines() + " von " + BingoScore.lineCount(size) + " Reihen, " + row.fields() + " von "
                        + row.cells() + " Feldern" + late);
    }

    /** Resolved now and never stored: a name copied anywhere would outlive the rename meant to shed it. */
    private String nameOf(String userId, String locale) {
        Users users = ctx.users();
        if (users != null) {
            try {
                List<UserRef> found = users.resolve(List.of(UUID.fromString(userId)));
                if (!found.isEmpty() && found.get(0).displayName() != null) {
                    return found.get(0).displayName();
                }
            } catch (RuntimeException e) {
                // an unparseable id or a directory hiccup: the card still reads, just without a name
            }
        }
        return text(locale, "A listener", "Ein Hörer");
    }

    private Phase phaseOf(String slug) {
        return ctx.store().get(Scope.episode(slug), KEY_PHASE, PhaseState.class)
                .map(PhaseState::phase)
                .map(BingoLifecycle::parsePhase)
                .orElse(Phase.OPEN);
    }

    private DisplaySnapshot snapshot(String slug) {
        try {
            return ctx.feeds().display(slug);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The language a card is written in. {@code metaFor} is not told who asked, so the card follows the
     * site's default language where this plugin speaks it, and says so in {@code og:locale}.
     */
    private String language() {
        try {
            String code = ctx.locales().defaultLocale();
            return code != null && code.toLowerCase(Locale.ROOT).startsWith("de") ? "de" : "en";
        } catch (RuntimeException e) {
            return "en";
        }
    }

    private static String text(String locale, String en, String de) {
        return Map.of("en", en, "de", de).getOrDefault(locale, en);
    }

    /** A subpath's segments, ignoring slashes at either end and anything from a query or fragment on. */
    static List<String> segments(String subpath) {
        if (subpath == null) {
            return List.of();
        }
        String path = subpath;
        for (char stop : new char[] { '?', '#' }) {
            int at = path.indexOf(stop);
            if (at >= 0) {
                path = path.substring(0, at);
            }
        }
        return Stream.of(path.split("/")).filter(s -> !s.isEmpty()).toList();
    }
}
