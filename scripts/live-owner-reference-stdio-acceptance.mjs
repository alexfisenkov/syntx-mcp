#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadGenerationContractRegistryV2 } from "../dist/src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../dist/src/catalog/selected-discovery-catalog.js";
import { getOwnerImageReferenceCandidateStoreBinding } from "../dist/src/application/owner-image-reference-request-preparer.js";
import { observeOwnedImageArtifact } from "../dist/src/adapter/syntx/owned-image-artifact-observer.js";

export const OWNER_REFERENCE_STDIO_CASE_ID = "banana21-reference-stdio-134";
export const OWNER_REFERENCE_STDIO_CASE_ID_152 = "banana21-reference-stdio-152";
export const OWNER_REFERENCE_STDIO_PROMPT_152 = "Use this simple reference as a loose visual guide for a cobalt-blue paper kite with a short orange tail over a soft green hill at dusk. Make one square image with no text.";
export const OWNER_REFERENCE_REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
export const OWNER_REFERENCE_TOOL_NAMES = Object.freeze([
  "syntx_upload_image_reference",
  "syntx_owner_generate_reference_image",
  "syntx_owner_reconcile_reference_image",
  "syntx_owner_list_reference_recovery"
]);

const CONFIRM_FLAG = "--confirm-owner-image-reference-stdio-acceptance";
const REAL_FLAG = "--real";
const CASE_FLAG = "--case";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_STDIO_SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const PNG_MIME = "image/png";
const IMAGE_FILENAME = "owner-reference-fixture-stdio-134.png";
const PROMPT = "Use the supplied image as a gentle visual cue for a tiny sailboat on a quiet blue lake beneath a pale moon. Create one square image with no text.";
const IMAGE_FILENAME_152 = "owner-reference-fixture-stdio-152.png";
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const HANDLE_PATTERN = /^reference_[0-9a-f-]{36}$/u;
const RECOVERY_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const ACTION_WINDOW_MS = 15 * 60_000;
const LOGIN_TIMEOUT_MS = 3 * 60_000;
const LOGIN_POLL_MS = 2_500;
const TOOL_TIMEOUT_MS = 15_000;
const GENERATION_TIMEOUT_MS = 200_000;
const configs = new WeakSet();

export function parseOwnerImageReferenceStdioAcceptanceArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4 || argv[0] !== CONFIRM_FLAG || argv[1] !== REAL_FLAG ||
      argv[2] !== CASE_FLAG || argv[3] !== OWNER_REFERENCE_STDIO_CASE_ID_152) return null;
  const config = Object.freeze({ caseId: argv[3], mode: "REAL_OWNER_REFERENCE_STDIO_ACCEPTANCE" });
  configs.add(config);
  return config;
}

/** New deterministic synthetic 512×512 PNG; no user file or photo is read. */
export function createOwnerImageReferenceStdioFixture() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      let color = [178, 218, 235, 255];
      if (y >= 330) color = [54, 126, 158, 255];
      const moonX = 382;
      const moonY = 118;
      if ((x - moonX) ** 2 + (y - moonY) ** 2 <= 42 ** 2) color = [246, 220, 139, 255];
      const mountain = 294 - Math.floor(Math.abs(x - 280) * 0.35);
      if (y >= mountain && y < 350) color = [82, 151, 153, 255];
      if (y >= 366 && y <= 424 && Math.abs(x - 248) <= Math.floor((424 - y) * 0.38)) color = [241, 241, 225, 255];
      if (y >= 390 && y <= 429 && x >= 246 && x <= 250) color = [62, 69, 77, 255];
      if (y >= 426 && y <= 437 && x >= 220 && x <= 278) color = [37, 54, 68, 255];
      const offset = row + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== width * height * 4 || bytes.length >= 7 * 1024 * 1024) {
    throw new Error("REFERENCE_FIXTURE_INVALID");
  }
  return Object.freeze({ bytes, width, height, mimeType: PNG_MIME, filename: IMAGE_FILENAME,
    sha256: sha256(bytes) });
}

