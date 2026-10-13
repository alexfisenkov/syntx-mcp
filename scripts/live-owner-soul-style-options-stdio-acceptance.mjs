#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { types } from "node:util";

export const OWNER_SOUL_STYLE_OPTIONS_CASE_ID = "soul-style-options-readonly";
export const OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME = "syntx_list_owner_soul_style_options";
export const OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
export const OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";

const CONFIRM_FLAG = "--confirm-owner-soul-style-options-stdio-acceptance";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const OWNER_ENV = Object.freeze({ SYNTX_OWNER_SOUL_STYLE_OPTIONS: "1" });
const HANDLE_PATTERN = /^soul_style_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const CONFIGS = new WeakSet();
const TOOL_TIMEOUT_MS = 15_000;
const BEGIN_ACK_MS = 45_000;
const READ_ACK_MS = 45_000;
const LOGIN_TIMEOUT_MS = 180_000;
const LOGIN_POLL_MS = 2_500;
const CHILD_CLOSE_TIMEOUT_MS = 15_000;
const SAFE_FAILURE_CODES = new Set([
  "INVALID_REQUEST", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "SERVICE_CLOSED",
  "SNAPSHOT_SUPERSEDED", "CAPACITY_EXCEEDED", "SOURCE_SNAPSHOT_INVALID", "OPTION_HANDLE_NOT_FOUND",
  "OPTION_HANDLE_EXPIRED", "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED",
  "UPSTREAM_PROTOCOL_ERROR", "TOOL_ERROR", "HARNESS_FAILED"
]);

export function parseOwnerSoulStyleOptionsStdioAcceptanceArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4 || argv[0] !== CONFIRM_FLAG ||
      argv[1] !== "--real" || argv[2] !== "--case" || argv[3] !== OWNER_SOUL_STYLE_OPTIONS_CASE_ID) return null;
  const config = Object.freeze({ caseId: OWNER_SOUL_STYLE_OPTIONS_CASE_ID });
  CONFIGS.add(config);
  return config;
}

export function runOwnerSoulStyleOptionsStdioAcceptance(config, io = process, dependencies = {}) {
  if (!config || typeof config !== "object" || !CONFIGS.has(config)) return Promise.resolve(summary("CONFIRMATION_REQUIRED"));
  if (!(dependencies.isSourceCheckout?.() ?? isSourceCheckout())) {
    return Promise.resolve(summary("SOURCE_CHECKOUT_REQUIRED", { case_id: config.caseId }));
  }
  const privateSend = dependencies.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const waitAction = dependencies.waitForPrivateAction ?? (io === process ?
    (event, context, timeout, signal) => defaultWaitForPrivateAction(io, event, context, timeout, signal) : null);
  if (typeof privateSend !== "function" || typeof waitAction !== "function") {
    return Promise.resolve(summary("PRIVATE_IPC_REQUIRED", { case_id: config.caseId }));
  }
  return executeOwnerSoulStyleOptionsRead(config, io, dependencies, privateSend, waitAction);
}

