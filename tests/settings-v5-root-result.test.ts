import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { sha256CanonicalPayload } from "../src/catalog/syntx-public-catalog.js";
import {
  assertRootOnlyResultMatchesScopeV5, loadRootOnlyResultV5,
  rootOnlyResultV5Schema, rootOnlyScopeV5Schema, serializeRootOnlyResultV5,
  ROOT_ONLY_V5_BLOCKER_CODES
} from "../src/catalog/settings-root-only-result-v5.js";
import { buildRootOnlyResultV5, RootOnlyCompilationV5Error } from "../tools/settings-ir/v5/compile-root-only.js";
import type { VerifiedRootBundleV5 } from "../tools/settings-ir/v5/pinned-root-bundle.js";
import type { StaticSettingsBlockerCode } from "../tools/settings-ir/static-settings-compiler.js";

// Compiler vocabulary drift must fail typecheck in either direction.
const blockerVocabularyMatches: [StaticSettingsBlockerCode] extends [(typeof ROOT_ONLY_V5_BLOCKER_CODES)[number]]
  ? [(typeof ROOT_ONLY_V5_BLOCKER_CODES)[number]] extends [StaticSettingsBlockerCode] ? true : never : never = true;

test("v5 compiles one model root while the verified auxiliary remains uncompiled", () => {
  const result = build();
  assert.equal(result.root_results[0].compiler_status, "COMPLETE");
  const defaults = result.root_results[0].bindings.defaultSettings;
  assert.equal(defaults.status, "PROVEN");
  if (defaults.status !== "PROVEN") assert.fail("Expected proven root-local defaults");
  assert.deepEqual(defaults.value, { mode: "switch" });
  assert.equal(result.compilation_status, "PARTIAL_COMPILED");
  assert.equal(result.closure.status, "OPEN");
  assert.deepEqual(result.coverage, {
    declared_source_refs: 2,
    verified_source_refs: 2,
    compiled_source_units: 1,
    uncompiled_auxiliary_source_refs: 1,
    compiled_model_contexts: 1
  });
});

test("v5 serializes verified metadata and root-local values, never root or auxiliary source", () => {
  assert.equal(blockerVocabularyMatches, true);
  const result = build();
  const text = serializeRootOnlyResultV5(result);
  assert.deepEqual(loadRootOnlyResultV5(text), result);
  assert.deepEqual(assertRootOnlyResultMatchesScopeV5(result, material().scope), result);
  assert.equal(text.includes(rootSource), false);
  assert.equal(text.includes("AUXILIARY_BODY_NOT_VALID_VUE"), false);
  assert.equal(text.includes("sourcesContent"), false);
  assert.equal(result.root_results[0].source_ref_id, result.scope.root_source_ref_id);
  assert.equal(result.closure.blockers[0].source_ref_id, result.scope.auxiliary_source_ref_ids[0]);
});

test("root-local blocked candidates and compiler blockers survive without becoming form proof", () => {
  const source = rootSource.replace(
    'model_id === "switchx" ? { mode: "switch" } : { mode: "other" }',
    '{ mode: "candidate", dynamic: resolveMode() }'
  );
  const result = build(source);
  const observed = result.root_results[0].bindings.defaultSettings;
  assert.equal(result.root_results[0].compiler_status, "PARTIAL");
  assert.equal(observed.status, "BLOCKED");
  assert.ok("candidates" in observed);
  assert.deepEqual(observed.candidates, { mode: "candidate" });
  assert.ok(result.root_results[0].blockers.length > 0);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.closure.status, "OPEN");
});

test("missing or mismatched AI_NAME is refused instead of claiming a matching form", () => {
  for (const source of [
    rootSource.replace('const AI_NAME = "beeble"', 'const AI_NAME = "other"'),
    rootSource.replace('const AI_NAME = "beeble"', '')
  ]) assert.throws(() => build(source), RootOnlyCompilationV5Error);
});

test("compiler rechecks every material source hash and descriptor, including uncompiled auxiliary", () => {
  const original = material();
  for (const value of [
    tamper(original, ["sources", 0, "content"], "CHANGED_AUXILIARY"),
    tamper(original, ["sources", 1, "content"], rootSource + " "),
    tamper(original, ["sources", 0, "source_content_sha256"], hash("wrong")),
    tamper(original, ["sources", 0, "role"], "ROOT"),
    tamper(original, ["sources"], [original.sources[1]]),
    tamper(original, ["scope", "auxiliary_source_ref_ids"], []),
    tamper(original, ["scope", "source_map", "sha256"], hash("wrong"))
  ]) assert.throws(() => buildRootOnlyResultV5({
    material: value as VerifiedRootBundleV5, implementationComponents: components, generatedAt
  }), RootOnlyCompilationV5Error);
});

