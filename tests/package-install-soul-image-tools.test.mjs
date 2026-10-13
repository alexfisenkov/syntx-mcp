import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import * as parameters from "../dist/src/application/owner-soul-generation-parameters.js";
import * as sourceProfile from "../dist/src/application/owner-soul-image-source-profile.js";
import * as tools from "../dist/src/mcp/owner-soul-image-tools.js";
import * as styleTools from "../dist/src/mcp/owner-soul-style-options-tool.js";
import * as compiledApi from "../dist/src/index.js";
import { z } from "zod/v4";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../dist/src/catalog/selected-discovery-catalog.js";
import { assertInstalledSoulImageRuntimeCallTool, assertSoulImageSourceContract, assertSoulImageToolSurface } from "../scripts/check-package-install.mjs";
import * as packageChecker from "../scripts/check-package-install.mjs";

const indexSource = readFileSync(resolve("src/index.ts"), "utf8");

test("public package exposes the safe Soul generation/tool surface", () => {
  for (const name of ["OwnerSoulImageGenerationService", "OwnerSoulImageGenerationServiceError",
    "OWNER_SOUL_IMAGE_GENERATION_ERROR_CODES", "OWNER_SOUL_IMAGE_GENERATION_PHASES",
    "OWNER_SOUL_IMAGE_GENERATION_HISTORY_REASONS", "OWNER_SOUL_IMAGE_GENERATION_RESULT_REASONS",
    "SYNTX_OWNER_GENERATE_SOUL_IMAGE_TOOL_NAME", "SYNTX_OWNER_RECONCILE_SOUL_IMAGE_TOOL_NAME",
    "SYNTX_OWNER_LIST_SOUL_IMAGE_RECOVERIES_TOOL_NAME", "SYNTX_LIST_OWNER_SOUL_CHARACTER_OPTIONS_TOOL_NAME",
    "SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME", "OWNER_SOUL_IMAGE_TOOL_NAMES",
    "OWNER_SOUL_IMAGE_TOOL_INPUT_SCHEMAS", "OWNER_SOUL_IMAGE_TOOL_OUTPUT_SCHEMAS"]) {
    assert.ok(indexSource.includes(name), `MISSING_PUBLIC_SOUL_EXPORT_${name}`);
  }
  for (const name of ["OwnerSoulImagePreparedCandidate", "OwnerSoulImageOneShotPermit",
    "getOwnerSoulCharacterReferenceId", "readOwnerSoulCharacterRevalidationProvenance",
    "readOwnerSoulStyleRevalidationProvenance"]) {
    assert.equal(indexSource.includes(name), false, `PRIVATE_SOUL_EXPORT_LEAK_${name}`);
  }
});

test("installed Soul schema checker accepts exactly four image tools and the shared Style tool", () => {
  assert.deepEqual([...tools.OWNER_SOUL_IMAGE_TOOL_NAMES], [
    "syntx_owner_generate_soul_image",
    "syntx_owner_reconcile_soul_image",
    "syntx_owner_list_soul_image_recoveries",
    "syntx_list_owner_soul_character_options"
  ]);
  assert.equal(styleTools.SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME, "syntx_list_owner_soul_style_options");
  const registered = new Map();
  const server = { registerTool(name, schema, handler) {
    registered.set(name, { name, ...schema, inputSchema: z.toJSONSchema(schema.inputSchema),
      outputSchema: z.toJSONSchema(schema.outputSchema), handler });
  } };
  tools.registerSyntxOwnerSoulImageTools(server, {
    characterOptionsService: { listOptions: async () => ({}) },
    generationService: { generate: async () => ({}), reconcile: async () => ({}), listRecoveries: async () => ({}) }
  });
  styleTools.registerSyntxOwnerSoulStyleOptionsTool(server, { service: { listOptions: async () => ({}) } });
  assert.equal(assertSoulImageToolSurface([...registered.values()], true).soul_image_tool_count, 5);
  assert.throws(() => assertSoulImageToolSurface([...registered.values()].slice(0, 4), true),
    (error) => error.code === "INSTALLED_SOUL_IMAGE_TOOL_SET_MISMATCH");
  assert.equal(assertSoulImageToolSurface([{ name: "syntx_existing_tool" }], false).soul_image_tool_count, 0);
});

