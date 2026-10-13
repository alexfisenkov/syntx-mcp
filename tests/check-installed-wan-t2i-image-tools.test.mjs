import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod/v4";
import * as parameters from "../dist/src/application/owner-wan-t2i-parameters.js";
import * as sourceProfile from "../dist/src/application/owner-wan-t2i-source-profile.js";
import * as cost from "../dist/src/application/owner-wan-t2i-cost-parameters.js";
import * as generation from "../dist/src/application/owner-wan-t2i-generation-service.js";
import * as toolsModule from "../dist/src/mcp/owner-wan-t2i-tools.js";
import * as serverModule from "../dist/src/mcp/server.js";
import * as runtimeModule from "../dist/src/runtime/observed-owner-runtime.js";
import { DiscoveryCatalogRepository } from "../dist/src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../dist/src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../dist/src/catalog/syntx-public-catalog.js";

const checkerUrl = new URL("../scripts/check-installed-wan-t2i-image-tools.mjs", import.meta.url).href;
const checkerModule = await import(checkerUrl).catch(() => null);
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const MODEL_IDS = ["wan_25_t2i_preview", "wan_26_t2i"];
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const RESOLUTIONS = ["720P", "1080P"];
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));

test("installed WAN source contract binds both selected e551 rows and exact batch-only cost projection", () => {
  assert.ok(checkerModule?.assertWanT2iSourceContract, "MISSING_WAN_T2I_INSTALLED_SOURCE_CONTRACT_CHECK");
  const result = checkerModule.assertWanT2iSourceContract(parameters, sourceProfile, cost, CATALOG, VERSION);
  assert.deepEqual(result, { models_checked: 2, parameter_cases_checked: 80, prompt_boundaries_checked: 4,
    cost_inputs_checked: 80, source_execution_claimed: false, provider_acceptance_claimed: false });
  const driftedProfiles = { ...sourceProfile, getOwnerWanT2iSourceProfile(model, catalog, version) {
    const profile = sourceProfile.getOwnerWanT2iSourceProfile(model, catalog, version);
    return model === "wan_26_t2i" ? { ...profile, source_binding: { ...profile.source_binding,
      public_catalog_raw_model_row_schema_hash: `sha256:${"0".repeat(64)}` } } : profile;
  } };
  assert.throws(() => checkerModule.assertWanT2iSourceContract(parameters, driftedProfiles, cost, CATALOG, VERSION),
    (error) => error.code === "INSTALLED_WAN_T2I_SOURCE_PROFILE_INVALID");
  const widenedCost = { ...cost, projectOwnerWanT2iCostParameters(input) {
    return { ...cost.projectOwnerWanT2iCostParameters(input), cost_inputs: { ...cost.projectOwnerWanT2iCostParameters(input).cost_inputs,
      size: "720P" } };
  } };
  assert.throws(() => checkerModule.assertWanT2iSourceContract(parameters, sourceProfile, widenedCost, CATALOG, VERSION),
    (error) => error.code === "INSTALLED_WAN_T2I_SOURCE_MATRIX_INVALID");
});

