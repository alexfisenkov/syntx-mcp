#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MODEL_ID = "video2audio";
const CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const SETTINGS_VERSION = "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json";
const TOOL_NAMES = Object.freeze([
  "syntx_owner_get_video2audio_source",
  "syntx_upload_video2audio_original",
  "syntx_owner_generate_video2audio",
  "syntx_owner_reconcile_video2audio",
  "syntx_owner_list_video2audio_recoveries",
  "syntx_owner_get_video2audio_result_page"
]);
const PROJECT_ROOT = realpath(fileURLToPath(new URL("../", import.meta.url)));
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);

export class Video2AudioFlowInstalledCheckError extends Error {
  constructor(code) { super(code); this.name = "Video2AudioFlowInstalledCheckError"; this.code = code; }
}

export async function assertInstalledVideo2AudioFlow(installedPackagePath, consumerPath, packagedPaths, options = {}) {
  let runtime;
  let server;
  let client;
  let offRuntime;
  let offServer;
  let offClient;
  let failureCode;
  let proof;
  let authStoreCloseReturnedVoid = false;
  let defaultOffAuthCloseReturnedVoid = false;
  const linkedAttempts = new Set();
  const cleanup = { unlinks_confirmed: null, video2audio_lifecycle_closed: null,
    client_closed: null, server_closed: null, auth_store_closed: null, default_off_client_closed: null,
    default_off_server_closed: null, default_off_auth_store_closed: null };
  const packageProvenance = options.package_provenance ?? "npm-packed-installed";
  try {
    if (process.versions.node !== "24.21.0") fail("INSTALLED_VIDEO2AUDIO_NODE24_21_REQUIRED");
    if (!isAbsolute(installedPackagePath) || !isAbsolute(consumerPath) || !(packagedPaths instanceof Set)) {
      fail("INSTALLED_VIDEO2AUDIO_ARGUMENTS_INVALID");
    }
    if (!new Set(["npm-packed-installed", "isolated-compiled-copy"]).has(packageProvenance)) {
      fail("INSTALLED_VIDEO2AUDIO_PACKAGE_PROVENANCE_INVALID");
    }
    const installedRoot = await realpath(installedPackagePath);
    if (isWithin(await PROJECT_ROOT, installedRoot)) fail("INSTALLED_VIDEO2AUDIO_NOT_CLEAN_PACKAGE");
    const manifest = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
    if (manifest.name !== "syntx-mcp") fail("INSTALLED_VIDEO2AUDIO_NOT_CLEAN_PACKAGE");

    const importPacked = (name) => import(pathToFileURL(join(installedRoot, `dist/src/${name}.js`)).href);
    const [profileModule, runtimeModule, serverModule] = await Promise.all([
      importPacked("application/owner-video2audio-source-profile"),
      importPacked("runtime/observed-owner-runtime"),
      importPacked("mcp/server")
    ]);
    if (typeof profileModule.createOwnerVideo2AudioSourceProfile !== "function" ||
        typeof runtimeModule.createObservedOwnerRuntime !== "function" || typeof serverModule.createMcpServer !== "function") {
      fail("INSTALLED_VIDEO2AUDIO_RUNTIME_ABI_MISSING");
    }
    const profile = profileModule.createOwnerVideo2AudioSourceProfile(join(installedRoot, "catalog"));
    const source = profile.source;
    if (source?.status !== "CURRENT_B066_1B48_STATIC_SOURCE_CONTRACT_WITH_ONE_UI_WIRE_OBSERVATION" ||
        source?.source_pins?.public_catalog_version !== CATALOG_VERSION ||
        source?.source_pins?.settings_inventory_version !== SETTINGS_VERSION ||
        source?.identity?.model_id !== MODEL_ID || source?.identity?.ai_name !== MODEL_ID ||
        source?.identity?.model_type !== MODEL_ID || source?.identity?.operation_id !== "generate-audio" ||
        source?.identity?.modality !== "audio" || source?.wire_observation?.method !== "POST" ||
        source?.wire_observation?.path !== "/api/v1/audio/generate" || source?.wire_observation?.query?.ai_name !== MODEL_ID ||
        !sameArray(source?.wire_observation?.settings_keys, ["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"]) ||
        source?.wire_observation?.fixed_mode !== "generate" || source?.wire_observation?.fixed_negative_prompt !== "" ||
        source?.wire_observation?.observed_seed !== 0 || source?.wire_observation?.duration_source !== "SAME_OWNED_UPLOAD_RECEIPT" ||
        !sameArray(source?.model_access_observation?.query_keys, ["ai_name", "model_type"]) ||
        !sameArray(source?.model_access_observation?.cost_parameter_keys, []) ||
        !sameArray(source?.cost_projection?.query_caller_keys, []) ||
        !sameArray(source?.cost_projection?.declared_cost_parameter_keys, []) ||
        source?.cost_projection?.amount_or_quote !== "UNPROVEN" || source?.controls?.duration?.caller_supplied !== false ||
        source?.controls?.duration?.source !== "TRUSTED_UPLOAD_METADATA_REQUIRED" ||
        source?.controls?.original_video?.local_size_bound_bytes !== 10 * 1024 * 1024 ||
        source?.controls?.original_video?.size_bound_kind !== "LOCAL_NATIVE_RESOURCE_BOUND_NOT_PROVIDER_LIMIT" ||
        source?.controls?.prompt?.source_max_length !== "UNKNOWN" || source?.controls?.prompt?.local_bound_utf16 !== 5_000 ||
        source?.runtime_usable !== false || source?.dispatch_allowed !== false || source?.backend_acceptance !== "UNPROVEN") {
      fail("INSTALLED_VIDEO2AUDIO_SOURCE_CONTRACT_INVALID");
    }
    const requiredPaths = [
      "package.json", "dist/src/index.js", "dist/src/transports/stdio-owner.js", "dist/src/mcp/server.js",
      "dist/src/runtime/observed-owner-runtime.js", "dist/src/adapter/syntx/chat-http-client.js",
      "dist/src/adapter/syntx/video2audio-original-codec.js", "dist/src/application/owner-video2audio-source-profile.js",
      "dist/src/application/owner-video2audio-input-parameters.js", "dist/src/application/owner-video2audio-original-reference-service.js",
      "dist/src/application/owner-video2audio-request-preparer.js", "dist/src/application/owner-video2audio-one-shot-policy.js",
      "dist/src/application/owner-video2audio-generation-service.js", "dist/src/application/owner-video2audio-result-codec.js",
      "dist/src/mcp/owner-video2audio-tools.js", `catalog/public/${CATALOG_VERSION}`,
      `catalog/settings/v2/${SETTINGS_VERSION}`
    ];
    if (requiredPaths.some((path) => !packagedPaths.has(path))) fail("INSTALLED_VIDEO2AUDIO_PACKAGE_CONTENT_MISSING");

    const sdk = await loadConsumerSdk(consumerPath);
    const counters = { fetch_calls: 0, upload_posts: 0, chat_posts: 0, generation_posts: 0,
      history_gets: 0, result_gets: 0, balance_reads: 0, subscription_reads: 0, model_access_reads: 0,
      billing_calls: 0, unexpected_routes: 0, lost_ack_posts: 0, host_cancel_posts: 0 };
    const transactions = new Map();
    const uploadsByAttempt = new Map();
    const linked = new Set();
    const gate = { host_cancel_entered: undefined, host_cancel_signal: undefined };
    const hostCancelEntered = new Promise((resolve) => { gate.host_cancel_entered = resolve; });
    let currentAttemptId;
    let currentNow = Date.parse("2026-10-13T04:00:00.000Z");
    const successPrompt = "Installed synthetic Video2Audio test: a blue sailboat on a still lake.";
    const ttlPrompt = "Installed synthetic Video2Audio TTL test: a paper kite in a garden.";
    const unknownPrompt = "Installed synthetic Video2Audio lost-ACK test: a glass marble on a desk.";
    const revokePrompt = "Installed synthetic Video2Audio revoke test: a red leaf on a path.";
    const hostCancelPrompt = "Installed synthetic Video2Audio host-cancel test: a yellow toy car.";
    const promptMode = new Map([[successPrompt, "complete65"], [ttlPrompt, "ttl2"], [unknownPrompt, "lost_ack"],
      [revokePrompt, "revoke"], [hostCancelPrompt, "host_cancel"]]);
    const fetchImpl = async (input, init = {}) => {
      counters.fetch_calls += 1;
      let url;
      try { url = new URL(input instanceof Request ? input.url : String(input)); }
      catch { counters.unexpected_routes += 1; fail("INSTALLED_VIDEO2AUDIO_SYNTHETIC_URL_INVALID"); }
      const method = init.method ?? (input instanceof Request ? input.method : "GET");
      if (url.origin !== "https://api.syntx.ai") fail("INSTALLED_VIDEO2AUDIO_SYNTHETIC_ORIGIN_INVALID");
      if (url.pathname === "/api/v1/user/balance" && method === "GET") {
        counters.balance_reads += 1;
        return Response.json({ balance: "0" });
      }
      if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
        counters.subscription_reads += 1;
        return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
      }
      if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
        counters.model_access_reads += 1;
        if (!sameArray([...url.searchParams.keys()].sort(), ["ai_name", "model_type"].sort()) ||
            url.searchParams.get("ai_name") !== MODEL_ID || url.searchParams.get("model_type") !== MODEL_ID) {
          fail("INSTALLED_VIDEO2AUDIO_MODEL_ACCESS_QUERY_INVALID");
        }
        return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
          limit: null, show_warning: false });
      }
      if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
        counters.upload_posts += 1;
        const form = init.body;
        if (!(form instanceof FormData) || !sameArray([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]) ||
            form.get("destination") !== "uploaded" || form.get("check_duplicates") !== "true" || form.get("model_type") !== MODEL_ID) {
          fail("INSTALLED_VIDEO2AUDIO_UPLOAD_FORM_INVALID");
        }
        const file = form.get("files");
        if (!(file instanceof File) || file.type !== "video/mp4" || file.name !== "synthetic-original.mp4" ||
            !Buffer.from(await file.arrayBuffer()).equals(MP4)) fail("INSTALLED_VIDEO2AUDIO_UPLOAD_BYTES_INVALID");
        const urlValue = `https://r2.syntx.ai/video2audio/installed-original-${counters.upload_posts}.mp4`;
        uploadsByAttempt.set(currentAttemptId, urlValue);
        return Response.json({ total: 1, successful: 1, failed: 0, duplicates: 0,
          files: [{ filename: "synthetic-original.mp4", url: urlValue, status: "success", content_type: "video/mp4",
            size: MP4.byteLength, duration: 5.64, width: 1280, height: 720 }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        counters.chat_posts += 1;
        const body = parseBody(init.body, "INSTALLED_VIDEO2AUDIO_CHAT_BODY_INVALID");
        if (!sameKeys(body, ["scope", "title"]) || body.scope !== "audio" || typeof body.title !== "string") {
          fail("INSTALLED_VIDEO2AUDIO_CHAT_BODY_INVALID");
        }
        const chatUuid = `video2audio-installed-chat-${counters.chat_posts}`;
        const transactionsEntry = { chat_uuid: chatUuid, attempt_id: currentAttemptId, prompt: undefined, mode: undefined,
          recovery_id: undefined, ready_at: undefined, object_count: 0, revoked: false };
        transactions.set(chatUuid, transactionsEntry);
        return Response.json({ uuid: chatUuid });
      }
      if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
        counters.generation_posts += 1;
        const body = parseBody(init.body, "INSTALLED_VIDEO2AUDIO_GENERATION_BODY_INVALID");
        const mode = promptMode.get(body.prompt);
        const transaction = transactions.get(body.chat_uuid);
        const settings = body.settings;
        const uploadedUrl = uploadsByAttempt.get(currentAttemptId);
        if (url.search !== "?ai_name=video2audio" || !sameKeys(body, ["chat_uuid", "prompt", "settings"]) ||
            !transaction || transaction.attempt_id !== currentAttemptId || !mode ||
            !sameKeys(settings, ["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"]) ||
            settings.model_type !== MODEL_ID || settings.mode !== "generate" || settings.duration !== 5.64 ||
            settings.negative_prompt !== "" || settings.seed !== 0 || !Array.isArray(settings.file_urls) ||
            !sameArray(settings.file_urls, [{ type: "video", url: uploadedUrl }])) {
          fail("INSTALLED_VIDEO2AUDIO_GENERATION_BODY_INVALID");
        }
        transaction.prompt = body.prompt;
        transaction.mode = mode;
        transaction.object_count = mode === "complete65" ? 65 : 2;
        transaction.ready_at = mode === "ttl2" ? currentNow + 16 * 60_000 : currentNow;
        if (mode === "lost_ack") {
          counters.lost_ack_posts += 1;
          throw new Error("SYNTHETIC_LOST_POST_ACK");
        }
        if (mode === "host_cancel") {
          counters.host_cancel_posts += 1;
          const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
          if (!signal) fail("INSTALLED_VIDEO2AUDIO_HOST_CANCEL_SIGNAL_MISSING");
          gate.host_cancel_signal = signal;
          gate.host_cancel_entered();
          return await new Promise((resolve, reject) => {
            if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return Response.json({ id: `video2audio-installed-ack-${counters.generation_posts}` });
      }
      const historyMatch = /^\/api\/v1\/chats\/(video2audio-installed-chat-\d+)\/messages$/u.exec(url.pathname);
      if (historyMatch && method === "GET") {
        counters.history_gets += 1;
        if (!sameArray([...url.searchParams.keys()].sort(), ["page", "page_size"]) ||
            url.searchParams.get("page") !== "1" || url.searchParams.get("page_size") !== "10") {
          fail("INSTALLED_VIDEO2AUDIO_HISTORY_QUERY_INVALID");
        }
        const transaction = transactions.get(historyMatch[1]);
        if (!transaction) fail("INSTALLED_VIDEO2AUDIO_HISTORY_CHAT_UNKNOWN");
        if (transaction.mode === "revoke" && !transaction.revoked) {
          transaction.revoked = true;
          await runtime.linkService.revoke(runtime.authBinding, transaction.attempt_id);
        }
        const ackId = `video2audio-installed-ack-${Number(historyMatch[1].split("-").at(-1))}`;
        const resultGroups = Math.ceil(transaction.object_count / 64);
        const messages = [{ id: ackId, chat_id: 83001, author_id: 5401, message_object: [{ id: `${ackId}-echo`,
          message_id: ackId, object_type: "text", object_text: transaction.prompt, model_type: MODEL_ID }] }];
        for (let group = 0; group < resultGroups; group += 1) {
          const messageId = `video2audio-installed-result-${transaction.chat_uuid}-${group + 1}`;
          const first = group * 64;
          const count = Math.min(64, transaction.object_count - first);
          messages.push({ id: messageId, chat_id: 83001, author_id: -1, message_object: Array.from({ length: count }, (_unused, offset) => {
            const ordinal = first + offset + 1;
            const objectType = ordinal % 2 === 0 ? "audio" : "video";
            return { id: `video2audio-installed-object-${transaction.chat_uuid}-${ordinal}`, message_id: messageId,
              object_type: objectType, model_type: MODEL_ID };
          }) });
        }
        return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
          total_pages: 1, has_next: false, has_previous: false } });
      }
      const resultMatch = /^\/api\/v1\/chats\/(video2audio-installed-chat-\d+)\/(video2audio-installed-result-.*)$/u.exec(url.pathname);
      if (resultMatch && method === "GET") {
        counters.result_gets += 1;
        const transaction = transactions.get(resultMatch[1]);
        if (!transaction) fail("INSTALLED_VIDEO2AUDIO_RESULT_CHAT_UNKNOWN");
        const suffix = resultMatch[2].slice(`video2audio-installed-result-${transaction.chat_uuid}-`.length);
        const group = Number(suffix) - 1;
        const first = group * 64;
        const count = Math.min(64, Math.max(0, transaction.object_count - first));
        return Response.json({ id: resultMatch[2], chat_id: 83001, author_id: -1,
          message_object: Array.from({ length: count }, (_unused, offset) => {
            const ordinal = first + offset + 1;
            const objectType = ordinal % 2 === 0 ? "audio" : "video";
            const extension = objectType === "audio" ? "m4a" : "mp4";
            return { id: `video2audio-installed-object-${transaction.chat_uuid}-${ordinal}`, message_id: resultMatch[2],
              object_type: objectType, model_type: MODEL_ID,
              object_url: `https://r2.syntx.ai/video2audio/installed-result-${transaction.chat_uuid}-${ordinal}.${extension}`,
              completed: currentNow >= transaction.ready_at };
          }) });
      }
      if (/billing|payment/iu.test(url.pathname)) { counters.billing_calls += 1; fail("INSTALLED_VIDEO2AUDIO_BILLING_ROUTE_FORBIDDEN"); }
      counters.unexpected_routes += 1;
      fail("INSTALLED_VIDEO2AUDIO_SYNTHETIC_ROUTE_UNEXPECTED");
    };

    const countersBeforeStartup = counters.fetch_calls;
    offRuntime = runtimeModule.createObservedOwnerRuntime({ ownerVideo2AudioEnabled: false,
      fetchImpl, now: () => currentNow, requestTimeoutMs: 2_000 });
    offServer = serverModule.createMcpServer(offRuntime.application, offRuntime.serverOptions);
    const [offClientTransport, offServerTransport] = sdk.InMemoryTransport.createLinkedPair();
    offClient = new sdk.Client({ name: "video2audio-off-installed-synthetic", version: "1.0.0" }, { capabilities: {} });
    await offServer.connect(offServerTransport);
    await offClient.connect(offClientTransport);
    const offTools = await offClient.listTools();
    if (offTools.tools.some(({ name }) => TOOL_NAMES.includes(name)) || counters.fetch_calls !== countersBeforeStartup) {
      fail("INSTALLED_VIDEO2AUDIO_DEFAULT_OFF_STARTUP_FAILED");
    }
    await offClient.close(); cleanup.default_off_client_closed = true; offClient = undefined;
    await offServer.close(); cleanup.default_off_server_closed = true; offServer = undefined;
    const offAuthClose = offRuntime.authStore.close?.();
    defaultOffAuthCloseReturnedVoid = offAuthClose === undefined;
    await Promise.resolve(offAuthClose);
    cleanup.default_off_auth_store_closed = true; offRuntime = undefined;

    runtime = runtimeModule.createObservedOwnerRuntime({ ownerVideo2AudioEnabled: true, fetchImpl,
      now: () => currentNow, requestTimeoutMs: 2_000 });
    if (!runtime.serverOptions.ownerVideo2Audio?.profile || !runtime.serverOptions.ownerVideo2Audio?.originalReferenceService ||
        !runtime.serverOptions.ownerVideo2Audio?.generationService || !runtime.ownerVideo2AudioLifecycle) {
      fail("INSTALLED_VIDEO2AUDIO_OPT_IN_COMPOSITION_MISSING");
    }
    server = serverModule.createMcpServer(runtime.application, runtime.serverOptions);
    const [clientTransport, serverTransport] = sdk.InMemoryTransport.createLinkedPair();
    client = new sdk.Client({ name: "video2audio-installed-synthetic", version: "1.0.0" }, { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map(({ name }) => name);
    if (TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) fail("INSTALLED_VIDEO2AUDIO_TOOL_LIST_INVALID");
    const schemas = new Map(listed.tools.filter(({ name }) => TOOL_NAMES.includes(name)).map(({ name, inputSchema }) => [name, inputSchema]));
    assertInputSchema(schemas.get(TOOL_NAMES[0]), []);
    assertInputSchema(schemas.get(TOOL_NAMES[1]), ["link_attempt_id", "content_base64", "filename", "mime_type"]);
    assertInputSchema(schemas.get(TOOL_NAMES[2]), ["link_attempt_id", "prompt", "video_original_handle"]);
    assertInputSchema(schemas.get(TOOL_NAMES[3]), ["link_attempt_id", "recovery_id"]);
    assertInputSchema(schemas.get(TOOL_NAMES[4]), ["link_attempt_id"], ["limit"]);
    assertInputSchema(schemas.get(TOOL_NAMES[5]), ["link_attempt_id", "recovery_id"], ["offset"]);
    if (counters.fetch_calls !== countersBeforeStartup) fail("INSTALLED_VIDEO2AUDIO_OPT_IN_STARTUP_NETWORK_ACCESS");

    const upload = async (attemptId, suffix) => {
      currentAttemptId = attemptId;
      await linkSyntheticAttempt(runtime, attemptId, currentNow + 60 * 60_000, linkedAttempts);
      const result = await client.callTool({ name: TOOL_NAMES[1], arguments: { link_attempt_id: attemptId,
        content_base64: MP4.toString("base64"), filename: "synthetic-original.mp4", mime_type: "video/mp4" } });
      const value = readStructured(result, "INSTALLED_VIDEO2AUDIO_UPLOAD_TOOL_FAILED");
      if (value.status !== "uploaded" || value.mime_type !== "video/mp4" || value.duration_seconds !== 5.64 ||
          value.size !== MP4.byteLength || value.expires_in_seconds !== 900 ||
          JSON.stringify(value).includes(uploadsByAttempt.get(attemptId))) fail("INSTALLED_VIDEO2AUDIO_UPLOAD_OUTPUT_INVALID");
      return value.video_original_handle;
    };
    const generate = async (attemptId, prompt, handle, signal) => {
      currentAttemptId = attemptId;
      return client.callTool({ name: TOOL_NAMES[2], arguments: { link_attempt_id: attemptId,
        prompt, video_original_handle: handle } }, undefined, signal ? { signal, timeout: 8_000, maxTotalTimeout: 8_000 } : { timeout: 8_000, maxTotalTimeout: 8_000 });
    };
    const listRecoveries = async (attemptId) => {
      currentAttemptId = attemptId;
      return client.callTool({ name: TOOL_NAMES[4], arguments: { link_attempt_id: attemptId, limit: 20 } });
    };
    const reconcile = async (attemptId, recoveryId) => {
      currentAttemptId = attemptId;
      return client.callTool({ name: TOOL_NAMES[3], arguments: { link_attempt_id: attemptId, recovery_id: recoveryId } });
    };

    const sourceResult = await client.callTool({ name: TOOL_NAMES[0], arguments: {} });
    const sourceOutput = readStructured(sourceResult, "INSTALLED_VIDEO2AUDIO_SOURCE_TOOL_FAILED");
    if (sourceOutput.runtime_usable !== false || sourceOutput.dispatch_allowed !== false ||
        sourceOutput.backend_acceptance !== "UNPROVEN" || sourceOutput.model_access_observation?.current_user_access !== "NOT_READ" ||
        sourceOutput.cost_projection?.amount_or_quote !== "UNPROVEN") fail("INSTALLED_VIDEO2AUDIO_SOURCE_SCOPE_INVALID");
    const startupNetworkCalls = counters.fetch_calls - countersBeforeStartup;

    const successAttempt = "link_video2audio_installed_success_0123456789";
    const successHandle = await upload(successAttempt, "success");
    const accountBeforeSuccess = counters.balance_reads + counters.subscription_reads;
    const modelBeforeSuccess = counters.model_access_reads;
    const success = readStructured(await generate(successAttempt, successPrompt, successHandle), "INSTALLED_VIDEO2AUDIO_SUCCESS_CALL_FAILED");
    if (success.status !== "COMPLETE" || success.backend_acceptance !== "UNPROVEN" || success.provider_terminal_status !== "UNPROVEN" ||
        success.observed_artifact_count !== 65 || success.artifacts.length !== 64 || success.next_offset !== 64 ||
        success.diagnostic?.owner_ack_status !== "MATCHED" || counters.generation_posts !== 1 || counters.chat_posts !== 1 ||
        counters.model_access_reads - modelBeforeSuccess !== 2 ||
        counters.balance_reads + counters.subscription_reads - accountBeforeSuccess !== 4) {
      fail("INSTALLED_VIDEO2AUDIO_SUCCESS_RESULT_INVALID");
    }
    const typesInFirstPage = new Set(success.artifacts.map((artifact) => artifact.object_type));
    if (!typesInFirstPage.has("video") || !typesInFirstPage.has("audio")) fail("INSTALLED_VIDEO2AUDIO_MIXED_OUTPUT_INVALID");
    const nativeGetsBeforeLocalPage = counters.history_gets + counters.result_gets;
    currentAttemptId = successAttempt;
    const lastPage = readStructured(await client.callTool({ name: TOOL_NAMES[5], arguments: {
      link_attempt_id: successAttempt, recovery_id: success.recovery_id, offset: 64
    } }), "INSTALLED_VIDEO2AUDIO_LOCAL_PAGE_FAILED");
    if (lastPage.offset !== 64 || lastPage.artifacts.length !== 1 || lastPage.next_offset !== null ||
        counters.history_gets + counters.result_gets !== nativeGetsBeforeLocalPage) fail("INSTALLED_VIDEO2AUDIO_LOCAL_PAGE_INVALID");

    const ttlAttempt = "link_video2audio_installed_ttl_0123456789";
    const ttlHandle = await upload(ttlAttempt, "ttl");
    const ttlInitial = readStructured(await generate(ttlAttempt, ttlPrompt, ttlHandle), "INSTALLED_VIDEO2AUDIO_TTL_INITIAL_CALL_FAILED");
    if (ttlInitial.status === "COMPLETE" || counters.generation_posts !== 2) fail("INSTALLED_VIDEO2AUDIO_TTL_INITIAL_STATE_INVALID");
    currentNow += 16 * 60_000;
    const postTtl = readStructured(await reconcile(ttlAttempt, ttlInitial.recovery_id), "INSTALLED_VIDEO2AUDIO_POST_TTL_GET_FAILED");
    if (postTtl.status !== "COMPLETE" || !postTtl.artifacts.some((artifact) => artifact.object_type === "audio") ||
        !postTtl.artifacts.some((artifact) => artifact.object_type === "video") || counters.generation_posts !== 2 || counters.upload_posts !== 2) {
      fail("INSTALLED_VIDEO2AUDIO_POST_TTL_RECOVERY_INVALID");
    }

    const unknownAttempt = "link_video2audio_installed_unknown_0123456789";
    const unknownHandle = await upload(unknownAttempt, "unknown");
    const unknownPost = await generate(unknownAttempt, unknownPrompt, unknownHandle);
    const unknownError = readSafeError(unknownPost);
    if (unknownError?.code !== "OUTCOME_UNKNOWN" || typeof unknownError?.recovery_id !== "string" || counters.lost_ack_posts !== 1) {
      fail("INSTALLED_VIDEO2AUDIO_LOST_ACK_NOT_HELD");
    }
    const unknownList = readStructured(await listRecoveries(unknownAttempt), "INSTALLED_VIDEO2AUDIO_UNKNOWN_LIST_FAILED");
    const unknownRow = unknownList.recoveries?.find((row) => row.recovery_id === unknownError.recovery_id);
    if (unknownRow?.status !== "outcome_unknown") fail("INSTALLED_VIDEO2AUDIO_UNKNOWN_RECOVERY_NOT_LISTABLE");
    const getsBeforeUnknownReconcile = counters.history_gets + counters.result_gets;
    const pendingUnknown = readStructured(await reconcile(unknownAttempt, unknownError.recovery_id), "INSTALLED_VIDEO2AUDIO_UNKNOWN_RECONCILE_FAILED");
    if (pendingUnknown.status !== "PENDING" || pendingUnknown.diagnostic?.owner_ack_status !== "MISSING" ||
        pendingUnknown.diagnostic?.result_get_calls !== 0 || counters.history_gets + counters.result_gets !== getsBeforeUnknownReconcile) {
      fail("INSTALLED_VIDEO2AUDIO_UNKNOWN_ACK_FABRICATED");
    }
    const generationsBeforeDuplicate = counters.generation_posts;
    const duplicateUnknown = readSafeError(await generate(unknownAttempt, unknownPrompt, unknownHandle));
    if (duplicateUnknown?.code !== "OUTCOME_UNKNOWN" || counters.generation_posts !== generationsBeforeDuplicate) {
      fail("INSTALLED_VIDEO2AUDIO_UNKNOWN_INTENT_REPLAYED");
    }

    const revokeAttempt = "link_video2audio_installed_revoke_0123456789";
    const revokeHandle = await upload(revokeAttempt, "revoke");
    const resultGetsBeforeRevoke = counters.result_gets;
    const revokeFailure = readSafeError(await generate(revokeAttempt, revokePrompt, revokeHandle));
    if (revokeFailure?.code !== "OUTCOME_UNKNOWN" || counters.generation_posts !== 4 || counters.result_gets !== resultGetsBeforeRevoke) {
      fail("INSTALLED_VIDEO2AUDIO_REVOKE_DID_NOT_BLOCK_RESULT_GET");
    }

    const cancelAttempt = "link_video2audio_installed_cancel_0123456789";
    const cancelHandle = await upload(cancelAttempt, "cancel");
    const abortController = new AbortController();
    let cancelRequest;
    currentAttemptId = cancelAttempt;
    cancelRequest = client.callTool({ name: TOOL_NAMES[2], arguments: { link_attempt_id: cancelAttempt,
      prompt: hostCancelPrompt, video_original_handle: cancelHandle } }, undefined,
    { signal: abortController.signal, timeout: 8_000, maxTotalTimeout: 8_000 }).then((value) => ({ value }), (error) => ({ error }));
    await withDeadline(hostCancelEntered, 3_000, "INSTALLED_VIDEO2AUDIO_HOST_CANCEL_POST_NOT_STARTED");
    abortController.abort();
    await withDeadline(cancelRequest, 3_000, "INSTALLED_VIDEO2AUDIO_HOST_CANCEL_DID_NOT_DRAIN");
    const cancelRows = readStructured(await listRecoveries(cancelAttempt), "INSTALLED_VIDEO2AUDIO_HOST_CANCEL_RECOVERY_LIST_FAILED");
    if (!cancelRows.recoveries?.some((row) => row.status === "outcome_unknown") || counters.host_cancel_posts !== 1) {
      fail("INSTALLED_VIDEO2AUDIO_HOST_CANCEL_NOT_LISTABLE");
    }
    const cancelGenerationCount = counters.generation_posts;
    const cancelDuplicate = readSafeError(await generate(cancelAttempt, hostCancelPrompt, cancelHandle));
    if (cancelDuplicate?.code !== "OUTCOME_UNKNOWN" || counters.generation_posts !== cancelGenerationCount) {
      fail("INSTALLED_VIDEO2AUDIO_HOST_CANCEL_INTENT_REPLAYED");
    }
    if (defaultOffAuthCloseReturnedVoid !== true || counters.billing_calls !== 0 || counters.unexpected_routes !== 0 ||
        counters.generation_posts !== 5 || counters.upload_posts !== 5 || counters.chat_posts !== 5 ||
        counters.model_access_reads !== 10 || counters.fetch_calls === 0) fail("INSTALLED_VIDEO2AUDIO_SYNTHETIC_COUNTERS_INVALID");

    proof = Object.freeze({ status: packageProvenance === "npm-packed-installed"
      ? "INSTALLED_STOCK_SDK_VIDEO2AUDIO_SYNTHETIC_CALLTOOL_PASS" : "ISOLATED_VIDEO2AUDIO_SYNTHETIC_CALLTOOL_PASS",
      sdk_version: sdk.version, node_version: process.versions.node, package_provenance: packageProvenance,
      clean_installed_package: packageProvenance === "npm-packed-installed", model: MODEL_ID,
      tool_names: TOOL_NAMES, default_off_tool_count: 0, source_catalog_version: CATALOG_VERSION,
      source_settings_version: SETTINGS_VERSION, synthetic_upload_posts: counters.upload_posts,
      synthetic_chats: counters.chat_posts, synthetic_generation_posts: counters.generation_posts,
      synthetic_unknown_post_count: counters.lost_ack_posts, synthetic_host_cancel_posts: counters.host_cancel_posts,
      synthetic_history_gets: counters.history_gets, synthetic_result_gets: counters.result_gets,
      synthetic_balance_reads: counters.balance_reads, synthetic_subscription_reads: counters.subscription_reads,
      synthetic_account_reads: counters.balance_reads + counters.subscription_reads,
      synthetic_model_access_reads: counters.model_access_reads, local_page_size: success.page_size,
      known_ack_after_ttl_uses_captured_client: true, lost_ack_is_listable_without_replay: true,
      same_intent_replay_posts: 0, revocation_blocks_result_get: true, host_cancel_recovery_listable_without_replay: true,
      startup_network_calls: startupNetworkCalls, external_network_calls: 0, billing_calls: counters.billing_calls,
      source_runtime_usable: source.runtime_usable, source_dispatch_allowed: source.dispatch_allowed,
      source_backend_acceptance: source.backend_acceptance, provider_acceptance: "UNPROVEN", local_synthetic_only: true,
      default_off_auth_store_close_returned_void: defaultOffAuthCloseReturnedVoid });
  } catch (error) {
    if (error instanceof Video2AudioFlowInstalledCheckError) failureCode = error.code;
    else {
      const name = error && typeof error.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,31}$/u.test(error.name)
        ? error.name.toUpperCase() : "UNKNOWN";
      const code = error && typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(error.code) ? `_${error.code}` : "";
      failureCode = `INSTALLED_VIDEO2AUDIO_SYNTHETIC_${name}${code}_FAILED`;
    }
  } finally {
    if (offClient !== undefined) { try { await offClient.close(); cleanup.default_off_client_closed = true; } catch { cleanup.default_off_client_closed = false; } }
    if (offServer !== undefined) { try { await offServer.close(); cleanup.default_off_server_closed = true; } catch { cleanup.default_off_server_closed = false; } }
    if (offRuntime !== undefined) {
      try {
        const closeResult = offRuntime.authStore.close?.();
        defaultOffAuthCloseReturnedVoid = closeResult === undefined;
        await Promise.resolve(closeResult);
        cleanup.default_off_auth_store_closed = true;
      } catch { cleanup.default_off_auth_store_closed = false; }
    }
    if (runtime !== undefined && linkedAttempts.size > 0) {
      let allRevoked = typeof runtime.linkService?.revoke === "function";
      if (allRevoked) {
        for (const attemptId of linkedAttempts) {
          try {
            const before = await runtime.authStore.getSnapshot(runtime.authBinding, attemptId);
            if (before.status !== "REVOKED") await runtime.linkService.revoke(runtime.authBinding, attemptId);
            if ((await runtime.authStore.getSnapshot(runtime.authBinding, attemptId)).status !== "REVOKED") allRevoked = false;
          } catch { allRevoked = false; }
        }
      }
      cleanup.unlinks_confirmed = allRevoked;
    }
    if (client !== undefined) { try { await client.close(); cleanup.client_closed = true; } catch { cleanup.client_closed = false; } }
    if (server !== undefined) { try { await server.close(); cleanup.server_closed = true; } catch { cleanup.server_closed = false; } }
    const canDrain = runtime !== undefined && (linkedAttempts.size === 0 || cleanup.unlinks_confirmed === true);
    if (canDrain) {
      try { await runtime.ownerVideo2AudioLifecycle.close(); cleanup.video2audio_lifecycle_closed = true; }
      catch { cleanup.video2audio_lifecycle_closed = false; }
      if (cleanup.video2audio_lifecycle_closed === true) {
        try {
          if (typeof runtime.authStore.close !== "function") throw new Error("AUTH_STORE_CLOSE_UNAVAILABLE");
          const closeResult = runtime.authStore.close();
          authStoreCloseReturnedVoid = closeResult === undefined;
          await Promise.resolve(closeResult);
          cleanup.auth_store_closed = true;
        } catch { cleanup.auth_store_closed = false; }
      }
    }
  }
  const cleanupComplete = (runtime === undefined || ((linkedAttempts.size === 0 || cleanup.unlinks_confirmed === true) &&
    cleanup.video2audio_lifecycle_closed === true && cleanup.auth_store_closed === true)) &&
    (client === undefined || cleanup.client_closed === true) && (server === undefined || cleanup.server_closed === true) &&
    (offClient === undefined || cleanup.default_off_client_closed === true) &&
    (offServer === undefined || cleanup.default_off_server_closed === true) &&
    (offRuntime === undefined || cleanup.default_off_auth_store_closed === true);
  if (!cleanupComplete) {
    if (runtime !== undefined && linkedAttempts.size > 0 && cleanup.unlinks_confirmed !== true) fail("INSTALLED_VIDEO2AUDIO_UNLINK_CLEANUP_FAILED");
    if (runtime !== undefined && (linkedAttempts.size === 0 || cleanup.unlinks_confirmed === true) && cleanup.video2audio_lifecycle_closed !== true) {
      fail("INSTALLED_VIDEO2AUDIO_LIFECYCLE_CLEANUP_FAILED");
    }
    if (runtime !== undefined && (linkedAttempts.size === 0 || cleanup.unlinks_confirmed === true) && cleanup.auth_store_closed !== true) {
      fail("INSTALLED_VIDEO2AUDIO_AUTH_STORE_CLEANUP_FAILED");
    }
    if (client !== undefined && cleanup.client_closed !== true) fail("INSTALLED_VIDEO2AUDIO_CLIENT_CLEANUP_FAILED");
    if (server !== undefined && cleanup.server_closed !== true) fail("INSTALLED_VIDEO2AUDIO_SERVER_CLEANUP_FAILED");
    fail("INSTALLED_VIDEO2AUDIO_CLEANUP_FAILED");
  }
  if (failureCode !== undefined) fail(failureCode);
  if (proof === undefined) fail("INSTALLED_VIDEO2AUDIO_SYNTHETIC_PROOF_MISSING");
  return Object.freeze({ ...proof, cleanup: Object.freeze(cleanup), auth_store_close_returned_void: authStoreCloseReturnedVoid });
}

