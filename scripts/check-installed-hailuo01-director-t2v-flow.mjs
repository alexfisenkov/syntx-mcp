#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const MODEL_ID = "hailuo-01-director";
const AI_NAME = "hailuo-minimax";
const PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const SOURCE_TOOL = "syntx_owner_get_hailuo01_director_t2v_source";
const GENERATE_TOOL = "syntx_owner_generate_hailuo01_director_t2v";
const RECONCILE_TOOL = "syntx_owner_reconcile_hailuo01_director_t2v";
const LIST_TOOL = "syntx_owner_list_hailuo01_director_t2v_recoveries";
const TOOL_NAMES = Object.freeze([SOURCE_TOOL, GENERATE_TOOL, RECONCILE_TOOL, LIST_TOOL]);
const PROJECT_ROOT = realpath(new URL("../", import.meta.url));

export class Hailuo01DirectorT2vFlowInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "Hailuo01DirectorT2vFlowInstalledCheckError"; this.code = code; }
}

export async function assertInstalledHailuo01DirectorT2vFlow(installedPackagePath, consumerPath, packagedPaths,
  options = {}) {
  let runtime;
  let server;
  let client;
  const linkedAttempts = new Set();
  const cleanup = { unlinks_confirmed: null, director_lifecycle_closed: null,
    client_closed: null, server_closed: null, auth_store_closed: null };
  let authStoreCloseReturnedVoid = false;
  let failureCode;
  let proof;
  const packageProvenance = options.package_provenance ?? "npm-packed-installed";
  const now = options.now ?? (() => Date.parse("2026-10-13T04:00:00.000Z"));
  try {
    if (process.versions.node !== "24.21.0") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_NODE24_21_REQUIRED");
    if (!isAbsolute(installedPackagePath) || !isAbsolute(consumerPath) || !(packagedPaths instanceof Set)) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_ARGUMENTS_INVALID");
    }
    if (!new Set(["npm-packed-installed", "isolated-compiled-copy"]).has(packageProvenance)) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_PACKAGE_PROVENANCE_INVALID");
    }
    const installedRoot = await realpath(installedPackagePath);
    if (isWithin(await PROJECT_ROOT, installedRoot)) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    if (manifest.name !== "syntx-mcp") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_NOT_CLEAN_PACKAGE");

    const importPacked = (name) => import(pathToFileURL(join(installedRoot, `dist/src/${name}.js`)).href);
    const [profileModule, serviceModule, runtimeModule, serverModule] = await Promise.all([
      importPacked("application/owner-hailuo01-director-t2v-profile"),
      importPacked("application/owner-reviewed-no-reference-t2v-service"),
      importPacked("runtime/observed-owner-runtime"),
      importPacked("mcp/server")
    ]);
    if (typeof profileModule.createOwnerHailuo01DirectorT2vProfile !== "function" ||
        typeof serviceModule.OwnerHailuo01DirectorT2vGenerationService !== "function" ||
        typeof runtimeModule.createObservedOwnerRuntime !== "function" || typeof serverModule.createMcpServer !== "function") {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_RUNTIME_ABI_MISSING");
    }
    const profile = profileModule.createOwnerHailuo01DirectorT2vProfile(join(installedRoot, "catalog"));
    const source = profile.source;
    const registryVersion = profileModule.OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_REGISTRY_VERSION;
    if (registryVersion !== "sha256-081330c3e79fe53470a1e91242fd6913333a71cf66260120863dffc0cec72b4f.json" ||
        profile.registryVersion !== registryVersion || profile.registry?.schema_version !== "2.0.0" ||
        profile.registry?.contracts?.length !== 1) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_REGISTRY_INVALID");
    const contract = profile.registry.contracts[0];
    const requiredPaths = [
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js", "dist/src/mcp/server.js",
      "dist/src/application/owner-hailuo01-director-t2v-profile.js",
      "dist/src/application/owner-reviewed-no-reference-t2v-service.js",
      "dist/src/runtime/observed-owner-runtime.js", "dist/src/transports/stdio-owner.js",
      "dist/src/mcp/owner-hailuo01-director-t2v-tool.js",
      `catalog/public/${PUBLIC_CATALOG_VERSION}`, `catalog/settings/v2/${SETTINGS_VERSION}`,
      `catalog/generation-contracts-v2/${registryVersion}`
    ];
    if (requiredPaths.some((path) => !packagedPaths.has(path))) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_PACKAGE_CONTENT_MISSING");
    if (source?.status !== "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_UI_OBSERVATION" ||
        source?.source_pins?.public_catalog_version !== PUBLIC_CATALOG_VERSION ||
        source?.source_pins?.settings_inventory_version !== SETTINGS_VERSION ||
        source?.source_pins?.build_id !== "1791811899" ||
        source?.source_pins?.form_sha256 !== "sha256:44470e6f7de725746c4fbbee0ddb61cf861629943299ce006f34d0120706d10c" ||
        source?.source_pins?.sender_sha256 !== "sha256:b5df2329cf5fbc9e1b1289d146695954fd8576aed04818baffa6fbaaff1f73de" ||
        source?.identity?.model_id !== MODEL_ID || source?.identity?.ai_name !== AI_NAME ||
        source?.identity?.model_type !== MODEL_ID || source?.identity?.operation_id !== "generate-video" ||
        !sameArray(source?.controls?.resolution?.values, ["720p"]) ||
        source?.controls?.resolution?.effective_default !== "UNKNOWN" ||
        !sameArray(source?.controls?.video_duration?.values, [6]) ||
        source?.controls?.video_duration?.unit !== "INTEGER_SECONDS" ||
        source?.controls?.video_duration?.effective_default !== "UNKNOWN" ||
        source?.controls?.prompt?.source_max_length !== "UNKNOWN" || source?.controls?.prompt?.local_bound !== 5_000 ||
        source?.controls?.prompt?.local_bound_kind !== "LOCAL_RESOURCE_BOUND_UTF16" ||
        !sameArray(source?.cost_projection?.caller_keys, ["resolution", "video_duration"]) ||
        !sameArray(source?.cost_projection?.transport_owned_keys, ["model_type"]) ||
        source?.cost_projection?.value_mapping !== "UI_OBSERVED_RUNTIME_REQUEST" ||
        source?.cost_projection?.amount_or_quote !== "UNPROVEN" ||
        source?.wire_observation?.method !== "POST" || source?.wire_observation?.path !== "/api/v1/video/generate" ||
        source?.wire_observation?.query?.ai_name !== AI_NAME ||
        !sameArray(source?.wire_observation?.settings_keys, ["model_type", "video_duration", "resolution", "file_urls"]) ||
        source?.wire_observation?.no_references !== true || source?.wire_observation?.no_presets !== true ||
        source?.ui_observation?.source !== "ROOT1124_DIRECTOR_UI_POST" || source?.ui_observation?.result !== "PENDING" ||
        source?.ui_observation?.requested_resolution !== "720p" || source?.ui_observation?.requested_video_duration !== 6 ||
        source?.ui_observation?.no_references !== true || source?.ui_observation?.no_preset_selected !== true ||
        source?.effective_defaults !== "UNKNOWN" || source?.runtime_usable !== false || source?.dispatch_allowed !== false ||
        source?.backend_acceptance !== "UNPROVEN") {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SOURCE_PROFILE_INVALID");
    }
    if (contract?.model_id !== MODEL_ID || contract?.operation_id !== "generate-video" ||
        contract?.ai_name !== AI_NAME || contract?.model_type !== MODEL_ID || contract?.status !== "reviewed" ||
        contract?.variant_id !== profileModule.OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID ||
        !sameArray(contract?.parameters?.required, ["prompt", "resolution", "video_duration"]) ||
        !isDeepStrictEqual(contract?.wire?.settings_fields, { resolution: "resolution", video_duration: "video_duration" }) ||
        !isDeepStrictEqual(contract?.wire?.fixed_settings, { file_urls: [] }) ||
        contract?.provenance?.live_observed_at !== undefined) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_REVIEWED_CONTRACT_INVALID");

    const sdk = await loadConsumerSdk(consumerPath);
    const counters = { fetch_calls: 0, chats: 0, generation_posts: 0, history_gets: 0, inprogress_gets: 0,
      result_gets: 0, subscription_reads: 0, model_access_reads: 0, billing_calls: 0, unexpected_routes: 0 };
    const transactions = new Map();
    const callBodies = [];
    let currentNow = now();
    let failNextPost = false;
    let unknownRecoveryReady = false;
    const syntheticPrompt = "Installed synthetic Hailuo Director test: a paper kite above a quiet shoreline.";
    const fetchImpl = async (input, init = {}) => {
      counters.fetch_calls += 1;
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_ORIGIN_INVALID");
      if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
        counters.subscription_reads += 1;
        return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
      }
      if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
        counters.model_access_reads += 1;
        if (!sameArray([...url.searchParams.keys()].sort(), ["ai_name", "model_type", "resolution", "video_duration"].sort()) ||
            url.searchParams.get("ai_name") !== AI_NAME || url.searchParams.get("model_type") !== MODEL_ID ||
            url.searchParams.get("resolution") !== "720p" || url.searchParams.get("video_duration") !== "6") {
          fail("INSTALLED_HAILUO01_DIRECTOR_T2V_MODEL_ACCESS_QUERY_INVALID");
        }
        return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
          limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        counters.chats += 1;
        const body = parseBody(init.body, "INSTALLED_HAILUO01_DIRECTOR_T2V_CHAT_BODY_INVALID");
        if (!sameKeys(body, ["scope", "title"]) || body.scope !== "video" || typeof body.title !== "string") {
          fail("INSTALLED_HAILUO01_DIRECTOR_T2V_CHAT_BODY_INVALID");
        }
        return Response.json({ uuid: `hailuo-director-installed-chat-${counters.chats}` });
      }
      if (url.pathname === "/api/v1/video/generate" && method === "POST") {
        counters.generation_posts += 1;
        if (url.search !== `?ai_name=${AI_NAME}`) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_GENERATION_QUERY_INVALID");
        const body = parseBody(init.body, "INSTALLED_HAILUO01_DIRECTOR_T2V_GENERATION_BODY_INVALID");
        if (!sameKeys(body, ["chat_id", "prompt", "settings"]) ||
            body.chat_id !== `hailuo-director-installed-chat-${counters.chats}` ||
            typeof body.prompt !== "string" || body.prompt.length === 0) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_GENERATION_BODY_INVALID");
        const settings = body.settings;
        if (!sameKeys(settings, ["model_type", "resolution", "video_duration", "file_urls"]) ||
            settings.model_type !== MODEL_ID || settings.resolution !== "720p" || settings.video_duration !== 6 ||
            !Array.isArray(settings.file_urls) || settings.file_urls.length !== 0) {
          fail("INSTALLED_HAILUO01_DIRECTOR_T2V_GENERATION_SETTINGS_INVALID");
        }
        callBodies.push(body);
        const chatUuid = body.chat_id;
        transactions.set(chatUuid, { result_id: `hailuo-director-installed-result-${counters.generation_posts}` });
        if (failNextPost) {
          failNextPost = false;
          throw new Error("synthetic post ACK lost after possible dispatch");
        }
        return Response.json({ id: `hailuo-director-installed-echo-${counters.generation_posts}` });
      }
      const inProgress = /^\/api\/v1\/chats\/(hailuo-director-installed-chat-\d+)\/inprogress$/u.exec(url.pathname);
      if (inProgress && method === "GET") {
        counters.inprogress_gets += 1;
        if (inProgress[1] !== "hailuo-director-installed-chat-2" || !unknownRecoveryReady) return Response.json([]);
        const transaction = transactions.get(inProgress[1]);
        return Response.json([{ message_id: transaction.result_id, message_object_id: "hailuo-director-installed-object-2",
          object_type: "video", model_type: MODEL_ID }]);
      }
      const history = /^\/api\/v1\/chats\/(hailuo-director-installed-chat-\d+)\/messages$/u.exec(url.pathname);
      if (history && method === "GET") {
        counters.history_gets += 1;
        const transaction = transactions.get(history[1]);
        if (!transaction) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_HISTORY_CHAT_UNKNOWN");
        if (history[1] === "hailuo-director-installed-chat-2") return Response.json({ messages: [], pagination: {
          page: 1, page_size: 10, total_count: 0, total_pages: 0, has_next: false, has_previous: false
        } });
        return Response.json({ messages: [
          { id: `hailuo-director-installed-echo-${history[1].endsWith("1") ? "1" : "3"}`, chat_id: 9301, author_id: 42, message_object: [
            { id: "hailuo-director-installed-echo-object", message_id: `hailuo-director-installed-echo-${history[1].endsWith("1") ? "1" : "3"}`, object_type: "text", model_type: MODEL_ID }
          ] },
          { id: transaction.result_id, chat_id: 9301, author_id: -1, message_object: [
            { id: `hailuo-director-installed-video-object-${history[1].endsWith("1") ? "1" : "3"}`, message_id: transaction.result_id,
              object_type: "video", model_type: MODEL_ID }
          ] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const message = /^\/api\/v1\/chats\/(hailuo-director-installed-chat-\d+)\/(hailuo-director-installed-(?:echo-\d+|result-\d+))$/u.exec(url.pathname);
      if (message && method === "GET") {
        counters.result_gets += 1;
        const transaction = transactions.get(message[1]);
        if (!transaction) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_RESULT_CHAT_UNKNOWN");
        if (message[2].startsWith("hailuo-director-installed-echo")) return Response.json({ id: message[2], chat_id: 9301,
          author_id: 42, message_object: [{ id: "hailuo-director-installed-echo-object", object_type: "text", model_type: MODEL_ID }] });
        return Response.json({ id: message[2], chat_id: 9301, author_id: -1, message_object: [{
          id: "hailuo-director-installed-video-object-1", object_type: "video", model_type: MODEL_ID,
          object_url: "https://r2.syntx.ai/installed/hailuo-director-t2v-result.mp4", completed: true
        }] });
      }
      if (/billing|payment/iu.test(url.pathname)) {
        counters.billing_calls += 1;
        fail("INSTALLED_HAILUO01_DIRECTOR_T2V_BILLING_ROUTE_FORBIDDEN");
      }
      counters.unexpected_routes += 1;
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_ROUTE_UNEXPECTED");
    };

    runtime = runtimeModule.createObservedOwnerRuntime({ ownerHailuo01DirectorT2vEnabled: true, fetchImpl,
      catalogDirectory: join(installedRoot, "catalog"), now: () => currentNow, requestTimeoutMs: 2_000 });
    if (!runtime.serverOptions.ownerHailuo01DirectorT2v?.generationService ||
        typeof runtime.ownerHailuo01DirectorT2vLifecycle?.close !== "function") {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_OPT_IN_COMPOSITION_MISSING");
    }
    server = serverModule.createMcpServer(runtime.application, runtime.serverOptions);
    const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
    client = new sdk.Client({ name: "hailuo01-director-t2v-installed-synthetic", version: "1.0.0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map(({ name }) => name);
    if (TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_TOOL_LIST_INVALID");
    }
    const schemas = new Map(listed.tools.filter(({ name }) => TOOL_NAMES.includes(name)).map(({ name, inputSchema }) => [name, inputSchema]));
    assertInputSchema(schemas.get(SOURCE_TOOL), []);
    assertInputSchema(schemas.get(GENERATE_TOOL), ["link_attempt_id", "prompt", "resolution", "video_duration"]);
    assertInputSchema(schemas.get(RECONCILE_TOOL), ["link_attempt_id", "recovery_id"]);
    assertInputSchema(schemas.get(LIST_TOOL), ["link_attempt_id"], ["limit"]);
    const generateProperties = schemas.get(GENERATE_TOOL)?.properties;
    if (generateProperties?.resolution?.const !== "720p" || generateProperties?.video_duration?.const !== 6 ||
        generateProperties?.prompt?.maxLength !== 5_000) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_PARAMETER_SCHEMA_INVALID");
    const sourceResult = await client.callTool({ name: SOURCE_TOOL, arguments: {} });
    const sourceResponse = sourceResult?.structuredContent?.source ?? sourceResult?.structuredContent;
    if (sourceResult?.isError === true || sourceResponse?.identity?.model_id !== MODEL_ID ||
        sourceResponse?.ui_observation?.result !== "PENDING" || sourceResponse?.runtime_usable !== false ||
        sourceResponse?.dispatch_allowed !== false || sourceResponse?.backend_acceptance !== "UNPROVEN") {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SOURCE_TOOL_INVALID");
    }
    if (counters.fetch_calls !== 0) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_STARTUP_OR_SOURCE_NETWORK_ACCESS");

    const knownAttempt = "link_hailuo_director_installed_known_01234567890";
    await linkSyntheticAttempt(runtime, knownAttempt, currentNow + 60 * 60_000, linkedAttempts);
    const knownResult = await client.callTool({ name: GENERATE_TOOL, arguments: {
      link_attempt_id: knownAttempt, prompt: syntheticPrompt, resolution: "720p", video_duration: 6
    } }, undefined, { timeout: 8_000, maxTotalTimeout: 8_000 });
    assertResult(knownResult, profileModule.OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID);
    if (counters.chats !== 1 || counters.generation_posts !== 1 || counters.history_gets < 1 || counters.result_gets < 2 ||
        counters.subscription_reads !== 2 || counters.model_access_reads !== 2 || callBodies.length !== 1) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_KNOWN_ACK_COUNTERS_INVALID");
    }

    const unknownAttempt = "link_hailuo_director_installed_unknown_01234567890";
    await linkSyntheticAttempt(runtime, unknownAttempt, currentNow + 60 * 60_000, linkedAttempts);
    failNextPost = true;
    const unknownGenerate = await client.callTool({ name: GENERATE_TOOL, arguments: {
      link_attempt_id: unknownAttempt, prompt: `${syntheticPrompt} Unknown ACK scenario.`, resolution: "720p", video_duration: 6
    } });
    const unknown = parseCallToolResult(unknownGenerate);
    if (unknownGenerate?.isError !== true || unknown?.error?.code !== "OUTCOME_UNKNOWN" ||
        typeof unknown?.error?.recovery_id !== "string") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_UNKNOWN_POST_NOT_HELD");
    const recoveryId = unknown.error.recovery_id;
    const recoveries = await client.callTool({ name: LIST_TOOL, arguments: { link_attempt_id: unknownAttempt } });
    if (recoveries?.isError === true || recoveries?.structuredContent?.recoveries?.length !== 1 ||
        recoveries.structuredContent.recoveries[0]?.recovery_id !== recoveryId) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_RECOVERY_LIST_INVALID");
    const beforeReplay = { chats: counters.chats, posts: counters.generation_posts, accesses: counters.model_access_reads };
    const replay = await client.callTool({ name: GENERATE_TOOL, arguments: {
      link_attempt_id: unknownAttempt, prompt: `${syntheticPrompt} Unknown ACK scenario.`, resolution: "720p", video_duration: 6
    } });
    if (replay?.isError !== true || counters.chats !== beforeReplay.chats || counters.generation_posts !== beforeReplay.posts ||
        counters.model_access_reads !== beforeReplay.accesses) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_UNKNOWN_REPLAY_NOT_BLOCKED");
    const readsBeforeReconcile = counters.history_gets + counters.inprogress_gets + counters.result_gets;
    currentNow += 16 * 60_000;
    unknownRecoveryReady = true;
    const unknownReconcile = await client.callTool({ name: RECONCILE_TOOL, arguments: {
      link_attempt_id: unknownAttempt, recovery_id: recoveryId
    } }, undefined, { timeout: 8_000, maxTotalTimeout: 8_000 });
    if (unknownReconcile?.isError === true) fail(`INSTALLED_HAILUO01_DIRECTOR_T2V_GET_RECOVERY_ERROR_${safeCode(parseCallToolResult(unknownReconcile))}`);
    assertResult(unknownReconcile, profileModule.OWNER_HAILUO01_DIRECTOR_T2V_CONTRACT_VARIANT_ID);
    if (counters.generation_posts !== 2 || counters.chats !== 2 ||
        counters.history_gets + counters.inprogress_gets + counters.result_gets <= readsBeforeReconcile) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_GET_ONLY_RECOVERY_COUNTERS_INVALID");
    }

    const revokeAttempt = "link_hailuo_director_installed_revoke_01234567890";
    await linkSyntheticAttempt(runtime, revokeAttempt, currentNow + 60 * 60_000, linkedAttempts);
    failNextPost = true;
    const revokeGenerate = await client.callTool({ name: GENERATE_TOOL, arguments: {
      link_attempt_id: revokeAttempt, prompt: "Synthetic revoke-only Director request.", resolution: "720p", video_duration: 6
    } });
    const revokeUnknown = parseCallToolResult(revokeGenerate);
    if (revokeGenerate?.isError !== true || revokeUnknown?.error?.code !== "OUTCOME_UNKNOWN" ||
        typeof revokeUnknown?.error?.recovery_id !== "string") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_REVOKE_SETUP_INVALID");
    const revokedId = revokeUnknown.error.recovery_id;
    if (typeof runtime.linkService?.revoke !== "function") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_REVOKE_PORT_MISSING");
    await runtime.linkService.revoke(runtime.authBinding, revokeAttempt);
    const readsBeforeRevokedReconcile = counters.history_gets + counters.inprogress_gets + counters.result_gets;
    const revokedReconcile = await client.callTool({ name: RECONCILE_TOOL, arguments: {
      link_attempt_id: revokeAttempt, recovery_id: revokedId
    } });
    if (revokedReconcile?.isError !== true ||
        counters.history_gets + counters.inprogress_gets + counters.result_gets !== readsBeforeRevokedReconcile) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_REVOKED_RECOVERY_READ_NOT_BLOCKED");
    }
    if (counters.generation_posts !== 3 || counters.chats !== 3 || counters.model_access_reads !== 6 ||
        counters.subscription_reads !== 6 || counters.billing_calls !== 0 || callBodies.length !== 3) {
      fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_COUNTERS_INVALID");
    }

    proof = Object.freeze({ status: packageProvenance === "npm-packed-installed"
      ? "INSTALLED_STOCK_SDK_HAILUO01_DIRECTOR_T2V_SYNTHETIC_CALLTOOL_PASS"
      : "ISOLATED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_CALLTOOL_PASS",
      sdk_version: sdk.version, node_version: process.versions.node,
      package_provenance: packageProvenance, clean_installed_package: packageProvenance === "npm-packed-installed",
      source_catalog_version: PUBLIC_CATALOG_VERSION, source_settings_version: SETTINGS_VERSION,
      registry_version: registryVersion, model: MODEL_ID, ai_name: AI_NAME, tool_names: TOOL_NAMES,
      synthetic_generation_posts: counters.generation_posts, synthetic_chats: counters.chats,
      synthetic_history_gets: counters.history_gets, synthetic_inprogress_gets: counters.inprogress_gets,
      synthetic_result_gets: counters.result_gets, synthetic_subscription_reads: counters.subscription_reads,
      synthetic_model_access_reads: counters.model_access_reads, startup_network_calls: 0,
      external_network_calls: 0, billing_calls: counters.billing_calls,
      source_runtime_usable: source.runtime_usable, source_dispatch_allowed: source.dispatch_allowed,
      source_ui_result: source.ui_observation.result, source_backend_acceptance: source.backend_acceptance,
      local_synthetic_only: true });
  } catch (error) {
    if (error instanceof Hailuo01DirectorT2vFlowInstalledCheckError) failureCode = error.code;
    else {
      const name = error && typeof error.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(error.name)
        ? error.name.toUpperCase() : "UNKNOWN";
      const code = error && typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? `_${error.code}` : "";
      failureCode = `INSTALLED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_${name}${code}_FAILED`;
    }
  } finally {
    if (runtime !== undefined && linkedAttempts.size > 0) {
      const linkService = runtime.linkService;
      let allRevoked = typeof linkService?.revoke === "function";
      if (allRevoked) {
        for (const attemptId of linkedAttempts) {
          try {
            const snapshot = await runtime.authStore.getSnapshot(runtime.authBinding, attemptId);
            if (snapshot.status !== "REVOKED") await linkService.revoke(runtime.authBinding, attemptId);
            if ((await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status !== "REVOKED") allRevoked = false;
          } catch { allRevoked = false; }
        }
      }
      cleanup.unlinks_confirmed = allRevoked;
    }
    if (client !== undefined) { try { await client.close(); cleanup.client_closed = true; } catch { cleanup.client_closed = false; } }
    if (server !== undefined) { try { await server.close(); cleanup.server_closed = true; } catch { cleanup.server_closed = false; } }
    const canDrainRuntime = runtime !== undefined && (linkedAttempts.size === 0 || cleanup.unlinks_confirmed === true);
    if (canDrainRuntime) {
      try {
        if (typeof runtime.ownerHailuo01DirectorT2vLifecycle?.close !== "function") throw new Error("DIRECTOR_LIFECYCLE_CLOSE_UNAVAILABLE");
        await runtime.ownerHailuo01DirectorT2vLifecycle.close();
        cleanup.director_lifecycle_closed = true;
      } catch { cleanup.director_lifecycle_closed = false; }
      if (cleanup.director_lifecycle_closed === true) {
        try {
          if (typeof runtime.authStore?.close !== "function") throw new Error("AUTH_STORE_CLOSE_UNAVAILABLE");
          const closeResult = runtime.authStore.close();
          authStoreCloseReturnedVoid = closeResult === undefined;
          await Promise.resolve(closeResult);
          cleanup.auth_store_closed = true;
        } catch { cleanup.auth_store_closed = false; }
      }
    }
  }
  const cleanupComplete = (runtime === undefined || ((linkedAttempts.size === 0 || cleanup.unlinks_confirmed === true) &&
    cleanup.director_lifecycle_closed === true && cleanup.auth_store_closed === true)) &&
    (client === undefined || cleanup.client_closed === true) && (server === undefined || cleanup.server_closed === true);
  if (!cleanupComplete) {
    if (runtime !== undefined && linkedAttempts.size > 0 && cleanup.unlinks_confirmed !== true) {
      fail(`INSTALLED_HAILUO01_DIRECTOR_T2V_UNLINK_CLEANUP_FAILED_AFTER_${failureCode ?? "NO_PRIOR_FAILURE"}`);
    }
    if (runtime !== undefined && cleanup.director_lifecycle_closed !== true) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_LIFECYCLE_CLEANUP_FAILED");
    if (runtime !== undefined && cleanup.auth_store_closed !== true) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_AUTH_STORE_CLEANUP_FAILED");
    if (client !== undefined && cleanup.client_closed !== true) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_CLIENT_CLEANUP_FAILED");
    if (server !== undefined && cleanup.server_closed !== true) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SERVER_CLEANUP_FAILED");
    fail("INSTALLED_HAILUO01_DIRECTOR_T2V_CLEANUP_FAILED");
  }
  if (failureCode !== undefined) fail(failureCode);
  if (proof === undefined) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SYNTHETIC_CHECK_PROOF_MISSING");
  return Object.freeze({ ...proof, cleanup: Object.freeze(cleanup), auth_store_close_returned_void: authStoreCloseReturnedVoid });
}

export function formatHailuo01DirectorT2vInstalledSummary(proof) {
  if (!proof || proof.status !== "INSTALLED_STOCK_SDK_HAILUO01_DIRECTOR_T2V_SYNTHETIC_CALLTOOL_PASS" ||
      proof.node_version !== "24.21.0" || proof.sdk_version !== "1.32.1" || proof.clean_installed_package !== true ||
      proof.package_provenance !== "npm-packed-installed" || proof.cleanup?.unlinks_confirmed !== true ||
      proof.cleanup?.director_lifecycle_closed !== true || proof.cleanup?.client_closed !== true ||
      proof.cleanup?.server_closed !== true || proof.cleanup?.auth_store_closed !== true || proof.auth_store_close_returned_void !== true ||
      proof.model !== MODEL_ID || !sameArray(proof.tool_names, TOOL_NAMES) || proof.synthetic_generation_posts !== 3 ||
      proof.synthetic_chats !== 3 || proof.synthetic_model_access_reads !== 6 || proof.source_ui_result !== "PENDING" ||
      proof.startup_network_calls !== 0 || proof.external_network_calls !== 0 || proof.billing_calls !== 0 ||
      proof.source_runtime_usable !== false || proof.source_dispatch_allowed !== false ||
      proof.source_backend_acceptance !== "UNPROVEN" || proof.local_synthetic_only !== true) {
    fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SUMMARY_INVALID");
  }
  return `hailuo01_director_t2v_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} clean_package=true ` +
    `model=${proof.model} tools=${proof.tool_names.length} synthetic_chats=${proof.synthetic_chats} ` +
    `synthetic_generation_posts=${proof.synthetic_generation_posts} synthetic_history_gets=${proof.synthetic_history_gets} ` +
    `synthetic_inprogress_gets=${proof.synthetic_inprogress_gets} synthetic_result_gets=${proof.synthetic_result_gets} ` +
    `synthetic_subscription_reads=${proof.synthetic_subscription_reads} synthetic_model_access_reads=${proof.synthetic_model_access_reads} ` +
    `startup_network=${proof.startup_network_calls} external_network=${proof.external_network_calls} billing=${proof.billing_calls} ` +
    `unlink=${proof.cleanup.unlinks_confirmed} lifecycle_close=${proof.cleanup.director_lifecycle_closed} ` +
    `client_close=${proof.cleanup.client_closed} server_close=${proof.cleanup.server_closed} ` +
    `auth_close=${proof.cleanup.auth_store_closed} ui_result=${proof.source_ui_result} provider_acceptance=${proof.source_backend_acceptance}`;
}

async function linkSyntheticAttempt(runtime, attemptId, expiresAtMs, linkedAttempts) {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: expiresAtMs });
  linkedAttempts.add(attemptId);
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
  return runtime.authStore.getSnapshot(binding, attemptId);
}

