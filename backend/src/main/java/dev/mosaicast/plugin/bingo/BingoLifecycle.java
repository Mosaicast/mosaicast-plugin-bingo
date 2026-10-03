// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.Scope;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static dev.mosaicast.plugin.bingo.BingoDocs.*;

/**
 * Where a bingo stands: the podcaster's intent merged with what the host says about the episode's release,
 * plus the archive timer. Pure derivation - it writes nothing.
 */
final class BingoLifecycle {

    private final PluginContext ctx;
    private final Clock clock;

    BingoLifecycle(PluginContext ctx, Clock clock) {
        this.ctx = ctx;
        this.clock = clock;
    }

    private Instant now() {
        return clock.instant();
    }

    /**
     * Merges the podcaster's stated intent with what the feed implies, and applies the archive timer.
     *
     * <p>The intent always wins: auto-locking when the episode is released is a default, not a wall, and
     * reopening a locked episode is a thing a podcaster is allowed to do.
     */
    PhaseState resolvePhase(String slug, EpisodePhase release, PhaseState previous,
                            int archiveAfterDays, boolean allowLate) {
        Scope scope = Scope.episode(slug);

        boolean releasedNow = hasBeenReleased(release);
        // Sticky, and decided the first time this bingo is seen: a bingo that existed before the episode
        // came out is one publication can meaningfully close.
        boolean openedBeforeRelease = previous != null ? previous.openedBeforeRelease() : !releasedNow;
        Phase suggested = openedBeforeRelease && releasedNow ? Phase.LOCKED : Phase.OPEN;

        Phase target = ctx.store().get(scope, KEY_CONTROL, Control.class)
                .map(Control::phase)
                .map(BingoLifecycle::parsePhase)
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

    /**
     * Whether the episode has come out. Withdrawn counts: it was released before it was withdrawn, and a
     * bingo its release locked must not reopen because the feed later dropped the item.
     */
    static boolean hasBeenReleased(EpisodePhase release) {
        return release == EpisodePhase.RELEASED || release == EpisodePhase.WITHDRAWN;
    }

    /** Whether a visitor may know this episode exists: not quiet, and not gone. */
    boolean publiclyVisible(String slug) {
        try {
            return ctx.feeds().display(slug).phase() != EpisodePhase.PLANNED;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Where the host says the episode stands (platformApi 0.18.0); {@code null} for a ref it does not know. */
    EpisodePhase releasePhaseOf(String slug) {
        try {
            return ctx.feeds().display(slug).phase();
        } catch (RuntimeException e) {
            return null;
        }
    }

    static Phase parsePhase(String raw) {
        if (raw == null) {
            return Phase.OPEN;
        }
        try {
            return Phase.valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return Phase.OPEN;
        }
    }
            }