async function executeOwnerSoulStyleOptionsRead(config, io, dependencies, privateSend, waitAction) {
  let session;
  let attemptId = null;
  let finalStatus = "FAILED";
  let failureCode = null;
  let localUnlinkStatus = "NOT_ATTEMPTED";
  let clientCloseStatus = "NOT_ATTEMPTED";
  let childCloseStatus = "NOT_ATTEMPTED";
  const calls = { list_tools: 0, begin_login: 0, check_login: 0, style_options: 0, unlink: 0,
    upload: 0, generation: 0, training: 0, delete: 0, shape: 0 };
  let safeResult = null;
  try {
    session = await (dependencies.createOwnerClient ?? createDefaultOwnerClient)({
      command: process.execPath,
      args: [SERVER_PATH],
      cwd: PROJECT_ROOT,
      env: OWNER_ENV,
      stderr: "pipe"
    }, dependencies.sdk ?? {});

    calls.list_tools += 1;
    const listed = await (dependencies.callToolList ?? callToolList)(session.client);
    if (!requiredToolSurface(listed)) {
      finalStatus = "STYLE_OPTIONS_TOOL_MISSING";
      return finishAfterCleanup();
    }

    calls.begin_login += 1;
    const begin = await (dependencies.callTool ?? callTool)(session.client, "syntx_begin_login", {}, TOOL_TIMEOUT_MS);
    const beginRecord = safeRecord(begin);
    const beginContent = beginRecord ? readArray(beginRecord.content, 32) : null;
    const beginData = beginRecord ? safeRecord(beginRecord.structuredContent) : null;
    attemptId = safeAttempt(beginData?.attempt_id);
    const handoffUri = beginContent?.map(safeRecord).find((part) => part?.type === "resource_link")?.uri;
    if (beginRecord?.isError === true || !attemptId || !isSafeHandoffUri(handoffUri)) {
      finalStatus = "BEGIN_UNAVAILABLE";
      failureCode = beginRecord?.isError === true ? safeToolErrorCode(begin) : null;
      return finishAfterCleanup();
    }

    const beginFingerprint = sha256(canonicalJson({
      case_id: config.caseId,
      attempt_id: attemptId,
      tool_name: OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME,
      catalog_version: OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION,
      source_mapping_sha256: OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256
    }));
    const beginAck = await waitAndEmit(waitAction, privateSend, "BEGIN", {
      case_id: config.caseId,
      attempt_id: attemptId,
      intent_fingerprint: beginFingerprint,
      handoff_uri: handoffUri,
      tool_name: OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME,
      catalog_version: OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION,
      source_mapping_sha256: OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256
    }, { attempt_id: attemptId, intent_fingerprint: beginFingerprint }, BEGIN_ACK_MS);
    if (!beginAck) {
      finalStatus = "BEGIN_NOT_CONFIRMED";
      return finishAfterCleanup();
    }

    const linked = await pollLinked(session.client, attemptId, dependencies, calls);
    if (!linked) {
      finalStatus = "AUTH_NOT_LINKED";
      return finishAfterCleanup();
    }

    const readFingerprint = sha256(canonicalJson({
      case_id: config.caseId,
      attempt_id: attemptId,
      tool_name: OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME,
      catalog_version: OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION,
      source_mapping_sha256: OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256,
      read: "styles",
      ordinal: 1
    }));
    const readAck = await waitAndEmit(waitAction, privateSend, "READ_INTENT", {
      case_id: config.caseId,
      attempt_id: attemptId,
      intent_fingerprint: readFingerprint,
      tool_name: OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME,
      kind: "styles",
      catalog_version: OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION,
      source_mapping_sha256: OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256
    }, { attempt_id: attemptId, intent_fingerprint: readFingerprint }, READ_ACK_MS);
    if (!readAck) {
      finalStatus = "READ_NOT_CONFIRMED";
      return finishAfterCleanup();
    }

    calls.style_options += 1;
    let response;
    try {
      response = await (dependencies.callTool ?? callTool)(session.client, OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME,
        { link_attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    } catch {
      finalStatus = "STYLE_OPTIONS_READ_FAILED";
      failureCode = "TOOL_ERROR";
      return finishAfterCleanup();
    }
    if (isToolError(response)) {
      finalStatus = "STYLE_OPTIONS_READ_FAILED";
      failureCode = safeToolErrorCode(response);
      return finishAfterCleanup();
    }

    safeResult = parseOwnerSoulStyleOptionsOutput(safeRecord(response)?.structuredContent);
    if (safeResult === null) {
      finalStatus = "STYLE_OPTIONS_OUTPUT_INVALID";
      return finishAfterCleanup();
    }
    finalStatus = "PASS_READONLY_STYLE_OPTIONS_DIAGNOSTIC";
  } catch {
    finalStatus = "HARNESS_FAILED";
    failureCode = "HARNESS_FAILED";
  }

  return finishAfterCleanup();

  async function finishAfterCleanup() {
    if (attemptId && session?.client) {
      calls.unlink += 1;
      localUnlinkStatus = await unlinkAndReadBack(session.client, attemptId, dependencies, calls);
    }
    if (session) {
      try {
        await session.client.close();
        clientCloseStatus = "CLOSED";
      } catch { clientCloseStatus = "UNCONFIRMED"; }
      try { childCloseStatus = await session.waitForExit() === true ? "CLOSED" : "UNCONFIRMED"; }
      catch { childCloseStatus = "UNCONFIRMED"; }
    }
    if (finalStatus === "PASS_READONLY_STYLE_OPTIONS_DIAGNOSTIC" &&
        (localUnlinkStatus !== "REVOKED_READBACK_CONFIRMED" || clientCloseStatus !== "CLOSED" || childCloseStatus !== "CLOSED")) {
      finalStatus = "PASS_CLEANUP_UNCONFIRMED";
    }
    return buildSafeSummary(finalStatus, config.caseId, safeResult, calls, {
      local_unlink_status: localUnlinkStatus,
      client_close_status: clientCloseStatus,
      child_close_status: childCloseStatus
    }, failureCode);
  }
}

export function parseOwnerSoulStyleOptionsOutput(value) {
  const record = exactRecord(value, ["status", "model_id", "catalog_version", "confidence_scope", "source_reviewed",
    "source_mapping_sha256", "generation_allowed", "expires_in_seconds", "options", "summary"]);
  if (!record || record.status !== "OPTIONS_ISSUED" || record.model_id !== "higgsfield-soul" ||
      record.catalog_version !== OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION ||
      record.confidence_scope !== "owner_authenticated_source_reviewed_style_options" ||
      record.source_reviewed !== true || record.source_mapping_sha256 !== OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256 ||
      record.generation_allowed !== false || record.expires_in_seconds !== 300) return null;
  const options = readArray(record.options, 128);
  const summaryValue = parseAdapterSummary(record.summary);
  if (!options || options.length < 1 || !summaryValue || summaryValue.record_count !== options.length) return null;
  const seenHandles = new Set();
  for (const rawOption of options) {
    const option = exactRecord(rawOption, ["style_handle", "label"]);
    if (!option || typeof option.style_handle !== "string" || !HANDLE_PATTERN.test(option.style_handle) ||
        seenHandles.has(option.style_handle) || !isSafeLabel(option.label)) return null;
    seenHandles.add(option.style_handle);
  }
  return Object.freeze({
    model_id: record.model_id,
    catalog_version: record.catalog_version,
    confidence_scope: record.confidence_scope,
    source_reviewed: true,
    source_mapping_sha256: record.source_mapping_sha256,
    generation_allowed: false,
    expires_in_seconds: 300,
    option_count: options.length,
    summary: summaryValue
  });
}

function parseAdapterSummary(value) {
  const record = exactRecord(value, ["route", "response_bytes", "record_count", "total_matches", "unique_ids",
    "fields_valid", "unknown_top_level_key_count", "unknown_item_key_count", "style_id_utf8_bytes", "name_utf8_bytes"]);
  if (!record || record.route !== "hf/lora/styles" || !boundedInt(record.response_bytes, 0, 65_536) ||
      !boundedInt(record.record_count, 1, 128) || record.total_matches !== true || record.unique_ids !== true ||
      record.fields_valid !== true || !boundedInt(record.unknown_top_level_key_count, 0, 64) ||
      !boundedInt(record.unknown_item_key_count, 0, 128 * 64)) return null;
  const styleIdLengths = parseByteRange(record.style_id_utf8_bytes, 256);
  const nameLengths = parseByteRange(record.name_utf8_bytes, 256);
  if (!styleIdLengths || !nameLengths) return null;
  return Object.freeze({
    route: record.route,
    response_bytes: record.response_bytes,
    record_count: record.record_count,
    total_matches: true,
    unique_ids: true,
    fields_valid: true,
    unknown_top_level_key_count: record.unknown_top_level_key_count,
    unknown_item_key_count: record.unknown_item_key_count,
    style_id_utf8_bytes: styleIdLengths,
    name_utf8_bytes: nameLengths
  });
}

function parseByteRange(value, maximum) {
  const range = exactRecord(value, ["min", "max"]);
  if (!range || !boundedInt(range.min, 1, maximum) || !boundedInt(range.max, 1, maximum) || range.min > range.max) return null;
  return Object.freeze({ min: range.min, max: range.max });
}

function isSafeLabel(value) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 256 &&
    !CONTROL_CHARACTERS.test(value);
}

function buildSafeSummary(status, caseId, result, calls, cleanup, failureCode) {
  const output = {
    case_id: caseId,
    status,
    model_id: "higgsfield-soul",
    catalog_version: OWNER_SOUL_STYLE_OPTIONS_CATALOG_VERSION,
    confidence_scope: "owner_authenticated_source_reviewed_style_options",
    source_reviewed: true,
    source_mapping_sha256: OWNER_SOUL_STYLE_OPTIONS_SOURCE_MAPPING_SHA256,
    generation_allowed: false,
    expires_in_seconds: 300,
    option_count: result?.option_count ?? 0,
    summary: result?.summary ?? null,
    cleanup: Object.freeze({ ...cleanup }),
    calls: Object.freeze({ ...calls })
  };
  if (typeof failureCode === "string" && SAFE_FAILURE_CODES.has(failureCode)) output.failure_code = failureCode;
  return Object.freeze(output);
}

async function pollLinked(client, attemptId, dependencies, calls) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? delay;
  const deadline = now() + LOGIN_TIMEOUT_MS;
  while (now() < deadline) {
    calls.check_login += 1;
    let result;
    try { result = await (dependencies.callTool ?? callTool)(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS); }
    catch { return false; }
    const record = safeRecord(result);
    const value = record ? safeRecord(record.structuredContent) : null;
    if (!record || record.isError === true || !value || value.attempt_id !== attemptId) return false;
    if (value.status === "LINKED" && value.linked === true) return true;
    if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(value.status)) return false;
    await sleep(Math.min(LOGIN_POLL_MS, Math.max(1, deadline - now())));
  }
  return false;
}

