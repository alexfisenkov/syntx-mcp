#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODEL_ID = "ray-3.14";
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const TOOL_NAMES = Object.freeze([
  "syntx_owner_generate_luma_t2v",
  "syntx_owner_reconcile_luma_t2v",
  "syntx_owner_list_luma_t2v_recoveries"
]);
const PROJECT_ROOT = realpath(fileURLToPath(new URL("../", import.meta.url)));

export class LumaT2vFlowInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "LumaT2vFlowInstalledCheckError"; this.code = code; }
}

export async function assertInstalledLumaT2vFlow(installedPackagePath, consumerPath, packagedPaths, options = {}) {
  let runtime;
  let server;
  let client;
  let attemptId;
  let failureCode;
  let proof;
  let authStoreCloseReturnedVoid = false;
  const packageProvenance = options.package_provenance ?? "npm-packed-installed";
  const cleanup = { unlink_confirmed: null, luma_lifecycle_closed: null,
    client_closed: null, server_closed: null, auth_store_closed: null };
  try {
    if (process.versions.node !== "24.21.0") fail("INSTALLED_LUMA_T2V_NODE24_21_REQUIRED");
    if (!isAbsolute(installedPackagePath) || !isAbsolute(consumerPath) || !(packagedPaths instanceof Set)) {
      fail("INSTALLED_LUMA_T2V_ARGUMENTS_INVALID");
    }
    if (!new Set(["npm-packed-installed", "isolated-compiled-copy"]).has(packageProvenance)) {
      fail("INSTALLED_LUMA_T2V_PACKAGE_PROVENANCE_INVALID");
    }
    const installedRoot = await realpath(installedPackagePath);
    if (isWithin(await PROJECT_ROOT, installedRoot)) fail("INSTALLED_LUMA_T2V_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    if (manifest.name !== "syntx-mcp") fail("INSTALLED_LUMA_T2V_NOT_CLEAN_PACKAGE");

    const importPacked = (name) => import(pathToFileURL(join(installedRoot, `dist/src/${name}.js`)).href);
    const [parameters, serviceModule, toolsModule, runtimeModule, serverModule] = await Promise.all([
      importPacked("application/owner-luma-t2v-generation-parameters"),
      importPacked("application/owner-luma-t2v-contract-service"),
      importPacked("mcp/owner-luma-t2v-tool"),
      importPacked("runtime/observed-owner-runtime"),
      importPacked("mcp/server")
    ]);
    const registryVersion = serviceModule.OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION;
    if (typeof registryVersion !== "string" || !/^sha256-[a-f0-9]{64}\.json$/u.test(registryVersion)) {
      fail("INSTALLED_LUMA_T2V_REGISTRY_VERSION_INVALID");
    }
    const requiredPaths = [
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js",
      "dist/src/application/owner-luma-t2v-generation-parameters.js",
      "dist/src/application/owner-luma-t2v-contract-service.js",
      "dist/src/mcp/owner-luma-t2v-tool.js", "dist/src/mcp/server.js",
      "dist/src/runtime/observed-owner-runtime.js",
      `catalog/public/${CATALOG_VERSION}`, `catalog/settings/v2/${SETTINGS_VERSION}`,
      `catalog/generation-contracts-v2/${registryVersion}`
    ];
    if (requiredPaths.some((path) => !packagedPaths.has(path))) fail("INSTALLED_LUMA_T2V_PACKAGE_CONTENT_MISSING");

    const source = parameters.getOwnerLumaT2vGenerationParametersSource();
    if (source.runtime_usable !== false || source.dispatch_allowed !== false || source.backend_acceptance !== "UNPROVEN" ||
        source.effective_defaults !== "UNKNOWN" || source.models?.length !== 1 || source.models[0]?.model_id !== MODEL_ID ||
        source.source_pins?.public_catalog_version !== CATALOG_VERSION ||
        source.source_pins?.settings_inventory_version !== SETTINGS_VERSION ||
        !sameArray(source.controls?.quality?.values, ["360p", "540p", "720p", "1080p"]) ||
        !sameArray(source.controls?.aspect_ratio?.values, ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"]) ||
        !sameArray(source.controls?.video_duration?.values, [5, 10]) || source.ui_observation?.combination_count !== 48 ||
        source.ui_observation?.controls_enumerated_independently !== true ||
        source.ui_observation?.count_method !== "CARTESIAN_PRODUCT_DERIVED_FROM_INDEPENDENT_ENUMS") {
      fail("INSTALLED_LUMA_T2V_SOURCE_CONTRACT_INVALID");
    }
    if (typeof runtimeModule.createObservedOwnerRuntime !== "function" ||
        typeof serverModule.createMcpServer !== "function" ||
        typeof serviceModule.OwnerLumaT2vContractService !== "function" ||
        typeof toolsModule.registerSyntxOwnerLumaT2vTools !== "function") {
      fail("INSTALLED_LUMA_T2V_RUNTIME_ABI_MISSING");
    }

    const sdk = await loadConsumerSdk(consumerPath);
    const counters = { fetch_calls: 0, chats: 0, generation_posts: 0, history_gets: 0, result_gets: 0,
      balance_reads: 0, subscription_reads: 0, model_access_reads: 0, billing_calls: 0, unexpected_routes: 0 };
    const callBodies = [];
    const syntheticPrompt = "Installed synthetic Luma test: a white paper boat on a quiet pond.";
    const fetchImpl = async (input, init = {}) => {
      counters.fetch_calls += 1;
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_LUMA_T2V_SYNTHETIC_ORIGIN_INVALID");
      if (url.pathname === "/api/v1/user/balance" && method === "GET") {
        counters.balance_reads += 1;
        return Response.json({ balance: "1000" });
      }
      if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
        counters.subscription_reads += 1;
        return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
      }
      if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
        counters.model_access_reads += 1;
        if (url.searchParams.get("ai_name") !== "luma" || url.searchParams.get("model_type") !== MODEL_ID ||
            url.searchParams.get("quality") !== "360p" || url.searchParams.get("video_duration") !== "5") {
          fail("INSTALLED_LUMA_T2V_MODEL_ACCESS_QUERY_INVALID");
        }
        return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
          limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        counters.chats += 1;
        const body = parseBody(init.body, "INSTALLED_LUMA_T2V_CHAT_BODY_INVALID");
        if (!sameKeys(body, ["scope", "title"]) || body.scope !== "video" || typeof body.title !== "string") {
          fail("INSTALLED_LUMA_T2V_CHAT_BODY_INVALID");
        }
        return Response.json({ uuid: `luma-installed-chat-${counters.chats}` });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        counters.generation_posts += 1;
        const body = parseBody(init.body, "INSTALLED_LUMA_T2V_GENERATION_BODY_INVALID");
        const settings = body.settings;
        if (url.search !== "?ai_name=luma" || !sameKeys(body, ["chat_id", "prompt", "settings"]) ||
            body.chat_id !== "luma-installed-chat-1" || body.prompt !== syntheticPrompt ||
            !sameKeys(settings, ["model_type", "video_duration", "quality", "aspect_ratio", "gen_type", "file_urls"]) ||
            settings.model_type !== MODEL_ID || settings.video_duration !== 5 || settings.quality !== "360p" ||
            settings.aspect_ratio !== "16:9" || settings.gen_type !== "text2video" ||
            !Array.isArray(settings.file_urls) || settings.file_urls.length !== 0) {
          fail("INSTALLED_LUMA_T2V_GENERATION_WIRE_INVALID");
        }
        callBodies.push(body);
        return Response.json({ id: "luma-installed-echo-1" });
      }
      const history = /^\/api\/v1\/chats\/(luma-installed-chat-\d+)\/messages$/u.exec(url.pathname);
      if (history && method === "GET") {
        counters.history_gets += 1;
        if (url.search !== "?page=1&page_size=10") fail("INSTALLED_LUMA_T2V_HISTORY_QUERY_INVALID");
        return Response.json({ messages: [
          { id: "luma-installed-echo-1", chat_id: 9001, author_id: 42, message_object: [
            { id: "luma-installed-echo-object", message_id: "luma-installed-echo-1", object_type: "text", model_type: MODEL_ID }
          ] },
          { id: "luma-installed-result-1", chat_id: 9001, author_id: -1, message_object: [
            { id: "luma-installed-video-object-1", message_id: "luma-installed-result-1", object_type: "video", model_type: MODEL_ID }
          ] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const inProgress = /^\/api\/v1\/chats\/(luma-installed-chat-\d+)\/inprogress$/u.exec(url.pathname);
      if (inProgress && method === "GET") {
        counters.history_gets += 1;
        return Response.json([{ message_id: "luma-installed-result-1", message_object_id: null,
          object_type: "video", model_type: MODEL_ID }]);
      }
      const message = /^\/api\/v1\/chats\/(luma-installed-chat-\d+)\/(luma-installed-(?:echo|result)-\d+)$/u.exec(url.pathname);
      if (message && method === "GET") {
        counters.result_gets += 1;
        const messageId = message[2];
        if (messageId === "luma-installed-echo-1") {
          return Response.json({ id: messageId, chat_id: 9001, author_id: 42, message_object: [
            { id: "luma-installed-echo-object", message_id: messageId, object_type: "text", model_type: MODEL_ID }
          ] });
        }
        return Response.json({ id: messageId, chat_id: 9001, author_id: -1, message_object: [
          { id: "luma-installed-video-object-1", message_id: messageId, object_type: "video", model_type: MODEL_ID,
            object_url: "https://r2.syntx.ai/installed/luma-t2v-result.mp4", completed: true }
        ] });
      }
      if (/billing|payment/iu.test(url.pathname)) {
        counters.billing_calls += 1;
        fail("INSTALLED_LUMA_T2V_BILLING_ROUTE_FORBIDDEN");
      }
      counters.unexpected_routes += 1;
      fail("INSTALLED_LUMA_T2V_SYNTHETIC_ROUTE_UNEXPECTED");
    };

    const fixedNow = Date.parse("2026-10-13T03:00:00.000Z");
    runtime = runtimeModule.createObservedOwnerRuntime({ ownerLumaT2vEnabled: true, fetchImpl,
      now: () => fixedNow, requestTimeoutMs: 2_000 });
    const composition = runtime.serverOptions.ownerLumaT2v;
    if (!composition?.generationService) fail("INSTALLED_LUMA_T2V_OPT_IN_COMPOSITION_MISSING");
    server = serverModule.createMcpServer(runtime.application, runtime.serverOptions);
    const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
    client = new sdk.Client({ name: "luma-t2v-installed-synthetic", version: "1.0.0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map(({ name }) => name);
    if (TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
      fail("INSTALLED_LUMA_T2V_TOOL_LIST_INVALID");
    }
    const schemas = new Map(listed.tools.filter(({ name }) => TOOL_NAMES.includes(name)).map(({ name, inputSchema }) => [name, inputSchema]));
    assertInputSchema(schemas.get(TOOL_NAMES[0]), ["link_attempt_id", "prompt", "quality", "aspect_ratio", "video_duration"]);
    assertInputSchema(schemas.get(TOOL_NAMES[1]), ["link_attempt_id", "recovery_id"]);
    assertInputSchema(schemas.get(TOOL_NAMES[2]), ["link_attempt_id"], ["limit"]);
    const generateProperties = schemas.get(TOOL_NAMES[0])?.properties;
    const durationValues = Array.isArray(generateProperties?.video_duration?.enum)
      ? generateProperties.video_duration.enum
      : Array.isArray(generateProperties?.video_duration?.anyOf)
        ? generateProperties.video_duration.anyOf.map(({ const: value }) => value)
        : undefined;
    if (!sameArray(generateProperties?.quality?.enum, ["360p", "540p", "720p", "1080p"]) ||
        !sameArray(generateProperties?.aspect_ratio?.enum, ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"]) ||
        !sameArray(durationValues, [5, 10]) ||
        generateProperties?.prompt?.maxLength !== 5000) fail("INSTALLED_LUMA_T2V_PARAMETER_SCHEMA_INVALID");
    if (counters.fetch_calls !== 0) fail("INSTALLED_LUMA_T2V_STARTUP_NETWORK_ACCESS");

    attemptId = "link_luma_installed_smoke_012345678901";
    await linkSyntheticAttempt(runtime, attemptId, fixedNow);
    const generated = await client.callTool({ name: TOOL_NAMES[0], arguments: {
      link_attempt_id: attemptId, prompt: syntheticPrompt, quality: "360p", aspect_ratio: "16:9", video_duration: 5
    } }, undefined, { timeout: 8_000, maxTotalTimeout: 8_000 });
    const result = generated?.structuredContent;
    if (generated?.isError === true) fail(`INSTALLED_LUMA_T2V_GENERATE_TOOL_ERROR_${safeCode(parseCallToolResult(generated))}` +
      `_C${counters.chats}_P${counters.generation_posts}_H${counters.history_gets}_R${counters.result_gets}_A${counters.subscription_reads}_M${counters.model_access_reads}_U${counters.unexpected_routes}`);
    if (result?.status !== "reviewed") fail("INSTALLED_LUMA_T2V_RESULT_STATUS_INVALID");
    if (result?.confidence_scope !== "exact_result_only" || result?.variant_id !== serviceModule.OWNER_LUMA_T2V_CONTRACT_VARIANT_ID) {
      fail("INSTALLED_LUMA_T2V_RESULT_BINDING_INVALID");
    }
    if (!Array.isArray(result?.artifacts) || result.artifacts.length !== 1 || result.artifacts[0]?.mime_type !== "video/mp4") {
      fail("INSTALLED_LUMA_T2V_RESULT_ARTIFACT_INVALID");
    }
    if (counters.chats !== 1 || counters.generation_posts !== 1 || counters.history_gets < 1 || counters.result_gets < 2 ||
        counters.subscription_reads < 2 || counters.model_access_reads < 2 || counters.billing_calls !== 0 || callBodies.length !== 1) {
      fail("INSTALLED_LUMA_T2V_SYNTHETIC_CALL_COUNTERS_INVALID");
    }

    proof = Object.freeze({ status: packageProvenance === "npm-packed-installed"
      ? "INSTALLED_STOCK_SDK_LUMA_T2V_SYNTHETIC_CALLTOOL_PASS"
      : "ISOLATED_LUMA_T2V_SYNTHETIC_CALLTOOL_PASS",
      sdk_version: sdk.version, node_version: process.versions.node,
      package_provenance: packageProvenance, clean_installed_package: packageProvenance === "npm-packed-installed",
      source_catalog_version: CATALOG_VERSION,
      source_settings_version: SETTINGS_VERSION, registry_version: registryVersion,
      model: MODEL_ID, tool_names: TOOL_NAMES, synthetic_generation_posts: counters.generation_posts,
      synthetic_chats: counters.chats, synthetic_history_gets: counters.history_gets,
      synthetic_result_gets: counters.result_gets, synthetic_account_reads: counters.balance_reads + counters.subscription_reads,
      synthetic_model_access_reads: counters.model_access_reads, startup_network_calls: 0,
      external_network_calls: 0, billing_calls: counters.billing_calls, source_profile_runtime_usable: source.runtime_usable,
      provider_acceptance: "UNPROVEN", local_synthetic_only: true });
  } catch (error) {
    if (error instanceof LumaT2vFlowInstalledCheckError) failureCode = error.code;
    else {
      const name = error && typeof error.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(error.name)
        ? error.name.toUpperCase() : "UNKNOWN";
      const code = error && typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code)
        ? `_${error.code}` : "";
      failureCode = `INSTALLED_LUMA_T2V_SYNTHETIC_${name}${code}_FAILED`;
    }
  } finally {
    if (runtime !== undefined && attemptId !== undefined) {
      try {
        const linkService = runtime.serverOptions.auth?.linkService;
        if (typeof linkService?.revoke === "function") {
          await linkService.revoke(runtime.authBinding, attemptId);
          cleanup.unlink_confirmed = (await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status === "REVOKED";
        }
      } catch { cleanup.unlink_confirmed = false; }
    }
    const canDrainRuntime = runtime !== undefined && (attemptId === undefined || cleanup.unlink_confirmed === true);
    if (canDrainRuntime) {
      try {
        const lifecycle = runtime.ownerLumaT2vLifecycle;
        if (typeof lifecycle?.close === "function") {
          await lifecycle.close();
          cleanup.luma_lifecycle_closed = true;
        }
      } catch { cleanup.luma_lifecycle_closed = false; }
    }
    if (client !== undefined) { try { await client.close(); cleanup.client_closed = true; } catch { cleanup.client_closed = false; } }
    if (server !== undefined) { try { await server.close(); cleanup.server_closed = true; } catch { cleanup.server_closed = false; } }
    if (canDrainRuntime && cleanup.luma_lifecycle_closed === true) {
      try {
        if (typeof runtime.authStore.close === "function") {
          const closeResult = runtime.authStore.close();
          authStoreCloseReturnedVoid = closeResult === undefined;
          await Promise.resolve(closeResult);
          cleanup.auth_store_closed = true;
        }
      } catch { cleanup.auth_store_closed = false; }
    }
  }
  const cleanupComplete = (client === undefined || cleanup.client_closed === true) &&
    (server === undefined || cleanup.server_closed === true) &&
    (runtime === undefined || ((attemptId === undefined || cleanup.unlink_confirmed === true) &&
      cleanup.luma_lifecycle_closed === true && cleanup.auth_store_closed === true));
  if (!cleanupComplete) fail("INSTALLED_LUMA_T2V_CLEANUP_FAILED");
  if (failureCode !== undefined) fail(failureCode);
  if (proof === undefined) fail("INSTALLED_LUMA_T2V_SYNTHETIC_CHECK_PROOF_MISSING");
  return Object.freeze({ ...proof, cleanup: Object.freeze(cleanup), auth_store_close_returned_void: authStoreCloseReturnedVoid });
}

export function formatLumaT2vInstalledSummary(proof) {
  if (!proof || proof.status !== "INSTALLED_STOCK_SDK_LUMA_T2V_SYNTHETIC_CALLTOOL_PASS" ||
      proof.node_version !== "24.21.0" || proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true ||
      proof.package_provenance !== "npm-packed-installed" || proof.cleanup?.unlink_confirmed !== true ||
      proof.cleanup?.luma_lifecycle_closed !== true || proof.cleanup?.client_closed !== true ||
      proof.cleanup?.server_closed !== true || proof.cleanup?.auth_store_closed !== true ||
      proof.model !== MODEL_ID || !sameArray(proof.tool_names, TOOL_NAMES) || proof.synthetic_generation_posts !== 1 ||
      proof.synthetic_chats !== 1 || proof.startup_network_calls !== 0 || proof.external_network_calls !== 0 ||
      proof.billing_calls !== 0 || proof.source_profile_runtime_usable !== false || proof.local_synthetic_only !== true ||
      proof.provider_acceptance !== "UNPROVEN") fail("INSTALLED_LUMA_T2V_SUMMARY_INVALID");
  return `luma_t2v_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `model=${proof.model} tools=${proof.tool_names.length} synthetic_chats=${proof.synthetic_chats} ` +
    `synthetic_generation_posts=${proof.synthetic_generation_posts} synthetic_history_gets=${proof.synthetic_history_gets} ` +
    `synthetic_result_gets=${proof.synthetic_result_gets} synthetic_account_reads=${proof.synthetic_account_reads} ` +
    `synthetic_model_access_reads=${proof.synthetic_model_access_reads} startup_network=${proof.startup_network_calls} ` +
    `external_network=${proof.external_network_calls} billing=${proof.billing_calls} ` +
    `source_profile_runtime_usable=${proof.source_profile_runtime_usable} local_synthetic_only=${proof.local_synthetic_only} ` +
    `unlink=${proof.cleanup.unlink_confirmed} luma_drain=${proof.cleanup.luma_lifecycle_closed} ` +
    `client_close=${proof.cleanup.client_closed} server_close=${proof.cleanup.server_closed} auth_close=${proof.cleanup.auth_store_closed} ` +
    `provider_acceptance=${proof.provider_acceptance}`;
}

async function loadConsumerSdk(consumerPath) {
  const require = createRequire(join(consumerPath, "package.json"));
  const packagePath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk", "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") {
    fail("INSTALLED_LUMA_T2V_SDK_VERSION_MISMATCH");
  }
  const resolveModule = (path) => pathToFileURL(require.resolve(path)).href;
  const [{ Client }, { InMemoryTransport }] = await Promise.all([
    import(resolveModule("@modelcontextprotocol/sdk/client/index.js")),
    import(resolveModule("@modelcontextprotocol/sdk/inMemory.js"))
  ]);
  return Object.freeze({ Client, InMemoryTransport, version: manifest.version });
}

async function linkSyntheticAttempt(runtime, attemptId, now) {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: now + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-luma-installed-handoff");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-luma-installed-credential" });
}

function parseBody(value, code) {
  try { return JSON.parse(String(value)); } catch { fail(code); }
}
function safeCode(value) {
  const candidate = value?.error?.code;
  return typeof candidate === "string" && /^[A-Z0-9_]{1,64}$/u.test(candidate) ? candidate : "UNKNOWN_ERROR";
}
function parseCallToolResult(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = Array.isArray(result?.content) ? result.content.find((item) => item?.type === "text")?.text : undefined;
  try { return JSON.parse(text ?? "{}"); } catch { return {}; }
}
function sameKeys(value, expected) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function sameArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    actual.every((item, index) => item === expected[index]);
}
function assertInputSchema(schema, required, optional = []) {
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) {
    fail("INSTALLED_LUMA_T2V_INPUT_SCHEMA_INVALID");
  }
}
function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}
function fail(code) { throw new LumaT2vFlowInstalledCheckError(code); }