/** Separate fixed case-152 synthetic PNG; the archived 134 fixture remains unchanged above. */
export function createOwnerImageReferenceStdioFixture152() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      let color = [151, 171, 209, 255];
      if (y >= 332) color = [68, 131, 86, 255];
      if (y >= 332 + Math.floor(Math.abs(x - 256) * 0.06)) color = [78, 145, 91, 255];
      const kiteX = 244;
      const kiteY = 194;
      if (Math.abs(x - kiteX) + Math.abs(y - kiteY) <= 54) color = [27, 58, 166, 255];
      if (y >= 245 && y <= 320 && Math.abs(x - (kiteX + Math.floor((y - 245) * 0.21))) <= 4) color = [231, 117, 54, 255];
      for (const tailY of [262, 292, 318]) {
        const tailX = kiteX + Math.floor((tailY - 245) * 0.21);
        if (y >= tailY && y <= tailY + 10 && Math.abs(x - tailX) <= (tailY === 292 ? 9 : 7)) color = [244, 157, 75, 255];
      }
      const offset = row + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = color[3];
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", Buffer.concat([u32(width), u32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  const decoded = inspectFixturePng(bytes);
  if (decoded.width !== width || decoded.height !== height || decoded.rgbaBytes !== width * height * 4 || bytes.length >= 7 * 1024 * 1024) {
    throw new Error("REFERENCE_FIXTURE_INVALID");
  }
  return Object.freeze({ bytes, width, height, mimeType: PNG_MIME, filename: IMAGE_FILENAME_152,
    sha256: sha256(bytes) });
}