async function unlinkAndReadBack(client, attemptId, dependencies, calls) {
  try {
    const call = dependencies.callTool ?? callTool;
    const unlink = safeRecord(await call(client, "syntx_unlink", { attempt_id: attemptId }, TOOL_TIMEOUT_MS));
    const unlinkState = unlink ? safeRecord(unlink.structuredContent) : null;
    if (!unlink || unlink.isError === true || unlinkState?.status !== "REVOKED") return "UNCONFIRMED";
    calls.check_login += 1;
    const readback = safeRecord(await call(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS));
    const state = readback ? safeRecord(readback.structuredContent) : null;
    return readback && readback.isError !== true && state?.attempt_id === attemptId &&
      state.status === "REVOKED" && state.linked === false ? "REVOKED_READBACK_CONFIRMED" : "UNCONFIRMED";
  } catch { return "UNCONFIRMED"; }
}

function requiredToolSurface(result) {
  const record = safeRecord(result);
  const toolEntries = record ? readArray(record.tools, 500) : null;
  if (!record || record.isError === true || !toolEntries) return false;
  const names = toolEntries.map((item) => safeRecord(item)?.name).filter((name) => typeof name === "string");
  return ["syntx_begin_login", "syntx_check_login", "syntx_unlink", OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME].every((name) => names.includes(name));
}