test("scope rejects altered source references, locators and raw-source fields", () => {
  const scope = material().scope;
  for (const changed of [
    tamper(scope, ["sources", 0, "source_ref_id"], scope.root_source_ref_id),
    tamper(scope, ["sources", 1, "source_index"], 0),
    tamper(scope, ["sources", 0, "source_path"], "/tmp/MaskEditor.vue"),
    tamper(scope, ["sources", 0, "content"], "source body"),
    tamper(scope, ["javascript", "url"], "https://example.com/beeble.js"),
    tamper(scope, ["model_ids"], ["switchx", "other"]),
    tamper(scope, ["bindings"], []),
    tamper(scope, ["source_observed_at"], "not-a-date")
  ]) assert.equal(rootOnlyScopeV5Schema.safeParse(changed).success, false);
});

test("result rejects altered coverage, auxiliary closure, source binding and runtime claims", () => {
  const result = build();
  for (const changed of [
    tamper(result, ["runtime_usable"], true),
    tamper(result, ["compilation_status"], "COMPLETE"),
    tamper(result, ["closure", "status"], "CLOSED"),
    tamper(result, ["closure", "blockers"], []),
    tamper(result, ["closure", "blockers", 0, "compilation_status"], "COMPILED"),
    tamper(result, ["closure", "blockers", 0, "source_ref_id"], result.scope.root_source_ref_id),
    tamper(result, ["coverage", "compiled_source_units"], 2),
    tamper(result, ["coverage", "compiled_model_contexts"], 2),
    tamper(result, ["coverage", "verified_source_refs"], 1),
    tamper(result, ["coverage", "declared_source_refs"], 1),
    tamper(result, ["coverage", "uncompiled_auxiliary_source_refs"], 0),
    tamper(result, ["verification", "verified_source_ref_ids"], [result.scope.root_source_ref_id, result.scope.root_source_ref_id]),
    tamper(result, ["root_results", 0, "source_ref_id"], result.scope.auxiliary_source_ref_ids[0]),
    tamper(result, ["generated_at"], "2026-09-01T00:00:00.000Z")
  ]) assert.equal(rootOnlyResultV5Schema.safeParse(changed).success, false);
});

test("result validates candidates as strictly as proven values and requires paired evidence", () => {
  const result = build(rootSource.replace(
    'model_id === "switchx" ? { mode: "switch" } : { mode: "other" }',
    '{ mode: "candidate", dynamic: resolveMode() }'
  ));
  for (const changed of [
    tamper(result, ["root_results", 0, "bindings", "defaultSettings", "candidates"], { token: "hidden" }),
    tamper(result, ["root_results", 0, "bindings", "defaultSettings", "candidates_locator"], null),
    tamper(result, ["root_results", 0, "bindings", "defaultSettings", "blocker_codes"], []),
    tamper(result, ["root_results", 0, "bindings", "defaultSettings", "locator", "line"], 0),
    tamper(result, ["root_results", 0, "bindings", "defaultSettings", "candidates_locator", "column"], 0),
    tamper(result, ["root_results", 0, "blockers"], []),
    tamper(result, ["root_results", 0, "compiler_status"], "COMPLETE")
  ]) assert.equal(rootOnlyResultV5Schema.safeParse(changed).success, false);
});

test("static values reject source snippets, secrets, unsafe keys and non-JSON bounds", () => {
  const result = build();
  let tooDeep: unknown = null;
  for (let index = 0; index < 40; index++) tooDeep = { nested: tooDeep };
  for (const unsafe of [
    { raw: "private code" }, { source: "private body" }, { authorization: "hidden" },
    { note: "Bearer example-abcdefghijklmnopqrstuvwxyz" }, { note: "sk-proj-example-abcdefghijklmnopqrstuvwxyz" },
    { note: "secret=example" }, { note: "123456789:abcdefghijklmnopqrstuvwxyz" },
    { note: "<script setup>const x = 1</script>" }, { note: "const rawSource = 1;" },
    { note: "line one\nline two" }, { note: "x".repeat(2049) },
    { number: Number.NaN }, { list: new Array(2049).fill(null) },
    { list: new Array(2) }, tooDeep,
    JSON.parse('{"__proto__":{"polluted":true}}') as unknown,
    Object.fromEntries(Array.from({ length: 513 }, (_, index) => [`key${index}`, true]))
  ]) assert.equal(rootOnlyResultV5Schema.safeParse(tamper(
    result, ["root_results", 0, "bindings", "defaultSettings", "value"], unsafe
  )).success, false);
  assert.equal(rootOnlyResultV5Schema.safeParse({ ...result, raw_source: rootSource }).success, false);
});