/** Uses the stock owner stdio executable and the actual SDK's StdioClientTransport by default. */
export async function runOwnerImageReferenceStdioAcceptance(config, io = process, dependencies = {}) {
  if (!config || typeof config !== "object" || !configs.has(config)) return summary("CONFIRMATION_REQUIRED");
  if (!(dependencies.isSourceCheckout?.() ?? isSourceCheckout())) return summary("SOURCE_CHECKOUT_REQUIRED");
  const sendPrivateIpc = dependencies.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const waitForPrivateAction = dependencies.waitForPrivateAction ?? (io === process
    ? (event, context, timeoutMs, signal) => defaultWaitForPrivateAction(io, event, context, timeoutMs, signal)
    : null);
  if (typeof sendPrivateIpc !== "function" || typeof waitForPrivateAction !== "function") return summary("PRIVATE_IPC_REQUIRED");

  const fixture = createOwnerImageReferenceStdioFixture152();
  const source = (dependencies.loadReferenceSource ?? loadReferenceSource)();
  const prompt = OWNER_REFERENCE_STDIO_PROMPT_152;
  const promptFingerprint = sha256(Buffer.from(prompt, "utf8"));
  const uploadParameters = Object.freeze({ case_id: config.caseId, filename: fixture.filename, mime_type: fixture.mimeType,
    bytes_sha256: fixture.sha256, width: fixture.width, height: fixture.height });
  const uploadParametersFingerprint = sha256(Buffer.from(canonicalJson(uploadParameters), "utf8"));
  const generationParameters = Object.freeze({ case_id: config.caseId, model_id: "banana-2.1",
    variant_id: "banana21-image-1k-minimal-square", operation_id: "generate-image",
    image_size: "1K", thinking_level: "minimal", aspect_ratio: "1:1", copies: 1,
    prompt_sha256: promptFingerprint, reference_handle_scoped: true });
  const generationParametersFingerprint = sha256(Buffer.from(canonicalJson(generationParameters), "utf8"));
  const intentFingerprint = sha256(Buffer.from(canonicalJson({
    case_id: config.caseId, registry_version: source.registryVersion, candidate_schema_hash: source.candidateSchemaHash,
    fixture_sha256: fixture.sha256, prompt_sha256: promptFingerprint,
    upload_parameters_sha256: uploadParametersFingerprint, generation_parameters_sha256: generationParametersFingerprint
  }), "utf8"));

  let session;
  let attemptId = null;
  const counters = { uploadCallCount: 0, generationCallCount: 0, recoveryCallCount: 0, recoveryDiscoveryCallCount: 0, retryCount: 0 };
  let localUnlinkStatus = "NOT_ATTEMPTED";
  let clientCloseStatus = "NOT_ATTEMPTED";
  let foreignDenialCallCount = 0;
  let status = "FAILED";
  let observedArtifact = null;
  let beginAcknowledged = false;
  const safeBase = {
    case_id: config.caseId,
    registry_version: source.registryVersion,
    source_fingerprint: source.sourceFingerprint,
    candidate_schema_hash: source.candidateSchemaHash,
    harness_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    fixture_sha256: fixture.sha256,
    fixture_width: fixture.width,
    fixture_height: fixture.height,
    prompt_sha256: promptFingerprint,
    upload_parameters_sha256: uploadParametersFingerprint,
    generation_parameters_sha256: generationParametersFingerprint,
    intent_fingerprint: intentFingerprint
  };
  const sendEvent = async (event, fields = {}) => {
    const ok = await safePrivateSend(sendPrivateIpc, { event, ...safeBase, ...fields });
    if (!ok) throw new Error("PRIVATE_IPC_UNKNOWN");
  };
  const waitAndSendIntent = async (event, fields, expectedAction) => {
    const result = await waitForActionThenEmit(waitForPrivateAction, event,
      { case_id: config.caseId, intent_fingerprint: intentFingerprint }, ACTION_WINDOW_MS,
      () => sendEvent(event, fields));
    return result?.action === expectedAction;
  };
  const counts = () => ({ upload_call_count: counters.uploadCallCount,
    generation_call_count: counters.generationCallCount, recovery_call_count: counters.recoveryCallCount,
    recovery_discovery_call_count: counters.recoveryDiscoveryCallCount,
    retry_count: counters.retryCount, foreign_denial_call_count: foreignDenialCallCount });

  try {
    session = await (dependencies.createOwnerClient ?? createDefaultOwnerClient)({
      command: process.execPath,
      args: [OWNER_STDIO_SERVER_PATH],
      cwd: PROJECT_ROOT,
      env: Object.freeze({ SYNTX_OWNER_IMAGE_REFERENCES: "1", SYNTX_OWNER_ACCOUNT_STATUS: "1" }),
      stderr: "pipe"
    }, dependencies.sdk ?? {});
    const client = session.client;
    const listed = await client.listTools({}, { timeout: TOOL_TIMEOUT_MS });
    const names = new Set(listed?.tools?.map((tool) => tool.name) ?? []);
    const required = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status", ...OWNER_REFERENCE_TOOL_NAMES];
    const referenceTools = [...names].filter((name) => name.includes("reference")).sort();
    if (required.some((name) => !names.has(name)) || names.has("syntx_owner_probe_image_reference") ||
        canonicalJson(referenceTools) !== canonicalJson([...OWNER_REFERENCE_TOOL_NAMES].sort())) throw new Error("REQUIRED_STOCK_REFERENCE_TOOLS_MISSING");

    const foreignDenied = await callTool(client, {
      name: OWNER_REFERENCE_TOOL_NAMES[0],
      arguments: { link_attempt_id: "link_unlinked_reference_stdio_134_000000000001", content_base64: fixture.bytes.toString("base64"),
        filename: fixture.filename, mime_type: fixture.mimeType }
    }, TOOL_TIMEOUT_MS);
    const foreignError = parseSafeToolError(foreignDenied);
    if (foreignDenied?.isError !== true || foreignError.code !== "REFERENCE_PRINCIPAL_NOT_LINKED") throw new Error("UNLINKED_ATTEMPT_NOT_DENIED");
    foreignDenialCallCount = 1;

    const begun = await callTool(client, { name: "syntx_begin_login", arguments: {} }, TOOL_TIMEOUT_MS);
    attemptId = safeIdentifier(begun?.structuredContent?.attempt_id, ATTEMPT_PATTERN);
    const handoffUri = begun?.content?.find((item) => item.type === "resource_link")?.uri;
    if (begun?.isError === true || attemptId === null || !isSafeHandoffUri(handoffUri)) throw new Error("BEGIN_UNAVAILABLE");
    const handoffWaiter = waitForActionThenEmit(waitForPrivateAction, "BEGIN", { attempt_id: attemptId }, 45_000,
      () => sendEvent("BEGIN", { attempt_id: attemptId, handoff_uri: handoffUri }));
    beginAcknowledged = (await handoffWaiter)?.action === "handoff_sent";
    if (!beginAcknowledged) throw new Error("HANDOFF_ACK_MISSING");

    if (!await pollLinkedAttempt(client, attemptId, dependencies)) throw new Error("AUTH_NOT_LINKED");
    const account = await callTool(client, { name: "syntx_get_account_status", arguments: { link_attempt_id: attemptId } }, TOOL_TIMEOUT_MS);
    if (!isActivePaidAccount(account)) throw new Error("SUBSCRIPTION_NOT_VERIFIED");
    await sendEvent("PREFLIGHT", { account_status: "ACTIVE_READBACK", foreign_attempt_denied: true });

    const uploadCallFingerprint = sha256(Buffer.from(canonicalJson({ ...uploadParameters, link_attempt_id: attemptId }), "utf8"));
    const generationCallFingerprint = (referenceHandle) => sha256(Buffer.from(canonicalJson({
      link_attempt_id: attemptId, reference_handle: referenceHandle, prompt_sha256: promptFingerprint
    }), "utf8"));

    const operation = await runReferenceTools({
      client, attemptId, fixture, uploadParameters, generationParametersFingerprint, waitAndSendIntent,
      waitForPrivateAction, sendEvent, dependencies, counters, counts, uploadCallFingerprint, generationCallFingerprint
    });
    status = operation.status;
    observedArtifact = operation.observedArtifact;
  } catch (error) {
    status = statusForError(error);
  } finally {
    if (attemptId !== null && session?.client) localUnlinkStatus = await unlinkAndReadBack(session.client, attemptId);
    if (session) {
      try {
        await session.client.close();
        clientCloseStatus = await session.waitForExit() === true ? "CLOSED" : "UNCONFIRMED";
      }
      catch { clientCloseStatus = "UNCONFIRMED"; }
    }
  }
  if (status === "PASS_EXACT_RESULT_ONLY" &&
      (localUnlinkStatus !== "REVOKED_READBACK_CONFIRMED" || clientCloseStatus !== "CLOSED")) {
    status = "PASS_CLEANUP_UNCONFIRMED";
  }

  const fields = {
    ...counts(),
    status,
    local_unlink_status: localUnlinkStatus,
    client_close_status: clientCloseStatus,
    result_mime: observedArtifact?.mime,
    result_sha256: observedArtifact?.sha256,
    result_byte_size: observedArtifact?.byte_size,
    result_width: observedArtifact?.width,
    result_height: observedArtifact?.height,
    begin_acknowledged: beginAcknowledged
  };
  const stdoutText = JSON.stringify(fields);
  const stdoutHasPrivateData = stdoutText.includes("https://") || stdoutText.includes(prompt) || stdoutText.includes(fixture.bytes.toString("base64")) ||
    (attemptId !== null && stdoutText.includes(attemptId));
  return summary(status, { ...fields, stdout_includes_private_data: stdoutHasPrivateData });

}