test("installed WAN strict MCP surface preserves the full root object and three actual tool annotations", () => {
  assert.ok(checkerModule?.assertWanT2iToolSurface, "MISSING_WAN_T2I_INSTALLED_TOOL_SURFACE_CHECK");
  const input = toolsModule.OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS;
  const output = toolsModule.OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS;
  const names = toolsModule.OWNER_WAN_T2I_TOOL_NAMES;
  const keys = ["generate", "reconcile", "list_recoveries"];
  const titles = ["Generate WAN T2I image", "Reconcile WAN T2I generation", "List WAN T2I recoveries"];
  const annotations = [
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  ];
  const descriptions = [
    "Starts one explicit source-shaped WAN T2I request after fresh account and model-access preflights. Partial observations must be reconciled; never repeat an unknown POST.",
    "GET-only reconciliation for the exact linked attempt and process-local recovery ID; it never starts another generation.",
    "Lists bounded process-local recovery diagnostics for the exact linked attempt without prompt or artifact data."
  ];
  const tools = names.map((name, index) => ({ name, title: titles[index], description: descriptions[index], inputSchema: z.toJSONSchema(input[keys[index]]),
    outputSchema: z.toJSONSchema(output[keys[index]]), annotations: annotations[index] }));
  const result = checkerModule.assertWanT2iToolSurface(tools, true, {
    phases: generation.OWNER_WAN_T2I_GENERATION_PHASES,
    errorCodes: generation.OWNER_WAN_T2I_GENERATION_ERROR_CODES,
    historyReasons: generation.OWNER_WAN_T2I_GENERATION_HISTORY_REASONS,
    resultReasons: generation.OWNER_WAN_T2I_GENERATION_RESULT_REASONS
  }, { tools: toolsModule });
  assert.deepEqual(result, { tool_count: 3, parameter_cases_checked: 80, schemas_strict: true });
  const widened = structuredClone(tools);
  widened[0].inputSchema.properties.parameters.properties.batch_size.anyOf.push({ type: "number", const: 5 });
  assert.throws(() => checkerModule.assertWanT2iToolSurface(widened, true, {
    phases: generation.OWNER_WAN_T2I_GENERATION_PHASES,
    errorCodes: generation.OWNER_WAN_T2I_GENERATION_ERROR_CODES,
    historyReasons: generation.OWNER_WAN_T2I_GENERATION_HISTORY_REASONS,
    resultReasons: generation.OWNER_WAN_T2I_GENERATION_RESULT_REASONS
  }, { tools: toolsModule }), (error) => error.code === "INSTALLED_WAN_T2I_PARAMETER_SCHEMA_INVALID");
});

test("installed WAN checker rejects omitted package declarations and unsafe public candidate exports", () => {
  assert.ok(checkerModule?.assertWanT2iNativePackagePaths && checkerModule?.assertWanT2iPublicExports,
    "MISSING_WAN_T2I_INSTALLED_BOUNDARY_CHECKS");
  const requiredModules = ["application/owner-wan-t2i-parameters", "application/owner-wan-t2i-source-profile",
    "application/owner-wan-t2i-cost-parameters", "application/owner-wan-t2i-generation-service",
    "application/owner-wan-t2i-request-preparer", "application/owner-wan-t2i-one-shot-policy",
    "application/owner-wan-t2i-history-binding", "adapter/syntx/owner-wan-t2i-result", "adapter/syntx/chat-http-client",
    "adapter/syntx/http-client", "mcp/owner-wan-t2i-tools", "mcp/server", "runtime/observed-owner-runtime",
    "transports/stdio-owner", "catalog/selected-discovery-catalog", "catalog/discovery-catalog",
    "catalog/syntx-public-catalog", "domain/generation-contract"];
  const paths = new Set(["dist/src/index.js", "dist/src/index.d.ts", ...requiredModules.flatMap((item) =>
    [`dist/src/${item}.js`, `dist/src/${item}.d.ts`])]);
  assert.equal(checkerModule.assertWanT2iNativePackagePaths(paths), true);
  paths.delete("dist/src/application/owner-wan-t2i-generation-service.d.ts");
  assert.throws(() => checkerModule.assertWanT2iNativePackagePaths(paths), (error) => error.code === "INSTALLED_WAN_T2I_PACKAGE_CONTENT_MISSING");
  const modules = { parameters, sourceProfile, cost, generation, tools: toolsModule, server: serverModule,
    runtime: runtimeModule, stdio: {}, client: {}, result: {} };
  const safeNames = ["OWNER_WAN_T2I_MODELS", "getOwnerWanT2iSourceParameters", "normalizeOwnerWanT2iParameters",
    "OwnerWanT2iParametersError", "getOwnerWanT2iSourceProfile", "OwnerWanT2iSourceProfileError",
    "projectOwnerWanT2iCostParameters", "OwnerWanT2iGenerationService", "OwnerWanT2iGenerationServiceError",
    "OWNER_WAN_T2I_GENERATION_PHASES", "OWNER_WAN_T2I_GENERATION_ERROR_CODES", "OWNER_WAN_T2I_GENERATION_HISTORY_REASONS",
    "OWNER_WAN_T2I_GENERATION_RESULT_REASONS", "OWNER_WAN_T2I_TOOL_NAMES", "OWNER_WAN_T2I_TOOL_INPUT_SCHEMAS",
    "OWNER_WAN_T2I_TOOL_OUTPUT_SCHEMAS", "registerSyntxOwnerWanT2iTools"];
  const api = Object.fromEntries(safeNames.map((name) => [name,
    modules.parameters[name] ?? modules.sourceProfile[name] ?? modules.cost[name] ?? modules.generation[name] ?? modules.tools[name]]));
  api.createMcpServer = serverModule.createMcpServer;
  api.createObservedOwnerRuntime = runtimeModule.createObservedOwnerRuntime;
  assert.equal(checkerModule.assertWanT2iPublicExports(api, modules), true);
  assert.throws(() => checkerModule.assertWanT2iPublicExports({ ...api, OwnerWanT2iPreparedCandidate: {} }, modules),
    (error) => error.code === "INSTALLED_WAN_T2I_PRIVATE_EXPORT_LEAK");
  const declarationTypes = ["OwnerWanT2iModel", "OwnerWanT2iParametersInput", "OwnerWanT2iParameters", "OwnerWanT2iNormalizedParameters",
    "OwnerWanT2iSourceParameters", "OwnerWanT2iSourceProfile", "OwnerWanT2iCostParameters", "OwnerWanT2iGenerationServiceOptions",
    "OwnerWanT2iGenerateInput", "OwnerWanT2iReconcileInput", "OwnerWanT2iRecoveryListInput", "OwnerWanT2iGenerationResult",
    "OwnerWanT2iGenerationDiagnostic", "OwnerWanT2iRecoveryListItem", "OwnerWanT2iGenerationServiceErrorCode",
    "OwnerWanT2iImageServiceComposition", "RegisterSyntxOwnerWanT2iToolsOptions"];
  assert.equal(checkerModule.assertWanT2iDeclarations(`${declarationTypes.join(" ")}`), true);
  assert.throws(() => checkerModule.assertWanT2iDeclarations(`${declarationTypes.join(" ")} export type { OwnerWanT2iPreparedCandidate }`),
    (error) => error.code === "INSTALLED_WAN_T2I_PRIVATE_DECLARATION_LEAK");
});

