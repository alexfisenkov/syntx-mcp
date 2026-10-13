import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { StaticSettingsSourceRef } from "../src/catalog/normalized-settings-parser-canary.js";
import {
  BananaParserCanaryCompilerError,
  buildBananaParserCanaryCompilerOutput,
  type BuildBananaParserCanaryCompilerOutputInput
} from "../tools/settings-ir/build-banana-parser-canary.js";

const ARTIFACT_SHA256 = `sha256:${"2".repeat(64)}`;

test("adapts one partial source conservatively for all four Banana models", () => {
  const source = vueSfc(`
import { computed, watch } from "vue"
const SCOPE = "image"
const AI_NAME = "banana"
const settingsGroups = { format: ["aspect_ratio"] }
const defaultSettings = {
  aspect_ratio: "9:16",
  image_size: "2K",
  seed: resolveSeed()
}
const controls = computed(() => [{ id: "quality" }])
watch(AI_NAME, () => {})
`, `<section v-if="visible" />`);

  const output = buildBananaParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source)
  });

  assert.equal(output.parser_profile, "STATIC_SETTINGS_V1");
  assert.equal(output.engine.name, "typescript");
  assert.equal(
    output.engine.implementation_sha256,
    loadedCompilerImplementationSha256()
  );
  assert.equal(output.engine.execution_mode, "SYNTAX_ONLY_NO_VENDOR_EXECUTION");
  assert.equal(output.engine.type_checking, false);
  assert.equal(output.engine.emit, false);
  assert.equal(output.engine.import_resolution, false);
  assert.equal(output.forms.length, 1);

  const form = output.forms[0];
  const sourceRef = makeSourceRef(source);
  assert.equal(form.form_id, "banana");
  for (const projection of Object.values(form.projections)) {
    assert.equal(projection.status, "BLOCKED");
  }
  assert.deepEqual(form.projections.controls, {
    status: "BLOCKED",
    proof_scope: "STATIC_CANDIDATES_ONLY_NOT_RUNTIME_SEMANTICS",
    static_candidates: [
      {
        path: ["format"],
        value: ["aspect_ratio"],
        locator: {
          source_index: sourceRef.source_index,
          source_path: sourceRef.source_path,
          source_content_sha256: sourceRef.source_content_sha256,
          line: 5,
          column: 7,
          node_kind: "VariableDeclaration"
        }
      }
    ]
  });
  assert.equal(
    form.projections.defaults.status === "BLOCKED" &&
      "static_candidates" in form.projections.defaults,
    true
  );
  assert.ok(
    form.blockers.some(
      (blocker) =>
        blocker.projection === "computed_rules" &&
        blocker.code === "COMPUTED_RULE_NOT_INTERPRETED"
    )
  );
  assert.ok(
    form.blockers.some(
      (blocker) =>
        blocker.projection === "watch_rules" &&
        blocker.code === "WATCH_RULE_NOT_INTERPRETED"
    )
  );
  assert.deepEqual(
    form.blockers.filter(
      (blocker) => blocker.projection === "payload_projection"
    ),
    [
      {
        code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
        projection: "payload_projection",
        locator: null
      },
      {
        code: "PAYLOAD_PROJECTION_UNVERIFIED",
        projection: "payload_projection",
        locator: null
      }
    ]
  );
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes("import {"), false);
  assert.equal(serialized.includes("resolveSeed"), false);
  assert.equal(serialized.includes("v-if="), false);
});