async function runReferenceTools({ client, attemptId, fixture, uploadParameters, generationParametersFingerprint,
  waitAndSendIntent, waitForPrivateAction, sendEvent, dependencies, counters, counts,
  uploadCallFingerprint, generationCallFingerprint }) {
  if (!await waitAndSendIntent("UPLOAD_INTENT", {
    upload_call_count: 0, generation_call_count: 0, retry_count: 0, upload_parameters: uploadParameters,
    upload_tool_parameters_sha256: uploadCallFingerprint
  }, "approve_upload")) return { status: "UPLOAD_NOT_APPROVED", observedArtifact: null };

  counters.uploadCallCount += 1;
  let upload;
  try {
    upload = await callTool(client, {
      name: OWNER_REFERENCE_TOOL_NAMES[0],
      arguments: { link_attempt_id: attemptId, content_base64: fixture.bytes.toString("base64"),
        filename: fixture.filename, mime_type: fixture.mimeType }
    }, TOOL_TIMEOUT_MS);
  } catch {
    return { status: "UPLOAD_OUTCOME_UNKNOWN", observedArtifact: null };
  }
  if (upload?.isError === true) {
    const failure = parseSafeToolError(upload);
    return { status: failure.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN" ? "UPLOAD_OUTCOME_UNKNOWN" : "UPLOAD_FAILED", observedArtifact: null };
  }
  const referenceHandle = safeIdentifier(upload?.structuredContent?.reference_handle, HANDLE_PATTERN);
  if (referenceHandle === null || upload.structuredContent?.status !== "accepted") return { status: "UPLOAD_RECEIPT_INVALID", observedArtifact: null };

  if (!await waitAndSendIntent("GENERATION_INTENT", {
    upload_call_count: counters.uploadCallCount, generation_call_count: 0, retry_count: 0,
    generation_parameters_sha256: generationParametersFingerprint, model_id: "banana-2.1",
    variant_id: "banana21-image-1k-minimal-square", operation_id: "generate-image",
    generation_tool_parameters_sha256: generationCallFingerprint(referenceHandle),
      fixed_profile: { image_size: "1K", thinking_level: "minimal", aspect_ratio: "1:1", copies: 1 }
  }, "approve_generation")) return { status: "GENERATION_NOT_APPROVED", observedArtifact: null };
  counters.generationCallCount += 1;
  let generated;
  let generationReplyUnknown = false;
  try {
    generated = await callTool(client, {
      name: OWNER_REFERENCE_TOOL_NAMES[1],
      arguments: { link_attempt_id: attemptId, reference_handle: referenceHandle, prompt: OWNER_REFERENCE_STDIO_PROMPT_152 }
    }, GENERATION_TIMEOUT_MS);
  } catch { generationReplyUnknown = true; }
  let result = generated;
  if (generationReplyUnknown) {
    const discovered = await discoverUniqueRecovery(client, attemptId, counters);
    if (discovered.status !== "ONE_MATCH") {
      await sendEvent("OUTCOME_UNKNOWN_UNRECOVERABLE", {
        ...counts(), recovery_discovery_status: discovered.status, recovery_window: "OPEN", retry_count: 0
      });
      return { status: "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE", observedArtifact: null };
    }
    const recovery = await reconcileKnownRecovery(client, attemptId, discovered.recoveryId, waitForPrivateAction, sendEvent, counts, dependencies, counters);
    if (recovery.finished || recovery.result === null) return { status: "GENERATION_OUTCOME_UNKNOWN", observedArtifact: null };
    result = recovery.result;
  } else if (generated?.isError === true) {
    const failure = parseSafeToolError(generated);
    const recoveryId = safeIdentifier(failure.recoveryId, RECOVERY_PATTERN);
    if (failure.code !== "OUTCOME_UNKNOWN") {
      return { status: "GENERATION_FAILED", observedArtifact: null };
    }
    const discovered = recoveryId === null ? await discoverUniqueRecovery(client, attemptId, counters) : null;
    const knownRecoveryId = recoveryId ?? discovered?.recoveryId;
    if (!knownRecoveryId || !RECOVERY_PATTERN.test(knownRecoveryId)) {
      await sendEvent("OUTCOME_UNKNOWN_UNRECOVERABLE", {
        ...counts(), recovery_discovery_status: discovered?.status ?? "NOT_REQUIRED_HANDLE_INVALID",
        recovery_window: "OPEN", retry_count: 0
      });
      return { status: "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE", observedArtifact: null };
    }
    const recovery = await reconcileKnownRecovery(client, attemptId, knownRecoveryId, waitForPrivateAction, sendEvent, counts, dependencies, counters);
    counters.recoveryCallCount = recovery.recoveryCallCount;
    if (recovery.finished || recovery.result === null) return { status: "GENERATION_OUTCOME_UNKNOWN", observedArtifact: null };
    result = recovery.result;
  }
  const output = result?.structuredContent;
  if (result?.isError === true || output?.model_id !== "banana-2.1" || output?.operation_id !== "generate-image" ||
      output?.variant_id !== "banana21-image-1k-minimal-square" || output?.status !== "result_observed" ||
      !Array.isArray(output?.artifacts) || output.artifacts.length !== 1 || output.artifacts[0]?.mime_type !== "image/jpeg") {
    return { status: "REFERENCE_RESULT_SHAPE_INVALID", observedArtifact: null };
  }
  const observer = dependencies.observeOwnedImageArtifact ?? observeOwnedImageArtifact;
  const observedArtifact = await observer({ artifacts: output.artifacts });
  if (observedArtifact?.status !== "OBSERVED" || observedArtifact.mime !== "image/jpeg") {
    return { status: "RESULT_OBSERVATION_UNKNOWN", observedArtifact: null };
  }
  if (!await waitAndSendIntent("FINISH_INTENT", {
    upload_call_count: counters.uploadCallCount, generation_call_count: counters.generationCallCount,
    recovery_call_count: counters.recoveryCallCount, retry_count: counters.retryCount, result_mime: observedArtifact.mime,
    result_sha256: observedArtifact.sha256, result_byte_size: observedArtifact.byte_size,
    result_width: observedArtifact.width, result_height: observedArtifact.height
  }, "finish")) return { status: "FINISH_NOT_CONFIRMED", observedArtifact };
  return { status: "PASS_EXACT_RESULT_ONLY", observedArtifact };
}

export async function createDefaultOwnerClient(childOptions, sdk = {}) {
  const loaded = sdk.Client && sdk.StdioClientTransport ? null : await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const Client = sdk.Client ?? loaded[0].Client;
  const StdioClientTransport = sdk.StdioClientTransport ?? loaded[1].StdioClientTransport;
  const transport = new StdioClientTransport(childOptions);
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "syntx-owner-reference-stdio-acceptance", version: "1.0.0" });
  let resolveExit;
  const exited = new Promise((resolvePromise) => { resolveExit = resolvePromise; });
  const priorOnClose = transport.onclose;
  transport.onclose = () => { try { priorOnClose?.(); } finally { resolveExit(true); } };
  try { await client.connect(transport); }
  catch {
    await transport.close().catch(() => undefined);
    throw new Error("OWNER_STDIO_STARTUP_FAILED");
  }
  const childPid = transport.pid;
  return { client, transport, waitForExit: async () => {
    if (!Number.isSafeInteger(childPid) || childPid <= 0) return false;
    let timer;
    try {
      const closed = await Promise.race([exited, new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), 15_000); timer.unref?.(); })]);
      return closed === true && transport.pid === null;
    } finally { if (timer !== undefined) clearTimeout(timer); }
  } };
}