test("Soul source checker covers the pinned explicit parameter matrix without defaults or provider claims", () => {
  assert.equal(typeof parameters.getOwnerSoulGenerationSourceParameters, "function");
  assert.equal(typeof sourceProfile.getOwnerSoulImageSourceProfile, "function");
  assert.equal(typeof tools.OWNER_SOUL_IMAGE_TOOL_NAMES[0], "string");
  assert.equal(typeof styleTools.SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME, "string");
  const selected = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, "catalog");
  const summary = assertSoulImageSourceContract(parameters, sourceProfile, selected.discoveryCatalog,
    DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  assert.deepEqual(summary, { quality_resolution_pairs_checked: 14, batch_cases_checked: 28, seed_cases_checked: 3,
    style_strengths_checked: 11, source_cost_keys: ["batch_size", "quality", "resolution"] });
});

test("installed Soul runtime generation handler succeeds through MCP callTool with synthetic endpoints only", async () => {
  const result = await assertInstalledSoulImageRuntimeCallTool(compiledApi, resolve("."));
  assert.deepEqual(result, { call_tool: "PASS_SYNTHETIC_INSTALLED_RUNTIME", generation_posts: 1, preflight_instances: 2 });
});

test("Soul child failures report bounded phase, class, and stderr size without raw messages", () => {
  assert.equal(typeof packageChecker.soulChildFailureCode, "function");
  const diagnostic = packageChecker.soulChildFailureCode(false, "tools-list", new TypeError("private detail"), 12);
  assert.equal(diagnostic, "INSTALLED_SOUL_IMAGE_STDIO_DEFAULT_TOOLS_LIST_TypeError_UNEXPECTED_STDERR_12_EMPTY");
  assert.equal(diagnostic.includes("private detail"), false);
  assert.equal(packageChecker.soulStderrMissingTarget("Error: Cannot find module '/private/tmp/project/dist/src/mcp/owner-soul-image-tools.js'"),
    "MISSING_OWNER-SOUL-IMAGE-TOOLS.JS");
  assert.equal(packageChecker.soulStderrMissingTarget("Error: Cannot find package '@modelcontextprotocol/sdk' imported from /private/path"),
    "MISSING_MODELCONTEXTPROTOCOL_SDK");
  assert.equal(packageChecker.soulStderrMissingTarget("non-module failure"), "NONE");
  assert.throws(() => packageChecker.soulChildFailureCode(false, "unbounded", new Error("unused"), 0),
    (error) => error.code === "INSTALLED_SOUL_IMAGE_DIAGNOSTIC_PHASE_INVALID");
});

test("Soul installed child uses a bounded connection/list deadline helper", async () => {
  assert.equal(typeof packageChecker.soulWithDeadline, "function");
  assert.equal(await packageChecker.soulWithDeadline(Promise.resolve("connected"), 100, "SOUL_TEST_TIMEOUT"), "connected");
  await assert.rejects(packageChecker.soulWithDeadline(new Promise(() => {}), 1, "SOUL_TEST_TIMEOUT"),
    (error) => error.code === "SOUL_TEST_TIMEOUT");
});

test("Soul owner stdio child defaults off and closes cleanly with exactly five opt-in tools", async () => {
  const projectRoot = resolve(".");
  const defaultSurface = await packageChecker.listInstalledSoulImageTools(projectRoot, projectRoot, false);
  const optInSurface = await packageChecker.listInstalledSoulImageTools(projectRoot, projectRoot, true);
  assert.equal(defaultSurface.soul_image_tool_count, 0);
  assert.equal(optInSurface.soul_image_tool_count, 5);
  for (const surface of [defaultSurface, optInSurface]) {
    assert.equal(surface.child_close, "CLOSED");
    assert.equal(surface.child_pid_null, true);
    assert.equal(surface.stderr_bytes, 0);
    assert.equal(surface.network_calls, 0);
    assert.equal(surface.sdk_version, "1.32.1");
  }
});