export function formatVideo2AudioInstalledSummary(proof) {
  if (!proof || !["INSTALLED_STOCK_SDK_VIDEO2AUDIO_SYNTHETIC_CALLTOOL_PASS", "ISOLATED_VIDEO2AUDIO_SYNTHETIC_CALLTOOL_PASS"].includes(proof.status) ||
      proof.node_version !== "24.21.0" || proof.sdk_version !== "1.32.1" ||
      proof.clean_installed_package !== (proof.package_provenance === "npm-packed-installed") ||
      proof.cleanup?.unlinks_confirmed !== true || proof.cleanup?.video2audio_lifecycle_closed !== true ||
      proof.cleanup?.client_closed !== true || proof.cleanup?.server_closed !== true || proof.cleanup?.auth_store_closed !== true ||
      proof.cleanup?.default_off_client_closed !== true || proof.cleanup?.default_off_server_closed !== true ||
      proof.cleanup?.default_off_auth_store_closed !== true ||
      proof.auth_store_close_returned_void !== true || proof.default_off_auth_store_close_returned_void !== true ||
      !sameArray(proof.tool_names, TOOL_NAMES) || proof.default_off_tool_count !== 0 ||
      proof.synthetic_generation_posts !== 5 || proof.synthetic_upload_posts !== 5 || proof.synthetic_chats !== 5 ||
      proof.synthetic_unknown_post_count !== 1 || proof.synthetic_host_cancel_posts !== 1 || proof.synthetic_model_access_reads !== 10 ||
      proof.synthetic_account_reads !== 20 ||
      proof.startup_network_calls !== 0 || proof.external_network_calls !== 0 || proof.billing_calls !== 0 ||
      proof.local_page_size !== 64 || proof.known_ack_after_ttl_uses_captured_client !== true ||
      proof.lost_ack_is_listable_without_replay !== true || proof.same_intent_replay_posts !== 0 ||
      proof.revocation_blocks_result_get !== true || proof.host_cancel_recovery_listable_without_replay !== true ||
      proof.source_runtime_usable !== false || proof.source_dispatch_allowed !== false || proof.source_backend_acceptance !== "UNPROVEN" ||
      proof.provider_acceptance !== "UNPROVEN" || proof.local_synthetic_only !== true) {
    fail("INSTALLED_VIDEO2AUDIO_SUMMARY_INVALID");
  }
  return `video2audio_installed=${proof.status} node=${proof.node_version} sdk=${proof.sdk_version} ` +
    `clean_package=${proof.clean_installed_package} model=${proof.model} tools=${proof.tool_names.length} default_off_tools=${proof.default_off_tool_count} ` +
    `synthetic_uploads=${proof.synthetic_upload_posts} chats=${proof.synthetic_chats} generation_posts=${proof.synthetic_generation_posts} ` +
    `lost_ack_posts=${proof.synthetic_unknown_post_count} host_cancel_posts=${proof.synthetic_host_cancel_posts} ` +
    `history_gets=${proof.synthetic_history_gets} result_gets=${proof.synthetic_result_gets} account_reads=${proof.synthetic_account_reads} ` +
    `model_access_reads=${proof.synthetic_model_access_reads} ` +
    `startup_network=${proof.startup_network_calls} external_network=${proof.external_network_calls} billing=${proof.billing_calls} ` +
    `unlink=${proof.cleanup.unlinks_confirmed} lifecycle_close=${proof.cleanup.video2audio_lifecycle_closed} ` +
    `client_close=${proof.cleanup.client_closed} server_close=${proof.cleanup.server_closed} auth_close=${proof.cleanup.auth_store_closed} ` +
    `default_off_close=${proof.cleanup.default_off_client_closed}/${proof.cleanup.default_off_server_closed}/${proof.cleanup.default_off_auth_store_closed} ` +
    `provider_acceptance=${proof.source_backend_acceptance}`;
}