async function discoverUniqueRecovery(client, attemptId, counters) {
  counters.recoveryDiscoveryCallCount += 1;
  let listed;
  try {
    listed = await callTool(client, { name: OWNER_REFERENCE_TOOL_NAMES[3],
      arguments: { link_attempt_id: attemptId, limit: 20 } }, TOOL_TIMEOUT_MS);
  } catch { return { status: "LIST_UNKNOWN", recoveryId: null }; }
  const recoveries = listed?.structuredContent?.recoveries;
  if (listed?.isError === true || !Array.isArray(recoveries)) return { status: "LIST_UNAVAILABLE", recoveryId: null };
  if (recoveries.length !== 1) return { status: recoveries.length === 0 ? "NONE" : "AMBIGUOUS", recoveryId: null };
  const only = recoveries[0];
  if (only?.model_id !== "banana-2.1" || only?.operation_id !== "generate-image" ||
      only?.variant_id !== "banana21-image-1k-minimal-square") return { status: "PROFILE_MISMATCH", recoveryId: null };
  const recoveryId = safeIdentifier(only.recovery_id, RECOVERY_PATTERN);
  return recoveryId === null ? { status: "ID_INVALID", recoveryId: null } : { status: "ONE_MATCH", recoveryId };
}

function waitForActionThenEmit(waitForPrivateAction, event, context, timeoutMs, emit) {
  const controller = new AbortController();
  let pending;
  try { pending = Promise.resolve(waitForPrivateAction(event, context, timeoutMs, controller.signal)); }
  catch (error) { controller.abort(); throw error; }
  const observed = pending.catch(() => null);
  return (async () => {
    try { await emit(); }
    catch (error) { controller.abort(); void observed; throw error; }
    return observed;
  })();
}