test("does not majority-merge model-dependent values into proven form data", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
const defaultSettings = model_id === "banana"
  ? { aspect_ratio: "1:1" }
  : { aspect_ratio: "16:9" }
`);
  const output = buildBananaParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source)
  });

  assert.deepEqual(output.forms[0].projections.defaults, {
    status: "BLOCKED"
  });
  assert.ok(
    output.forms[0].blockers.some(
      (blocker) =>
        blocker.projection === "defaults" &&
        blocker.code === "SOURCE_PATTERN_NOT_RECOGNIZED"
    )
  );
});

test("promotes only identical complete literal bindings within the parser profile", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
const defaultSettings = { aspect_ratio: "1:1", image_size: "2K" }
`);
  const output = buildBananaParserCanaryCompilerOutput({
    source,
    sourceRef: makeSourceRef(source)
  });

  assert.equal(output.forms[0].projections.defaults.status, "PROVEN");
  assert.deepEqual(output.forms[0].projections.defaults, {
    status: "PROVEN",
    proof_scope: "STATIC_LITERAL_TREE_ONLY",
    facts: [
      {
        path: ["aspect_ratio"],
        value: "1:1",
        locator: {
          source_index: 2,
          source_path: "/src/components/chat/forms/settings/banana.vue",
          source_content_sha256: makeSourceRef(source).source_content_sha256,
          line: 4,
          column: 7,
          node_kind: "VariableDeclaration"
        }
      },
      {
        path: ["image_size"],
        value: "2K",
        locator: {
          source_index: 2,
          source_path: "/src/components/chat/forms/settings/banana.vue",
          source_content_sha256: makeSourceRef(source).source_content_sha256,
          line: 4,
          column: 7,
          node_kind: "VariableDeclaration"
        }
      }
    ]
  });
  assert.equal(
    output.forms[0].projections.computed_rules.status,
    "ABSENT_PROVEN"
  );
  assert.equal(output.forms[0].projections.watch_rules.status, "ABSENT_PROVEN");
  assert.equal(output.forms[0].projections.controls.status, "BLOCKED");
  assert.equal(output.forms[0].projections.conditional_rules.status, "BLOCKED");
});

test("is deterministic for the same verified source", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
const settingsGroups = { format: ["aspect_ratio"] }
`);
  const input = {
    source,
    sourceRef: makeSourceRef(source)
  };
  assert.deepEqual(
    buildBananaParserCanaryCompilerOutput(input),
    buildBananaParserCanaryCompilerOutput(input)
  );
});

test("rejects runtime shape, oversize, source hash, and identity drift with fixed errors", () => {
  const source = vueSfc(`
const SCOPE = "image"
const AI_NAME = "banana"
`);
  const sourceRef = makeSourceRef(source);
  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput({
        source: `${source}\n`,
        sourceRef
      }),
    hasCode("SOURCE_RELATIONSHIP_INVALID")
  );
  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput({
        source: source.replace('"image"', '"video"'),
        sourceRef: makeSourceRef(source.replace('"image"', '"video"'))
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput(
        null as unknown as BuildBananaParserCanaryCompilerOutputInput
      ),
    hasCode("PARSER_OUTPUT_INVALID")
  );
  assert.throws(
    () =>
      buildBananaParserCanaryCompilerOutput({
        source: "x".repeat(1_048_577),
        sourceRef
      }),
    hasCode("PARSER_OUTPUT_INVALID")
  );
});

function vueSfc(script: string, template = "<section />"): string {
  return `<script setup lang="ts">${script}</script>\n<template>${template}</template>\n`;
}

function makeSourceRef(source: string): StaticSettingsSourceRef {
  return {
    provider_javascript_sha256: ARTIFACT_SHA256,
    provider_source_map_sha256: ARTIFACT_SHA256,
    source_index: 2,
    source_path: "/src/components/chat/forms/settings/banana.vue",
    source_content_sha256: `sha256:${createHash("sha256")
      .update(source, "utf8")
      .digest("hex")}`
  };
}

function loadedCompilerImplementationSha256(): string {
  const implementations = [
    [
      "adapter",
      readFileSync(
        new URL("../tools/settings-ir/build-banana-parser-canary.js", import.meta.url)
      )
    ],
    [
      "static-compiler",
      readFileSync(
        new URL("../tools/settings-ir/static-settings-compiler.js", import.meta.url)
      )
    ]
  ] as const;
  const hash = createHash("sha256");
  for (const [name, bytes] of implementations) {
    hash.update(`${name}\u0000${bytes.byteLength}\u0000`, "utf8");
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function hasCode(code: BananaParserCanaryCompilerError["code"]) {
  return (error: unknown): boolean =>
    error instanceof BananaParserCanaryCompilerError &&
    error.code === code &&
    !error.message.includes("banana.vue");
}