function safeToolErrorCode(result) {
  const record = safeRecord(result);
  const content = record ? readArray(record.content, 32) : null;
  if (!content) return "TOOL_ERROR";
  for (const part of content) {
    const entry = safeRecord(part);
    if (entry?.type !== "text" || typeof entry.text !== "string" || entry.text.length > 4096) continue;
    try {
      const parsed = safeRecord(JSON.parse(entry.text));
      const error = parsed ? safeRecord(parsed.error) : null;
      if (typeof error?.code === "string" && SAFE_FAILURE_CODES.has(error.code)) return error.code;
    } catch { /* never surface malformed/raw tool output */ }
  }
  return "TOOL_ERROR";
}

function isToolError(value) {
  return safeRecord(value)?.isError === true;
}

function safeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { return null; }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !descriptors[key].enumerable || !("value" in descriptors[key]))) return null;
  const result = Object.create(null);
  for (const key of keys) result[key] = descriptors[key].value;
  return result;
}

function exactRecord(value, expectedKeys) {
  const record = safeRecord(value);
  if (!record) return null;
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) return null;
  return record;
}

function readArray(value, maximum) {
  if (!Array.isArray(value) || types.isProxy(value)) return null;
  let prototype;
  let descriptors;
  try { prototype = Object.getPrototypeOf(value); descriptors = Object.getOwnPropertyDescriptors(value); }
  catch { return null; }
  if (prototype !== Array.prototype) return null;
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) return null;
  const entries = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    entries.push(descriptor.value);
  }
  return entries;
}

function boundedInt(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }

function waitAndEmit(waitAction, sendPrivateIpc, event, fields, context, timeout) {
  const controller = new AbortController();
  let pending;
  try { pending = Promise.resolve(waitAction(event, context, timeout, controller.signal)); }
  catch { controller.abort(); return Promise.resolve(null); }
  const observed = pending.catch(() => null);
  return (async () => {
    let sent = false;
    try { sent = await sendPrivateIpc({ event, ...fields }, 5_000) === true; }
    catch { sent = false; }
    if (!sent) { controller.abort(); void observed; return null; }
    const action = safeRecord(await observed);
    const expectedAction = event === "BEGIN" ? "handoff_sent" : "approve_read";
    return action && action.action === expectedAction && action.attempt_id === context.attempt_id &&
      action.intent_fingerprint === context.intent_fingerprint ? action : null;
  })();
}