async function reconcileKnownRecovery(client, attemptId, recoveryId, waitForPrivateAction, sendEvent, counts, dependencies, counters) {
  const now = dependencies.now ?? Date.now;
  const deadline = now() + ACTION_WINDOW_MS;
  let recoveryCallCount = 0;
  while (now() < deadline) {
    const action = await waitForActionThenEmit(waitForPrivateAction, "RECOVERY_ACTION",
      { attempt_id: attemptId, recovery_id: recoveryId }, Math.max(1, deadline - now()),
      () => sendEvent("OUTCOME_UNKNOWN", { ...counts(), recovery_id: recoveryId, recovery_window: "OPEN", retry_count: 0 }));
    if (!action || action.action === "finish") return { result: null, recoveryCallCount, finished: true };
    if (action.action !== "reconcile") continue;
    recoveryCallCount += 1;
    counters.recoveryCallCount = recoveryCallCount;
    let response;
    try {
      response = await callTool(client, { name: OWNER_REFERENCE_TOOL_NAMES[2],
        arguments: { link_attempt_id: attemptId, recovery_id: recoveryId } }, TOOL_TIMEOUT_MS);
    } catch { continue; }
    if (response?.isError !== true && response?.structuredContent?.status === "result_observed") {
      return { result: response, recoveryCallCount, finished: false };
    }
  }
  return { result: null, recoveryCallCount, finished: true };
}

