import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pathToFileURL } from "node:url";

const checker = await import("../scripts/check-installed-banana-inpaint-flow.mjs").catch(() => null);

const REQUIRED_PROOF = Object.freeze({
  status: "INSTALLED_STOCK_SDK_CALL_TOOL_PASS",
  node_version: "24.21.0",
  sdk_version: "1.32.1",
  clean_installed_package: true,
  default_tools: 0,
  opt_in_tools: 7,
  variants_checked: 4,
  explicit_size_cases_checked: 9,
  original_uploads: 11,
  painted_composite_uploads: 11,
  auxiliary_uploads: 4,
  generation_posts: 11,
  ready_artifacts_returned: 98,
  account_endpoint_reads: 46,
  model_access_reads: 23,
  result_gets: 12,
  page_reads: 1,
  page_size: 64,
  page_observations: 80,
  page_get_post_delta: 0,
  auxiliary_formats_checked: 14,
  unknown_post_reconciled_get_only: true,
  replay_post_count: 0,
  foreign_attempt_post_count: 0,
  revoke_drain: "PASS",
  eof_drain: "PASS",
  auth_cleanup: "PASS",
  default_child_close: "CLOSED",
  opt_in_child_close: "CLOSED",
  default_child_pid_null: true,
  opt_in_child_pid_null: true,
  default_stderr_bytes: 0,
  opt_in_stderr_bytes: 0,
  default_network_calls: 0,
  opt_in_network_calls: 0,
  provider_acceptance: "UNPROVEN"
});

test("installed flow checker exports package, surface, barrel, and closed-summary guards", () => {
  assert.ok(checker, "MISSING_INSTALLED_BANANA_INPAINT_FLOW_CHECKER");
  for (const name of ["assertBananaInpaintPackagePaths", "assertBananaInpaintToolNames", "assertBananaInpaintToolSurface",
    "assertBananaInpaintPublicExports", "assertBananaInpaintLocalSchemas", "formatBananaInpaintInstalledSummary", "assertInstalledBananaInpaintFlow"]) {
    assert.equal(typeof checker[name], "function", `MISSING_${name.toUpperCase()}`);
  }
});

test("deadline watchdog keeps a child alive long enough to fail closed", () => {
  const checkerUrl = pathToFileURL(`${process.cwd()}/scripts/check-installed-banana-inpaint-flow.mjs`).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", [
    `import { deadline } from ${JSON.stringify(checkerUrl)};`,
    "try { await deadline(new Promise(() => {}), 40, 'SYNTHETIC_DEADLINE'); process.exitCode = 2; }",
    "catch (error) { console.log(error.code); }"
  ].join("\n")], { cwd: process.cwd(), encoding: "utf8", timeout: 3_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "SYNTHETIC_DEADLINE");
});

test("package smoke CLI awaits its main runner instead of returning success early", () => {
  const packageSmokeUrl = pathToFileURL(`${process.cwd()}/scripts/check-package-install.mjs`).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", [
    `import { runPackageSmokeCli } from ${JSON.stringify(packageSmokeUrl)};`,
    "await runPackageSmokeCli(() => new Promise(() => {}));"
  ].join("\n")], { cwd: process.cwd(), encoding: "utf8", timeout: 3_000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 13, `expected Node's unsettled top-level-await exit, got ${result.status}: ${result.stderr}`);
});

test("clean-package path guard requires the compiled 908-to-925 path and archive pair", () => {
  assert.ok(checker, "MISSING_INSTALLED_BANANA_INPAINT_FLOW_CHECKER");
  const paths = new Set(checker.BANANA_INPAINT_REQUIRED_PACKAGE_PATHS);
  assert.equal(checker.assertBananaInpaintPackagePaths(paths), true);
  for (const missing of [
    "dist/src/application/owner-banana-inpaint-image-request-preparer.js",
    "dist/src/application/owner-banana-inpaint-image-one-shot-policy.d.ts",
    "dist/src/application/owner-banana-inpaint-image-generation-service.js",
    "dist/src/mcp/owner-banana-inpaint-image-tools.d.ts",
    "dist/src/transports/stdio-owner.js",
    "catalog/settings/v2/sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json"
  ]) {
    const incomplete = new Set(paths);
    incomplete.delete(missing);
    assert.throws(() => checker.assertBananaInpaintPackagePaths(incomplete),
      (error) => error.code === "INSTALLED_BANANA_INPAINT_PACKAGE_CONTENT_MISSING", missing);
  }
});

test("installed tool surface is default-off and requires the exact seven closed tools when enabled", () => {
  assert.ok(checker, "MISSING_INSTALLED_BANANA_INPAINT_FLOW_CHECKER");
  assert.deepEqual(checker.assertBananaInpaintToolNames([], false), { tool_count: 0 });
  const names = [
    "syntx_upload_banana_inpaint_original",
    "syntx_upload_banana_inpaint_painted_composite",
    "syntx_upload_banana_inpaint_auxiliary_reference",
    "syntx_owner_generate_banana_inpaint_image",
    "syntx_owner_reconcile_banana_inpaint_image",
    "syntx_owner_list_banana_inpaint_image_recoveries",
    "syntx_owner_get_banana_inpaint_image_result_page"
  ];
  assert.deepEqual(checker.assertBananaInpaintToolNames(names.map((name) => ({ name })), true), { tool_count: 7 });
  assert.throws(() => checker.assertBananaInpaintToolNames([...names.map((name) => ({ name })), { name: names[0] }], true),
    (error) => error.code === "INSTALLED_BANANA_INPAINT_TOOL_SET_MISMATCH");
  assert.throws(() => checker.assertBananaInpaintToolNames([{ name: names[0] }], false),
    (error) => error.code === "INSTALLED_BANANA_INPAINT_DEFAULT_OFF_FAILED");
});