function emitPrivate(send, message) {
  return Promise.resolve().then(() => send(message, 5_000)).then((value) => value === true, () => false);
}

function createDefaultOwnerClient(options, sdk) {
  return (async () => {
    const { Client } = sdk.Client ? sdk : await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = sdk.StdioClientTransport ? sdk : await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "syntx-owner-soul-style-options-acceptance", version: "1.0.0" }, { capabilities: {} });
    const transport = new StdioClientTransport(options);
    let resolveClosed;
    const closed = new Promise((resolvePromise) => { resolveClosed = resolvePromise; });
    const previousOnClose = transport.onclose;
    transport.onclose = () => { try { previousOnClose?.(); } finally { resolveClosed(true); } };
    try { await client.connect(transport); }
    catch { await transport.close().catch(() => undefined); throw new Error("OWNER_STDIO_STARTUP_FAILED"); }
    const initialPid = transport.pid;
    return Object.freeze({ client, async waitForExit() {
      if (!Number.isSafeInteger(initialPid) || initialPid <= 0) return false;
      let timer;
      try {
        const result = await Promise.race([closed, new Promise((resolvePromise) => {
          timer = setTimeout(() => resolvePromise(false), CHILD_CLOSE_TIMEOUT_MS);
          timer.unref?.();
        })]);
        return result === true && transport.pid === null;
      } finally { if (timer !== undefined) clearTimeout(timer); }
    } });
  })();
}

async function callToolList(client) { return client.listTools({}, { timeout: TOOL_TIMEOUT_MS }); }
async function callTool(client, name, args, timeout) { return client.callTool({ name, arguments: args }, undefined, { timeout }); }

async function defaultSendPrivateIpc(message, timeoutMs) {
  if (typeof process.send !== "function") return false;
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(value); };
    try { process.send(message, (error) => finish(error == null)); } catch { finish(false); }
  });
}

function defaultWaitForPrivateAction(io, event, context, timeoutMs, signal) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      io.off("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(value);
    };
    const onMessage = (message) => {
      const record = safeRecord(message);
      const expectedAction = event === "BEGIN" ? "handoff_sent" : "approve_read";
      if (record?.action === expectedAction && record.attempt_id === context.attempt_id &&
          record.intent_fingerprint === context.intent_fingerprint) finish(record);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    io.on("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function defaultMain() {
  const config = parseOwnerSoulStyleOptionsStdioAcceptanceArgs(process.argv.slice(2));
  const result = config
    ? await runOwnerSoulStyleOptionsStdioAcceptance(config)
    : Object.freeze({ case_id: null, status: "CONFIRMATION_REQUIRED" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = ["PASS_READONLY_STYLE_OPTIONS_DIAGNOSTIC", "PASS_CLEANUP_UNCONFIRMED"].includes(result.status) ? 0 : 1;
}

function isSourceInvocation() {
  return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

function isSourceCheckout() {
  return existsSync(join(PROJECT_ROOT, "AGENTS.md")) && existsSync(SERVER_PATH);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}`;
  return JSON.stringify(value);
}

function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function safeAttempt(value) { return typeof value === "string" && /^link_[A-Za-z0-9_-]{20,120}$/u.test(value) ? value : null; }
function isSafeHandoffUri(value) {
  try {
    const url = new URL(value);
    const entries = [...url.searchParams.entries()];
    return url.protocol === "https:" && url.hostname === "t.me" && url.port === "" && url.pathname === "/syntxaibot" &&
      !url.username && !url.password && !url.hash && entries.length === 1 && entries[0][0] === "start" &&
      /^[A-Za-z0-9_-]{8,128}$/u.test(entries[0][1]);
  } catch { return false; }
}
function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
function summary(status, fields = {}) { return Object.freeze({ case_id: OWNER_SOUL_STYLE_OPTIONS_CASE_ID, status, ...fields }); }

if (isSourceInvocation()) {
  defaultMain().catch(() => {
    process.stdout.write(`${JSON.stringify({ case_id: OWNER_SOUL_STYLE_OPTIONS_CASE_ID, status: "HARNESS_FAILED", failure_code: "HARNESS_FAILED" })}\n`);
    process.exitCode = 1;
  });
}