test("runtime schema rejects accessors, proxies and cycles without invoking them", () => {
  const result = build();
  let calls = 0;
  const accessor = { ...result };
  Object.defineProperty(accessor, "generated_at", { enumerable: true, get() { calls++; return generatedAt; } });
  assert.equal(rootOnlyResultV5Schema.safeParse(accessor).success, false);
  assert.equal(calls, 0);
  assert.equal(rootOnlyResultV5Schema.safeParse(new Proxy(result, {})).success, false);
  const cyclic: Record<string, unknown> = { ...result };
  cyclic.loop = cyclic;
  assert.equal(rootOnlyResultV5Schema.safeParse(cyclic).success, false);
  const sourceScope = { ...material().scope };
  Object.defineProperty(sourceScope, "ai_name", { enumerable: true, get() { calls++; return "beeble"; } });
  assert.equal(rootOnlyScopeV5Schema.safeParse(sourceScope).success, false);
  assert.equal(calls, 0);
});

test("compiler rejects accessor source content before evaluating caller-owned getters", () => {
  const input = material();
  let calls = 0;
  Object.defineProperty(input.sources[0], "content", { enumerable: true, get() { calls++; return "not source"; } });
  assert.throws(() => buildRootOnlyResultV5({ material: input, implementationComponents: components, generatedAt }), RootOnlyCompilationV5Error);
  assert.equal(calls, 0);
});

test("implementation provenance is sorted, unique and bound to its full component set", () => {
  const result = build();
  for (const changed of [
    tamper(result, ["toolchain", "implementation_components"], []),
    tamper(result, ["toolchain", "implementation_components"], [components[0], components[0]]),
    tamper(result, ["toolchain", "implementation_components", 0, "sha256"], hash("tampered")),
    tamper(result, ["toolchain", "implementation_set_sha256"], hash("tampered")),
    tamper(result, ["toolchain", "implementation_components", 0, "name"], "../escape")
  ]) assert.equal(rootOnlyResultV5Schema.safeParse(changed).success, false);
  const otherScope = structuredClone(material().scope);
  const changedScope = tamper(otherScope, ["bindings", 0, "sha256"], hash("other"));
  assert.throws(() => assertRootOnlyResultMatchesScopeV5(result, changedScope));
});

const generatedAt = "2026-09-04T12:00:00.000Z";
const components = [{ name: "module.test.compiler.js", bytes: 9, sha256: hash("compiler") }];
const rootSource = `<script setup>
const SCOPE = "VIDEO"
const AI_NAME = "beeble"
const settingsGroups = []
const defaultSettings = model_id === "switchx" ? { mode: "switch" } : { mode: "other" }
const controls = []
const conditionalRules = []
</script><template><div /></template>`;

function material(source = rootSource): VerifiedRootBundleV5 {
  const texts = ["AUXILIARY_BODY_NOT_VALID_VUE_AND_MUST_NOT_BE_COMPILED", source];
  const paths = [
    "/src/components/chat/forms/settings/components/beeble/MaskEditor.vue",
    "/src/components/chat/forms/settings/beeble.vue"
  ];
  const js = "//# sourceMappingURL=beeble.js.map";
  const map = JSON.stringify({ version: 3, sources: paths, sourcesContent: texts, names: [], mappings: "" });
  const javascript = { url: "https://syntx.ai/assets/1788368942/beeble.js", bytes: Buffer.byteLength(js), sha256: hash(js) };
  const source_map = { url: `${javascript.url}.map`, bytes: Buffer.byteLength(map), sha256: hash(map) };
  const sources = paths.map((source_path, source_index) => {
    const content = texts[source_index]!;
    const source_content_sha256 = hash(content);
    return {
      source_ref_id: `settings-source-${sha256CanonicalPayload({
        role: "PROVIDER_FORM", module_name: "beeble.js", form_id: "beeble",
        module_javascript_sha256: javascript.sha256,
        module_source_map_sha256: source_map.sha256,
        source_index, source_path, source_content_sha256
      }).slice(7)}`,
      role: source_index === 0 ? "AUXILIARY" as const : "ROOT" as const,
      source_index, source_path, source_content_sha256, content
    };
  });
  return {
    scope: {
      form_id: "beeble", ai_name: "beeble", model_ids: ["switchx"],
      root_source_ref_id: sources[1]!.source_ref_id,
      auxiliary_source_ref_ids: [sources[0]!.source_ref_id],
      source_observed_at: "2026-09-03T12:00:00.000Z",
      bindings: (["public_catalog", "inventory", "census"] as const).map((name) => ({ name, bytes: 10, sha256: hash(name) })),
      javascript, source_map,
      sources: sources.map(({ content: _content, ...descriptor }) => descriptor)
    },
    sources
  };
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function build(source = rootSource) {
  return buildRootOnlyResultV5({ material: material(source), implementationComponents: components, generatedAt });
}

function tamper(value: unknown, path: (string | number)[], replacement: unknown): unknown {
  const clone = structuredClone(value);
  let current = clone as Record<string, unknown>;
  for (const key of path.slice(0, -1)) current = current[String(key)] as Record<string, unknown>;
  current[String(path.at(-1))] = replacement;
  return clone;
}
