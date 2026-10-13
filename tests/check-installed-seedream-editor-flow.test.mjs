import assert from "node:assert/strict";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import * as checker from "../scripts/check-installed-seedream-editor-flow.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BUNDLED_NODE = "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node";

const variants = ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"];
const names = ["syntx_get_seedream_editor_image_parameters", "syntx_upload_seedream_editor_original", "syntx_upload_seedream_editor_drawing",
  "syntx_owner_generate_seedream_editor_image", "syntx_owner_reconcile_seedream_editor_image", "syntx_owner_list_seedream_editor_image_recoveries",
  "syntx_owner_get_seedream_editor_image_result_page"];
const variantsResolutions = { "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"],
  "seedream-5": ["2K", "3K", "4K"], "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"] };

test("installed Editor package paths are exact, required, and include both pinned archives", () => {
  assert.ok(checker.SEEDREAM_EDITOR_REQUIRED_PACKAGE_PATHS.includes("dist/src/index.js"));
  assert.ok(checker.SEEDREAM_EDITOR_REQUIRED_PACKAGE_PATHS.some((path) => path === "catalog/public/sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json"));
  assert.ok(checker.SEEDREAM_EDITOR_REQUIRED_PACKAGE_PATHS.some((path) => path === "catalog/settings/v2/sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"));
  assert.equal(checker.assertSeedreamEditorPackagePaths(new Set(checker.SEEDREAM_EDITOR_REQUIRED_PACKAGE_PATHS)), true);
  assert.throws(() => checker.assertSeedreamEditorPackagePaths(new Set()), (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_PACKAGE_CONTENT_MISSING");
});

test("owner Editor tools are default-off and the enabled stock SDK surface is exact", () => {
  assert.deepEqual(checker.assertSeedreamEditorToolNames([], false), { tool_count: 0 });
  assert.throws(() => checker.assertSeedreamEditorToolNames([{ name: names[0] }], false),
    (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_DEFAULT_OFF_FAILED");
  assert.deepEqual(checker.assertSeedreamEditorToolNames(names.map((name) => ({ name })), true), { tool_count: 7 });
  assert.throws(() => checker.assertSeedreamEditorToolNames([...names.map((name) => ({ name })), { name: names[0] }], true),
    (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_TOOL_SET_MISMATCH");
});

test("tool surface guard checks all seven closed schemas and the five model branches", () => {
  const required = [[], ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "original_handle", "content_base64", "filename", "mime_type"],
    ["link_attempt_id", "variant", "prompt", "parameters", "original_handle", "drawing_handle"],
    ["link_attempt_id", "recovery_id"], ["link_attempt_id"], ["link_attempt_id", "result_id", "offset"]];
  const tools = names.map((name, index) => ({ name, inputSchema: { type: "object", additionalProperties: false,
    properties: Object.fromEntries(required[index].map((key) => [key, {}])), required: required[index] },
    outputSchema: { type: "object", properties: {}, required: [], additionalProperties: false } }));
  tools[1].inputSchema = { anyOf: variants.map((variant) => ({ type: "object", additionalProperties: false,
    properties: { ...Object.fromEntries(required[1].map((key) => [key, {}])), variant: { const: variant } }, required: required[1] })) };
  tools[3].inputSchema.anyOf = variants.map((variant) => ({ type: "object", additionalProperties: false,
    properties: { ...Object.fromEntries(required[3].map((key) => [key, {}])), variant: { const: variant },
      parameters: { type: "object", additionalProperties: false, properties: { aspect_ratio: {}, resolution: {} }, required: ["aspect_ratio", "resolution"] } },
    required: required[3] }));
  tools[3].inputSchema.properties.variant = {};
  tools[3].inputSchema.properties.parameters = { type: "object", additionalProperties: false, properties: { aspect_ratio: {}, resolution: {} }, required: ["aspect_ratio", "resolution"] };
  tools[5].inputSchema.properties.limit = {}; tools[5].inputSchema.required = ["link_attempt_id"];
  tools[5].inputSchema.required = ["link_attempt_id"];
  tools[5].inputSchema.properties.limit = {};
  tools[6].inputSchema.properties.limit = {}; tools[6].inputSchema.required = ["link_attempt_id", "result_id", "offset"];
  tools[6].annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  assert.deepEqual(checker.assertSeedreamEditorToolSurface(tools, true), { tool_count: 7, closed_schemas: true, variants: 5 });
  tools[3].inputSchema.anyOf[4].properties.variant.const = "seedream-unknown";
  assert.throws(() => checker.assertSeedreamEditorToolSurface(tools, true), (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_VARIANT_SCHEMA_INVALID");
});

test("source and cost matrix independently covers 104 control pairs and 208 cost projections", () => {
  const source = { model_variants: variants, aspect_ratios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
    resolutions_by_variant: variantsResolutions, runtime_usable: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN" };
  const module = { getOwnerSeedreamEditorSourceParameters: () => source,
    normalizeOwnerSeedreamEditorParameters({ variant, parameters }) { if (!variantsResolutions[variant]?.includes(parameters.resolution) || !source.aspect_ratios.includes(parameters.aspect_ratio)) throw new Error("invalid"); return { variant, parameters }; },
    projectOwnerSeedreamEditorCostParameters({ variant, parameters, can_reset }) { return variant === "seedream-5.0-pro"
      ? { batch_size: can_reset ? 2 : 1, resolution: parameters.resolution } : {}; } };
  assert.deepEqual(checker.assertSeedreamEditorSourceMatrix(module), { variants: 5, parameter_pairs: 104, cost_cases: 208 });
});

test("public export and declaration guards reject private Editor capabilities", () => {
  const modules = { parameters: { getOwnerSeedreamEditorSourceParameters() {}, normalizeOwnerSeedreamEditorParameters() {}, projectOwnerSeedreamEditorCostParameters() {} },
    generationParameters: { normalizeOwnerSeedreamEditorGenerationParameters() {} }, generation: {}, tools: {} };
  const keys = [["parameters"], ["generationParameters"], ["tools"]];
  const api = Object.fromEntries(Object.entries(modules).flatMap(([group, value]) => Object.entries(value).map(([name, fn]) => [name, fn])));
  const toolExports = ["OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_NAMES", "OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_INPUT_SCHEMAS", "OWNER_SEEDREAM_EDITOR_IMAGE_TOOL_OUTPUT_SCHEMAS",
    "SYNTX_GET_SEEDREAM_EDITOR_IMAGE_PARAMETERS_TOOL_NAME", "SYNTX_UPLOAD_SEEDREAM_EDITOR_ORIGINAL_TOOL_NAME", "SYNTX_UPLOAD_SEEDREAM_EDITOR_DRAWING_TOOL_NAME",
    "SYNTX_OWNER_GENERATE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME", "SYNTX_OWNER_RECONCILE_SEEDREAM_EDITOR_IMAGE_TOOL_NAME",
    "SYNTX_OWNER_LIST_SEEDREAM_EDITOR_IMAGE_RECOVERIES_TOOL_NAME", "SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME", "registerSyntxOwnerSeedreamEditorImageTools"];
  for (const key of toolExports) modules.tools[key] = {};
  for (const key of toolExports) api[key] = modules.tools[key];
  assert.equal(checker.assertSeedreamEditorPublicExports(api, modules), true);
  assert.throws(() => checker.assertSeedreamEditorPublicExports({ ...api, OwnerSeedreamEditorImageOneShotPermit: {} }, modules),
    (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_PRIVATE_BARREL_EXPORT");
  assert.equal(checker.assertSeedreamEditorPublicDeclarations("OwnerSeedreamEditorVariant OwnerSeedreamEditorParameters OwnerSeedreamEditorCostParameters OwnerSeedreamEditorImageGenerateInput OwnerSeedreamEditorImageGenerationResult OwnerSeedreamEditorImageResultPage OwnerSeedreamEditorImageServiceComposition SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME"), true);
  assert.throws(() => checker.assertSeedreamEditorPublicDeclarations("OwnerSeedreamEditorVariant OwnerSeedreamEditorParameters OwnerSeedreamEditorCostParameters OwnerSeedreamEditorImageGenerateInput OwnerSeedreamEditorImageGenerationResult OwnerSeedreamEditorImageResultPage OwnerSeedreamEditorImageServiceComposition SYNTX_OWNER_GET_SEEDREAM_EDITOR_IMAGE_RESULT_PAGE_TOOL_NAME export interface OwnerSeedreamEditorImagePreparedCandidate"),
    (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_PRIVATE_DECLARATION_LEAK");
});

test("mandatory installed summary refuses to conflate local results with provider acceptance", () => {
  const proof = { status: "INSTALLED_STOCK_SDK_EDITOR_CALLTOOL_PASS", node_version: "24.21.0", sdk_version: "1.32.1", clean_installed_package: true,
    default_tools: 0, opt_in_tools: 7, variants_checked: 5, parameter_pairs_checked: 104, cost_cases_checked: 208, original_uploads: 12,
    drawing_uploads: 5, generation_posts: 12, ready_artifacts: 89, account_reads: 52, model_access_reads: 26, result_gets: 40,
    page_reads: 1, page_size: 64, page_observations: 80, page_get_post_delta: 0, partial_results: 1, unknown_model_echo: 1,
    unsafe_url_cases: 1, model_mismatch_cases: 1, expired_source_rejections: 1,
    source_catalog_version: "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
    source_settings_version: "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json",
    revoke_drain: "PASS", eof_drain: "PASS", auth_cleanup: "PASS", unknown_get_only: true, replay_posts: 0,
    default_stderr_bytes: 0, opt_in_stderr_bytes: 0, default_network_calls: 0, opt_in_network_calls: 0,
    authenticated_network_calls: 0, billing_calls: 0, revoke_drain: "PASS", eof_drain: "PASS", auth_cleanup: "PASS",
    default_child_close: "CLOSED", opt_in_child_close: "CLOSED", default_child_pid_null: true, opt_in_child_pid_null: true,
    backend_completion: "UNPROVEN", provider_acceptance: "UNPROVEN" };
  const output = checker.formatSeedreamEditorInstalledSummary(proof);
  for (const field of ["variants=5", "parameter_pairs=104", "cost_cases=208", "page_observations=80", "partial_results=1",
    "unknown_model_echo=1", "unsafe_url_cases=1", "model_mismatch_cases=1", "expired_source_rejections=1", "unknown_get_only=true",
    "replay_posts=0", "backend_completion=UNPROVEN", "provider_acceptance=UNPROVEN"]) assert.ok(output.includes(field));
  assert.throws(() => checker.formatSeedreamEditorInstalledSummary({ ...proof, replay_posts: 1 }),
    (error) => error.code === "INSTALLED_SEEDREAM_EDITOR_SUMMARY_INVALID");
});

test("package smoke wires the installed Editor helper and summary as a mandatory gate", async () => {
  const source = await readFile(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("assertInstalledSeedreamEditorFlow"), true);
  assert.equal(source.includes("formatSeedreamEditorInstalledSummary"), true);
  assert.equal(source.includes("${installedSeedreamEditorFlow}"), true);
});

test("Task1009 resolves the real SDK from an isolated consumer", async (t) => {
  const consumerPath = await mkdtemp(join(tmpdir(), "task1009-clean-consumer-"));
  t.after(() => rm(consumerPath, { recursive: true, force: true }));
  const consumerModules = join(consumerPath, "node_modules");
  await cp(join(PROJECT_ROOT, "node_modules"), consumerModules, { recursive: true });
  await writeFile(join(consumerPath, "package.json"), JSON.stringify({ private: true, dependencies: { "@modelcontextprotocol/sdk": "1.32.1" } }));
  const sdk = await checker.loadConsumerSdk(consumerPath);
  assert.equal(sdk.version, "1.32.1");
  assert.equal(typeof sdk.Client, "function");
  assert.equal(typeof sdk.StdioClientTransport, "function");
  assert.equal(typeof sdk.InMemoryTransport, "function");
});

test("Task995 isolated compiled runtime and stock SDK execute Editor callTool with exact counters", async (t) => {
  const isolatedRoot = await mkdtemp(join(tmpdir(), "task995-editor-calltool-"));
  process.stdout.write(`SEEDREAM_EDITOR_ISOLATED_ROOT=${isolatedRoot}\n`);
  t.after(() => rm(isolatedRoot, { recursive: true, force: true }));
  await symlink(join(PROJECT_ROOT, "node_modules"), join(isolatedRoot, "node_modules"), "dir");
  const compilerArgs = [join(PROJECT_ROOT, "node_modules/typescript/bin/tsc"), "--target", "ES2022", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--rootDir", PROJECT_ROOT, "--outDir", join(isolatedRoot, "dist"), "--strict",
    "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--noImplicitOverride", "--noFallthroughCasesInSwitch",
    "--noUnusedLocals", "--noUnusedParameters", "--esModuleInterop", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node",
    "src/runtime/observed-owner-runtime.ts", "src/mcp/server.ts", "src/transports/stdio-owner.ts",
    "src/application/owner-seedream-editor-parameters.ts"];
  await execFileAsync(BUNDLED_NODE, compilerArgs, { cwd: PROJECT_ROOT, maxBuffer: 8 * 1024 * 1024 });
  await copyFile(join(PROJECT_ROOT, "package.json"), join(isolatedRoot, "package.json"));
  await copyFile(join(PROJECT_ROOT, "package.json"), join(isolatedRoot, "dist/package.json"));
  await mkdir(join(isolatedRoot, "dist/catalog"), { recursive: true });
  await cp(join(PROJECT_ROOT, "catalog"), join(isolatedRoot, "dist/catalog"), { recursive: true });

  const consumerPath = await mkdtemp(join(tmpdir(), "task1011-clean-consumer-"));
  t.after(() => rm(consumerPath, { recursive: true, force: true }));
  await cp(join(PROJECT_ROOT, "node_modules"), join(consumerPath, "node_modules"), { recursive: true });
  await writeFile(join(consumerPath, "package.json"), JSON.stringify({ private: true, dependencies: { "@modelcontextprotocol/sdk": "1.32.1" } }));
  const sdk = await checker.loadConsumerSdk(consumerPath);
  assert.equal(sdk.version, "1.32.1");
  const load = (path) => import(pathToFileURL(join(isolatedRoot, `dist/src/${path}.js`)).href);
  const [runtime, server, stdio, parameters] = await Promise.all([
    load("runtime/observed-owner-runtime"), load("mcp/server"), load("transports/stdio-owner"),
    load("application/owner-seedream-editor-parameters")
  ]);
  const proof = await checker.runSeedreamEditorCallToolRegression({ runtime, server, stdio, parameters }, sdk);
  assert.equal(proof.status, "INSTALLED_STOCK_SDK_EDITOR_CALLTOOL_PASS");
  assert.deepEqual({ generation_posts: proof.generation_posts, original_uploads: proof.original_uploads, drawing_uploads: proof.drawing_uploads,
    ready_artifacts: proof.ready_artifacts, account_reads: proof.account_reads, model_access_reads: proof.model_access_reads, result_gets: proof.result_gets,
    page_reads: proof.page_reads, page_size: proof.page_size, page_observations: proof.page_observations, page_get_post_delta: proof.page_get_post_delta,
    unknown_get_only: proof.unknown_get_only, replay_posts: proof.replay_posts, partial_results: proof.partial_results,
    unknown_model_echo: proof.unknown_model_echo, unsafe_url_cases: proof.unsafe_url_cases, model_mismatch_cases: proof.model_mismatch_cases,
    expired_source_rejections: proof.expired_source_rejections },
  { generation_posts: 12, original_uploads: 12, drawing_uploads: 5, ready_artifacts: 89, account_reads: 52, model_access_reads: 26,
    result_gets: 40, page_reads: 1, page_size: 64, page_observations: 80, page_get_post_delta: 0, unknown_get_only: true, replay_posts: 0,
    partial_results: 1, unknown_model_echo: 1, unsafe_url_cases: 1, model_mismatch_cases: 1, expired_source_rejections: 1 });
  const matrix = checker.assertSeedreamEditorSourceMatrix(parameters);
  const defaultSurface = await checker.listInstalledTools(isolatedRoot, consumerPath, sdk, false);
  const optInSurface = await checker.listInstalledTools(isolatedRoot, consumerPath, sdk, true);
  const revokeDrain = await checker.runRevokeDrain({ runtime });
  const eofDrain = await checker.runEofDrain({ runtime, stdio });
  const installedProof = checker.composeSeedreamEditorInstalledProof({ runtimeProof: proof, matrix, off: defaultSurface, on: optInSurface,
    sdkVersion: sdk.version, nodeVersion: process.versions.node, revokeDrain, eofDrain });
  const summary = checker.formatSeedreamEditorInstalledSummary(installedProof);
  assert.ok(summary.includes("variants=5 parameter_pairs=104 cost_cases=208"));
  assert.ok(summary.includes("generation_posts=12 ready_artifacts=89 account_reads=52 model_access_reads=26 result_gets=40"));
  assert.ok(summary.includes("replay_posts=0 authenticated_network=0 billing=0"));
  assert.ok(summary.endsWith("backend_completion=UNPROVEN provider_acceptance=UNPROVEN"));
});