async function loadConsumerSdk(consumerPath) {
  const require = createRequire(join(consumerPath, "package.json"));
  const packagePath = join(consumerPath, "node_modules", "@modelcontextprotocol", "sdk", "package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") {
    fail("INSTALLED_HAILUO01_DIRECTOR_T2V_SDK_VERSION_MISMATCH");
  }
  const resolveModule = (path) => pathToFileURL(require.resolve(path)).href;
  const [{ Client }, { InMemoryTransport }] = await Promise.all([
    import(resolveModule("@modelcontextprotocol/sdk/client/index.js")),
    import(resolveModule("@modelcontextprotocol/sdk/inMemory.js"))
  ]);
  return Object.freeze({ Client, InMemoryTransport, version: manifest.version });
}

function parseBody(value, code) { try { return JSON.parse(String(value)); } catch { fail(code); } }
function parseCallToolResult(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = Array.isArray(result?.content) ? result.content.find((item) => item?.type === "text")?.text : undefined;
  try { return JSON.parse(text ?? "{}"); } catch { return {}; }
}
function safeCode(value) {
  const code = value?.error?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : "UNKNOWN_ERROR";
}
function sameKeys(value, expected) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function sameArray(actual, expected) { return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index]); }
function assertInputSchema(schema, required, optional = []) {
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail("INSTALLED_HAILUO01_DIRECTOR_T2V_INPUT_SCHEMA_INVALID");
}
function assertResult(callResult, expectedVariant) {
  const result = callResult?.structuredContent;
  if (callResult?.isError === true || result?.status !== "reviewed" || result?.confidence_scope !== "exact_result_only" ||
      result?.model_id !== MODEL_ID || result?.operation_id !== "generate-video" || result?.modality !== "video" ||
      result?.variant_id !== expectedVariant || !Array.isArray(result.artifacts) || result.artifacts.length !== 1 ||
      result.artifacts[0]?.mime_type !== "video/mp4") fail("INSTALLED_HAILUO01_DIRECTOR_T2V_RESULT_INVALID");
}
function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}
function fail(code) { throw new Hailuo01DirectorT2vFlowInstalledCheckError(code); }