test("installed checker in-process positive executes one actual SDK generation on a synthetic backend", async () => {
  const modules = { parameters, sourceProfile, cost, generation,
    preparer: await import("../dist/src/application/owner-wan-t2i-request-preparer.js"),
    permit: await import("../dist/src/application/owner-wan-t2i-one-shot-policy.js"),
    history: await import("../dist/src/application/owner-wan-t2i-history-binding.js"),
    result: await import("../dist/src/adapter/syntx/owner-wan-t2i-result.js"),
    client: await import("../dist/src/adapter/syntx/chat-http-client.js"),
    tools: toolsModule, server: serverModule, runtime: runtimeModule,
    catalog: await import("../dist/src/catalog/selected-discovery-catalog.js") };
  assert.deepEqual(await checkerModule.assertWanT2iSyntheticRuntimeCall(modules, process.cwd(), VERSION),
    { preflight_reads: 4, model_access_reads: 2, generation_posts: 1 });
});

test("WAN synthetic installed call keeps a future subscription fixture and rejects an expired fixture", async () => {
  const modules = { parameters, sourceProfile, cost, generation,
    preparer: await import("../dist/src/application/owner-wan-t2i-request-preparer.js"),
    permit: await import("../dist/src/application/owner-wan-t2i-one-shot-policy.js"),
    history: await import("../dist/src/application/owner-wan-t2i-history-binding.js"),
    result: await import("../dist/src/adapter/syntx/owner-wan-t2i-result.js"),
    client: await import("../dist/src/adapter/syntx/chat-http-client.js"),
    tools: toolsModule, server: serverModule, runtime: runtimeModule,
    catalog: await import("../dist/src/catalog/selected-discovery-catalog.js") };
  const nowMs = Date.parse("2026-10-12T12:00:00.000Z");
  await assert.rejects(checkerModule.assertWanT2iSyntheticRuntimeCall(modules, process.cwd(), VERSION, {
    nowMs, subscriptionEndDate: "2026-10-12T00:00:00.000Z"
  }), (error) => error.code === "INSTALLED_WAN_T2I_SYNTHETIC_RUNTIME_CALL_INVALID");
  assert.deepEqual(await checkerModule.assertWanT2iSyntheticRuntimeCall(modules, process.cwd(), VERSION, { nowMs }),
    { preflight_reads: 4, model_access_reads: 2, generation_posts: 1 });
});