function loadReferenceSource() {
  const catalogDirectory = resolve(PROJECT_ROOT, "catalog");
  const registry = loadGenerationContractRegistryV2(OWNER_REFERENCE_REGISTRY_VERSION, catalogDirectory);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const binding = getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
  if (registry.registry_sha256 !== "sha256:2f8cf81a41efece59008a919924975cbd2e379569784565b7643f2a225a017fd") throw new Error("REFERENCE_SOURCE_PIN_MISMATCH");
  return Object.freeze({ registryVersion: OWNER_REFERENCE_REGISTRY_VERSION, candidateSchemaHash: binding.schema_hash,
    sourceFingerprint: sha256(Buffer.from(canonicalJson({ registry: registry.registry_sha256, catalog: registry.catalog_version,
      source: registry.source_hashes }), "utf8")) });
}

function isSourceCheckout() {
  return existsSync(join(PROJECT_ROOT, "AGENTS.md")) && existsSync(join(PROJECT_ROOT, "src")) &&
    existsSync(join(PROJECT_ROOT, "catalog", "generation-contracts-v2", OWNER_REFERENCE_REGISTRY_VERSION)) &&
    existsSync(OWNER_STDIO_SERVER_PATH);
}

async function pollLinkedAttempt(client, attemptId, dependencies) {
  const now = dependencies.now ?? Date.now;
  const wait = dependencies.sleep ?? delay;
  const deadline = now() + LOGIN_TIMEOUT_MS;
  while (now() < deadline) {
    await wait(LOGIN_POLL_MS);
    const checked = await callTool(client, { name: "syntx_check_login", arguments: { attempt_id: attemptId } }, TOOL_TIMEOUT_MS);
    const value = checked?.structuredContent;
    if (checked?.isError === true || value?.attempt_id !== attemptId) return false;
    if (value.status === "LINKED" && value.linked === true) return true;
    if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(value.status)) return false;
  }
  return false;
}

async function unlinkAndReadBack(client, attemptId) {
  try {
    const unlink = await callTool(client, { name: "syntx_unlink", arguments: { attempt_id: attemptId } }, TOOL_TIMEOUT_MS);
    if (unlink?.isError === true || unlink?.structuredContent?.status !== "REVOKED") return "UNCONFIRMED";
    const checked = await callTool(client, { name: "syntx_check_login", arguments: { attempt_id: attemptId } }, TOOL_TIMEOUT_MS);
    return checked?.isError !== true && checked?.structuredContent?.attempt_id === attemptId &&
      checked?.structuredContent?.status === "REVOKED" && checked?.structuredContent?.linked === false
      ? "REVOKED_READBACK_CONFIRMED" : "UNCONFIRMED";
  } catch { return "UNCONFIRMED"; }
}

async function callTool(client, request, timeout) {
  return client.callTool(request, undefined, { timeout });
}

function parseSafeToolError(result) {
  try {
    const value = JSON.parse(result?.content?.find((item) => item.type === "text")?.text ?? "{}");
    return { code: typeof value?.error?.code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/u.test(value.error.code) ? value.error.code : "TOOL_ERROR",
      recoveryId: typeof value?.error?.recovery_id === "string" && RECOVERY_PATTERN.test(value.error.recovery_id) ? value.error.recovery_id : null };
  } catch { return { code: "TOOL_ERROR", recoveryId: null }; }
}

function isActivePaidAccount(result) {
  const subscription = result?.structuredContent?.subscription;
  return result?.isError !== true && subscription?.active === true && typeof subscription.plan_type === "string" &&
    subscription.plan_type.trim().length > 0 && subscription.plan_type.trim().toUpperCase() !== "FREE";
}