async function linkSyntheticAttempt(runtime, attemptId, expiresAtMs, linkedAttempts) {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: expiresAtMs });
  linkedAttempts.add(attemptId);
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

async function loadConsumerSdk(consumerPath) {
  const require = createRequire(join(consumerPath, "package.json"));
  const manifest = JSON.parse(await readFile(join(consumerPath, "node_modules/@modelcontextprotocol/sdk/package.json"), "utf8"));
  if (manifest?.name !== "@modelcontextprotocol/sdk" || manifest?.version !== "1.32.1") fail("INSTALLED_VIDEO2AUDIO_SDK_VERSION_MISMATCH");
  const resolveModule = (path) => pathToFileURL(require.resolve(path)).href;
  const [{ Client }, { InMemoryTransport }] = await Promise.all([
    import(resolveModule("@modelcontextprotocol/sdk/client/index.js")),
    import(resolveModule("@modelcontextprotocol/sdk/inMemory.js"))
  ]);
  return Object.freeze({ Client, InMemoryTransport, version: manifest.version });
}

function readStructured(result, code) {
  if (result?.isError === true || !result?.structuredContent) fail(code);
  return result.structuredContent;
}

function readSafeError(result) {
  if (result?.isError !== true) return undefined;
  const text = Array.isArray(result.content) ? result.content.find((item) => item?.type === "text")?.text : undefined;
  try {
    const payload = JSON.parse(text ?? "{}");
    return payload?.error && typeof payload.error.code === "string" && /^[A-Z0-9_]{1,96}$/u.test(payload.error.code)
      ? { code: payload.error.code, recovery_id: typeof payload.error.recovery_id === "string" ? payload.error.recovery_id : undefined }
      : undefined;
  } catch { return undefined; }
}

function assertInputSchema(schema, required, optional = []) {
  if (!schema || schema.type !== "object" || schema.additionalProperties !== false ||
      !sameArray(Object.keys(schema.properties ?? {}).sort(), [...required, ...optional].sort()) ||
      !sameArray([...(schema.required ?? [])].sort(), [...required].sort())) fail("INSTALLED_VIDEO2AUDIO_INPUT_SCHEMA_INVALID");
}

function parseBody(value, code) {
  try { return JSON.parse(String(value)); } catch { fail(code); }
}

function sameKeys(value, expected) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    actual.every((item, index) => isDeepStrictEqual(item, expected[index]));
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function withDeadline(promise, milliseconds, code) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

function fail(code) { throw new Video2AudioFlowInstalledCheckError(code); }
