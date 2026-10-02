// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.bingo;

import dev.mosaicast.plugin.testkit.FakeSchemaStore;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Builds the test kit's schema double <strong>from {@code plugin.json}</strong> rather than from a
 * transcription of it.
 *
 * <p>{@code FakeSchemaStore} enforces the same declaration the host does, so a field this plugin queries
 * but the manifest never declared fails here instead of at load. That guarantee is only worth having if
 * the fixture and the manifest cannot drift — hence reading the real file.
 */
final class BingoSchemaFixture {

    private BingoSchemaFixture() {}

    /** Resolved from {@code backend/} as the working directory, which is where Gradle runs tests. */
    private static final Path MANIFEST = Path.of("..", "plugin.json");

    static FakeSchemaStore schema() {
        JsonNode schema = manifest().path("storage").path("schema");
        if (schema.isMissingNode() || schema.isEmpty()) {
            throw new IllegalStateException("plugin.json declares no storage.schema");
        }

        FakeSchemaStore fake = new FakeSchemaStore("plugin_bingo_");
        for (Map.Entry<String, JsonNode> entity : schema.properties()) {
            List<String> fields = new ArrayList<>();
            List<String> fulltext = new ArrayList<>();
            for (Map.Entry<String, JsonNode> field : entity.getValue().properties()) {
                fields.add(field.getKey());
                if (field.getValue().asString().contains(":fulltext")) {
                    fulltext.add(field.getKey());
                }
            }
            fake = fake.withEntity(entity.getKey(), fields.toArray(String[]::new));
            if (!fulltext.isEmpty()) {
                fake = fake.withFulltext(entity.getKey(), fulltext.toArray(String[]::new));
            }
        }
        return fake;
    }

    /** The manifest's {@code data.backendOwned} patterns, so a test can assert against the real list. */
    static String[] backendOwned() {
        List<String> patterns = new ArrayList<>();
        manifest().path("data").path("backendOwned").forEach(n -> patterns.add(n.asString()));
        return patterns.toArray(String[]::new);
    }

    static JsonNode manifest() {
        try {
            return JsonMapper.builder().build().readTree(Files.readString(MANIFEST));
        } catch (Exception e) {
            throw new IllegalStateException("cannot read " + MANIFEST.toAbsolutePath(), e);
        }
    }
}