test("public barrel guard permits stable intent/service APIs but rejects private capability and resolver exports", () => {
  assert.ok(checker, "MISSING_INSTALLED_BANANA_INPAINT_FLOW_CHECKER");
  const moduleBindings = {
    source: { OWNER_BANANA_INPAINT_IMAGE_VARIANTS: ["banana", "banana2", "banana3", "banana3_light"], normalizeOwnerBananaInpaintPrompt() {} },
    parameters: { getOwnerBananaInpaintSourceParameters() {}, normalizeOwnerBananaInpaintParameters() {}, projectOwnerBananaInpaintCostParameters() {} },
    generation: { createOwnerBananaInpaintImageGenerationService() {}, isOwnerBananaInpaintImageGenerationService() {} },
    tools: { OWNER_BANANA_INPAINT_IMAGE_TOOL_NAMES: [], OWNER_BANANA_INPAINT_IMAGE_TOOL_INPUT_SCHEMAS: {},
      OWNER_BANANA_INPAINT_IMAGE_TOOL_OUTPUT_SCHEMAS: {}, SYNTX_UPLOAD_BANANA_INPAINT_ORIGINAL_TOOL_NAME: "",
      SYNTX_UPLOAD_BANANA_INPAINT_PAINTED_COMPOSITE_TOOL_NAME: "", SYNTX_UPLOAD_BANANA_INPAINT_AUXILIARY_REFERENCE_TOOL_NAME: "",
      SYNTX_OWNER_GENERATE_BANANA_INPAINT_IMAGE_TOOL_NAME: "", SYNTX_OWNER_RECONCILE_BANANA_INPAINT_IMAGE_TOOL_NAME: "",
      SYNTX_OWNER_LIST_BANANA_INPAINT_IMAGE_RECOVERIES_TOOL_NAME: "", SYNTX_OWNER_GET_BANANA_INPAINT_IMAGE_RESULT_PAGE_TOOL_NAME: "",
      registerSyntxOwnerBananaInpaintImageTools() {} }
  };
  const safeApi = Object.fromEntries(Object.entries(moduleBindings).flatMap(([, module]) => Object.entries(module)));
  assert.equal(checker.assertBananaInpaintPublicExports(safeApi, moduleBindings), true);
  assert.throws(() => checker.assertBananaInpaintPublicExports({ ...safeApi, OwnerBananaInpaintImagePreparedCandidate: {} }, moduleBindings),
    (error) => error.code === "INSTALLED_BANANA_INPAINT_PRIVATE_BARREL_EXPORT");
  assert.throws(() => checker.assertBananaInpaintPublicExports({ ...safeApi, getOwnerBananaInpaintImagePrivateRequest() {} }, moduleBindings),
    (error) => error.code === "INSTALLED_BANANA_INPAINT_PRIVATE_BARREL_EXPORT");
});

test("public export guard uses the real compiled service module ABI", async () => {
  assert.ok(checker, "MISSING_INSTALLED_BANANA_INPAINT_FLOW_CHECKER");
  const [api, source, parameters, generation, tools] = await Promise.all([
    import("../dist/src/index.js"),
    import("../dist/src/application/owner-banana-inpaint-image-source-profile.js"),
    import("../dist/src/application/owner-banana-inpaint-parameters.js"),
    import("../dist/src/application/owner-banana-inpaint-image-generation-service.js"),
    import("../dist/src/mcp/owner-banana-inpaint-image-tools.js")
  ]);
  const modules = { source, parameters, generation, tools };

  assert.equal("OwnerBananaInpaintImageGenerationService" in generation, false,
    "service interface must remain a type-only declaration, not a runtime class");
  assert.equal("OwnerBananaInpaintImageGenerationService" in api, false);
  const declarationText = await readFile(new URL("../dist/src/index.d.ts", import.meta.url), "utf8");
  assert.match(declarationText, /OwnerBananaInpaintImageGenerationService\b/u);
  assert.equal(checker.assertBananaInpaintPublicDeclarations(declarationText), true);
  assert.equal(checker.assertBananaInpaintPublicExports(api, modules), true);
});

test("summary formatter requires every numeric installed-flow counter and privacy boundary", () => {
  assert.ok(checker, "MISSING_INSTALLED_BANANA_INPAINT_FLOW_CHECKER");
  const formatted = checker.formatBananaInpaintInstalledSummary(REQUIRED_PROOF);
  for (const field of ["variants=4", "size_cases=9", "generation_posts=11", "account_reads=46", "model_access_reads=23",
    "artifacts=98", "page_reads=1", "page_size=64", "page_observations=80", "auxiliary_formats_checked=14", "unknown_get_only=true", "replay_posts=0", "foreign_attempt_posts=0", "auth_cleanup=PASS",
    "provider_acceptance=UNPROVEN"]) assert.ok(formatted.includes(field), `missing summary field: ${field}`);
  for (const key of ["generation_posts", "account_endpoint_reads", "model_access_reads", "ready_artifacts_returned", "page_reads", "auxiliary_formats_checked", "default_network_calls"]) {
    const incomplete = { ...REQUIRED_PROOF };
    delete incomplete[key];
    assert.throws(() => checker.formatBananaInpaintInstalledSummary(incomplete),
      (error) => error.code === "INSTALLED_BANANA_INPAINT_SUMMARY_INVALID", `missing ${key}`);
  }
  assert.throws(() => checker.formatBananaInpaintInstalledSummary({ ...REQUIRED_PROOF, generation_posts: undefined }),
    (error) => error.code === "INSTALLED_BANANA_INPAINT_SUMMARY_INVALID");
});