function safeIdentifier(value, pattern) { return typeof value === "string" && pattern.test(value) ? value : null; }
function isSafeHandoffUri(value) {
  try { const url = new URL(value); return url.protocol === "https:" && ["t.me", "telegram.me"].includes(url.hostname) && !url.username && !url.password; }
  catch { return false; }
}
function safePrivateSend(send, message) { return Promise.resolve().then(() => send(message, 5_000)).then((result) => result === true, () => false); }
function summary(status, fields = {}) { const { status: _ignored, ...safe } = fields; return Object.freeze({ status, ...safe }); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function isSourceInvocation() { return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; }

function defaultSendPrivateIpc(message, timeoutMs) {
  if (typeof process.send !== "function") return Promise.resolve(false);
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs); timer.unref?.();
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(value); };
    try { process.send(message, (error) => finish(error == null)); } catch { finish(false); }
  });
}

function defaultWaitForPrivateAction(io, event, context, timeoutMs, signal) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); io.off("message", onMessage); signal?.removeEventListener("abort", onAbort); resolvePromise(value); };
    const onMessage = (message) => {
      if (!message || typeof message !== "object") return;
      if (event === "BEGIN" && message.action === "handoff_sent" && message.attempt_id === context.attempt_id) finish(message);
      else if (event === "UPLOAD_INTENT" && message.action === "approve_upload" && message.intent_fingerprint === context.intent_fingerprint) finish(message);
      else if (event === "GENERATION_INTENT" && message.action === "approve_generation" && message.intent_fingerprint === context.intent_fingerprint) finish(message);
      else if (event === "FINISH_INTENT" && message.action === "finish" && message.intent_fingerprint === context.intent_fingerprint) finish(message);
      else if (event === "RECOVERY_ACTION" && ["reconcile", "finish"].includes(message.action) && message.attempt_id === context.attempt_id && message.recovery_id === context.recovery_id) finish(message);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs); timer.unref?.();
    io.on("message", onMessage); signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
function statusForError(error) {
  if (error?.message === "REQUIRED_STOCK_REFERENCE_TOOLS_MISSING") return "STOCK_REFERENCE_TOOLS_MISSING";
  if (error?.message === "UNLINKED_ATTEMPT_NOT_DENIED") return "FOREIGN_ATTEMPT_NOT_DENIED";
  if (error?.message === "HANDOFF_ACK_MISSING") return "HANDOFF_NOT_CONFIRMED";
  if (error?.message === "AUTH_NOT_LINKED") return "AUTH_NOT_LINKED";
  if (error?.message === "SUBSCRIPTION_NOT_VERIFIED") return "SUBSCRIPTION_NOT_VERIFIED";
  return "FAILED";
}

function inspectFixturePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("REFERENCE_FIXTURE_INVALID");
  let offset = 8; let width = 0; let height = 0; const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error("REFERENCE_FIXTURE_INVALID");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (pngCrc(Buffer.concat([Buffer.from(type), data])) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("REFERENCE_FIXTURE_INVALID");
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") compressed.push(data);
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (offset !== bytes.length || compressed.length === 0) throw new Error("REFERENCE_FIXTURE_INVALID");
  return { width, height, rgbaBytes: inflateSync(Buffer.concat(compressed)).length - height };
}
function pngChunk(type, data) { const typeBytes = Buffer.from(type, "ascii"); return Buffer.concat([u32(data.length), typeBytes, data, u32(pngCrc(Buffer.concat([typeBytes, data])))]); }
function pngCrc(data) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; } return (crc ^ 0xffffffff) >>> 0; }
function u32(value) { const result = Buffer.alloc(4); result.writeUInt32BE(value); return result; }

if (isSourceInvocation()) {
  const config = parseOwnerImageReferenceStdioAcceptanceArgs(process.argv.slice(2));
  if (!config) {
    process.stderr.write(`Refusing owner reference stdio acceptance. Select exactly ${CONFIRM_FLAG} ${REAL_FLAG} ${CASE_FLAG} ${OWNER_REFERENCE_STDIO_CASE_ID_152}.\n`);
    process.exitCode = 2;
  } else {
    const sendPrivateIpc = typeof process.send === "function"
      ? (message, timeoutMs) => defaultSendPrivateIpc(message, timeoutMs)
      : undefined;
    const result = await runOwnerImageReferenceStdioAcceptance(config, process, {
      ...(sendPrivateIpc ? { sendPrivateIpc } : {}),
      waitForPrivateAction: (event, context, timeoutMs, signal) => defaultWaitForPrivateAction(process, event, context, timeoutMs, signal)
    }).catch(() => summary("FAILED"));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.status.startsWith("PASS")) process.exitCode = 1;
  }
}
