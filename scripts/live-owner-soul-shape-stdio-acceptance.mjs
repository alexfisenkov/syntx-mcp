#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { types } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OWNER_SOUL_SHAPE_CASE_ID = "soul-shape-styles-characters";
export const OWNER_SOUL_SHAPE_FULL_CASE_ID = "soul-shape-full-styles-characters";
export const OWNER_SOUL_SHAPE_KINDS = Object.freeze(["styles", "characters"]);
export const OWNER_SOUL_SHAPE_TOOL_NAME = "syntx_inspect_owner_soul_catalog_shape";
export const OWNER_SOUL_SHAPE_CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

const CONFIRM_FLAG = "--confirm-owner-soul-shape-stdio-acceptance";
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const START_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const OWNER_ENV = Object.freeze({ SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1" });
const TOOL_TIMEOUT_MS = 15_000;
const BEGIN_ACK_MS = 45_000;
const SHAPE_ACK_MS = 45_000;
const LOGIN_TIMEOUT_MS = 180_000;
const LOGIN_POLL_MS = 2_500;
const CHILD_CLOSE_TIMEOUT_MS = 15_000;
const DEFAULT_SAMPLING_LIMIT = 20;
const FULL_SAMPLING_LIMIT = 128;
const FULL_OWNER_ENV = Object.freeze({ SYNTX_OWNER_SOUL_CATALOG_SHAPE: "1", SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS: "128" });
const ALLOWED_ERROR_CODES = new Set([
  "INVALID_REQUEST", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH", "SERVICE_BUSY", "SERVICE_CLOSED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"
]);
const SAFE_FIELD_KEYS = Object.freeze([
  "items", "data", "styles", "characters", "list", "results", "value", "style_id", "lora_id",
  "reference_id", "id", "name", "image", "status", "model_type", "total", "page", "page_size", "has_more",
  "next", "count"
]);
const ARRAY_CONTAINER_KEYS = new Set(["items", "data", "styles", "characters", "list", "results"]);
const SHAPE_TYPES = new Set(["null", "object", "array", "string", "number", "boolean"]);
const configurations = new WeakSet();

export function parseOwnerSoulShapeStdioAcceptanceArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4 || argv[0] !== CONFIRM_FLAG || argv[1] !== "--real" || argv[2] !== "--case") return null;
  const samplingLimit = argv[3] === OWNER_SOUL_SHAPE_CASE_ID ? DEFAULT_SAMPLING_LIMIT
    : argv[3] === OWNER_SOUL_SHAPE_FULL_CASE_ID ? FULL_SAMPLING_LIMIT : null;
  if (samplingLimit === null) return null;
  const config = Object.freeze({ caseId: argv[3], samplingLimit });
  configurations.add(config);
  return config;
}

export function parseOwnerSoulShapeSummary(value, expectedKind, samplingLimit = DEFAULT_SAMPLING_LIMIT) {
  if (samplingLimit !== DEFAULT_SAMPLING_LIMIT && samplingLimit !== FULL_SAMPLING_LIMIT) return null;
  const record = exactRecord(value, ["model_id", "catalog_version", "confidence_scope", "generation_allowed",
    "backend_acceptance", "kind", "outcome", "response_bytes", "top_level", "items"]);
  if (!record || record.model_id !== "higgsfield-soul" || record.catalog_version !== OWNER_SOUL_SHAPE_CATALOG_VERSION ||
      record.confidence_scope !== "owner_authenticated_fixed_route_shape_only" || record.generation_allowed !== false ||
      record.backend_acceptance !== "unproven" || record.kind !== expectedKind ||
      !["SHAPE_OBSERVED", "EMPTY_INCONCLUSIVE", "UNRECOGNIZED_SHAPE"].includes(record.outcome) ||
      !boundedInt(record.response_bytes, 0, 65_536)) return null;
  const top = parseLevel(record.top_level, 4096, DEFAULT_SAMPLING_LIMIT);
  const itemRecord = exactRecord(record.items, ["container_key", "item_count", "inspected_count", "truncated", "value_types", "fields", "unknown_key_count"]);
  if (!top || !itemRecord || !(itemRecord.container_key === null || ARRAY_CONTAINER_KEYS.has(itemRecord.container_key)) ||
      !boundedInt(itemRecord.item_count, 0, 100_000) || !boundedInt(itemRecord.inspected_count, 0, samplingLimit) ||
      itemRecord.inspected_count > itemRecord.item_count || typeof itemRecord.truncated !== "boolean" ||
      itemRecord.truncated !== (itemRecord.item_count > itemRecord.inspected_count) ||
      !boundedInt(itemRecord.unknown_key_count, 0, 4096 * samplingLimit)) return null;
  const valueTypes = parseTypeArray(itemRecord.value_types);
  const fields = parseFields(itemRecord.fields, samplingLimit);
  if (!valueTypes || !fields) return null;
  if ((record.outcome === "SHAPE_OBSERVED" && itemRecord.item_count === 0) ||
      (record.outcome === "EMPTY_INCONCLUSIVE" && (itemRecord.item_count !== 0 || itemRecord.truncated)) ||
      (record.outcome === "UNRECOGNIZED_SHAPE" && (itemRecord.container_key !== null || itemRecord.item_count !== 0))) return null;
  return Object.freeze({
    kind: expectedKind,
    sampling_limit: samplingLimit,
    outcome: record.outcome,
    response_bytes: record.response_bytes,
    top_level: top,
    items: Object.freeze({
      container_key: itemRecord.container_key,
      item_count: itemRecord.item_count,
      inspected_count: itemRecord.inspected_count,
      truncated: itemRecord.truncated,
      value_types: valueTypes,
      fields,
      unknown_key_count: itemRecord.unknown_key_count
    })
  });
}

export async function runOwnerSoulShapeStdioAcceptance(config, io = process, dependencies = {}) {
  if (!config || typeof config !== "object" || !configurations.has(config)) return summary("CONFIRMATION_REQUIRED");
  if (!(dependencies.isSourceCheckout?.() ?? isSourceCheckout())) return summary("SOURCE_CHECKOUT_REQUIRED", { case_id: config.caseId, sampling_limit: config.samplingLimit });
  const privateSend = dependencies.sendPrivateIpc ?? (io === process ? defaultSendPrivateIpc : null);
  const waitAction = dependencies.waitForPrivateAction ?? (io === process ?
    (event, context, timeout, signal) => defaultWaitForPrivateAction(io, event, context, timeout, signal) : null);
  if (typeof privateSend !== "function" || typeof waitAction !== "function") return summary("PRIVATE_IPC_REQUIRED", { case_id: config.caseId, sampling_limit: config.samplingLimit });

  let session;
  let attemptId = null;
  let beginAcknowledged = false;
  let status = "FAILED";
  let failureStage = null;
  let failureCode = null;
  let localUnlink = "NOT_ATTEMPTED";
  let clientClose = "NOT_ATTEMPTED";
  let childClose = "NOT_ATTEMPTED";
  const reads = [];
  const calls = { shape: 0, upload: 0, generation: 0, training: 0, delete: 0 };
  try {
    session = await (dependencies.createOwnerClient ?? createDefaultOwnerClient)({
      command: process.execPath,
      args: [SERVER_PATH],
      cwd: PROJECT_ROOT,
      env: ownerEnvFor(config),
      stderr: "pipe"
    }, dependencies.sdk ?? {});
    const listed = await callToolList(session.client);
    if (!requiredToolSurface(listed)) {
      status = "SOUL_SHAPE_TOOL_MISSING";
      failureStage = "TOOL_LIST";
      failureCode = "TOOL_SURFACE_INVALID";
    } else {
      const begin = await callTool(session.client, "syntx_begin_login", {}, TOOL_TIMEOUT_MS);
      attemptId = safeAttempt(begin?.structuredContent?.attempt_id);
      const handoffUri = begin?.content?.find((part) => part?.type === "resource_link")?.uri;
      if (begin?.isError === true || !attemptId || !isSafeHandoffUri(handoffUri)) {
        status = "BEGIN_UNAVAILABLE";
        failureStage = "BEGIN";
        failureCode = begin?.isError === true ? parseToolError(begin) : "BEGIN_RESPONSE_INVALID";
      } else {
        const beginFingerprint = sha256(canonicalJson({
          case_id: config.caseId, attempt_id: attemptId, sampling_limit: config.samplingLimit,
          catalog_version: OWNER_SOUL_SHAPE_CATALOG_VERSION,
          read_kinds: OWNER_SOUL_SHAPE_KINDS
        }));
        const beginAck = await waitAndEmit(waitAction, "BEGIN", { attempt_id: attemptId, intent_fingerprint: beginFingerprint },
          BEGIN_ACK_MS, () => emitPrivate(privateSend, "BEGIN", {
            case_id: config.caseId, attempt_id: attemptId, intent_fingerprint: beginFingerprint,
            handoff_uri: handoffUri, read_kinds: OWNER_SOUL_SHAPE_KINDS, sampling_limit: config.samplingLimit,
            catalog_version: OWNER_SOUL_SHAPE_CATALOG_VERSION
          }));
        if (!beginAck) {
          status = "BEGIN_NOT_CONFIRMED";
          failureStage = "BEGIN_ACK";
          failureCode = "PRIVATE_ACK_INVALID";
        } else {
          beginAcknowledged = true;
          if (!await pollLinked(session.client, attemptId, dependencies)) {
            status = "AUTH_NOT_LINKED";
            failureStage = "AUTH";
            failureCode = "ATTEMPT_NOT_LINKED";
          } else {
            for (const [index, kind] of OWNER_SOUL_SHAPE_KINDS.entries()) {
              const fingerprint = sha256(canonicalJson({ case_id: config.caseId, attempt_id: attemptId,
                kind, index, sampling_limit: config.samplingLimit, catalog_version: OWNER_SOUL_SHAPE_CATALOG_VERSION }));
              const confirmed = await waitAndEmit(waitAction, "SOUL_SHAPE_INTENT", {
                attempt_id: attemptId, intent_fingerprint: fingerprint, kind
              }, SHAPE_ACK_MS, () => emitPrivate(privateSend, "SOUL_SHAPE_INTENT", {
                case_id: config.caseId, attempt_id: attemptId, intent_fingerprint: fingerprint,
                kind, read_index: index + 1, sampling_limit: config.samplingLimit,
                catalog_version: OWNER_SOUL_SHAPE_CATALOG_VERSION
              }));
              if (!confirmed) {
                status = "SHAPE_READ_NOT_CONFIRMED";
                failureStage = "SHAPE_ACK";
                failureCode = "PRIVATE_ACK_INVALID";
                break;
              }
              calls.shape += 1;
              let response;
              try { response = await callTool(session.client, OWNER_SOUL_SHAPE_TOOL_NAME,
                { link_attempt_id: attemptId, kind }, TOOL_TIMEOUT_MS); }
              catch {
                status = "SOUL_SHAPE_READ_FAILED";
                failureStage = "SHAPE_READ";
                failureCode = "TOOL_CALL_FAILED";
                break;
              }
              if (response?.isError === true) {
                status = "SOUL_SHAPE_READ_FAILED";
                failureStage = "SHAPE_READ";
                failureCode = parseToolError(response);
                break;
              }
              const shape = parseOwnerSoulShapeSummary(response?.structuredContent, kind, config.samplingLimit);
              if (shape === null) {
                status = "SOUL_SHAPE_OUTPUT_INVALID";
                failureStage = "SHAPE_OUTPUT";
                failureCode = "OUTPUT_SCHEMA_INVALID";
                break;
              }
              reads.push(shape);
            }
            if (failureStage === null) status = "PASS_SHAPE_DIAGNOSTIC_ONLY";
          }
        }
      }
    }
  } catch {
    status = "FAILED";
    failureStage ??= "HARNESS";
    failureCode ??= "HARNESS_FAILED";
  } finally {
    if (attemptId && session?.client) localUnlink = await unlinkAndReadBack(session.client, attemptId);
    if (session) {
      try {
        await session.client.close();
        clientClose = "CLOSED";
      } catch { clientClose = "UNCONFIRMED"; }
      try { childClose = await session.waitForExit() === true ? "CLOSED" : "UNCONFIRMED"; }
      catch { childClose = "UNCONFIRMED"; }
    }
  }
  if (status === "PASS_SHAPE_DIAGNOSTIC_ONLY" &&
      (localUnlink !== "REVOKED_READBACK_CONFIRMED" || clientClose !== "CLOSED" || childClose !== "CLOSED")) {
    status = "PASS_CLEANUP_UNCONFIRMED";
  }
  const result = {
    case_id: config.caseId, sampling_limit: config.samplingLimit, status, ...(failureStage ? { failure_stage: failureStage } : {}),
    ...(failureCode ? { failure_code: failureCode } : {}), begin_acknowledged: beginAcknowledged,
    reads: Object.freeze(reads), calls: Object.freeze(calls), local_unlink_status: localUnlink,
    client_close_status: clientClose, child_close_status: childClose,
    mutation_calls: Object.freeze({ upload: 0, generation: 0, training: 0, delete: 0 })
  };
  return Object.freeze(result);
}

function parseLevel(value, maxUnknown, maxOccurrences) {
  const record = exactRecord(value, ["fields", "unknown_key_count"]);
  if (!record || !boundedInt(record.unknown_key_count, 0, maxUnknown)) return null;
  const fields = parseFields(record.fields, maxOccurrences);
  if (fields === null) return null;
  return Object.freeze({ fields, unknown_key_count: record.unknown_key_count });
}

function parseFields(value, maxOccurrences) {
  const record = plainRecord(value);
  if (!record) return null;
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !SAFE_FIELD_KEYS.includes(key)) return null;
    const field = exactRecord(record[key], ["types", "occurrences"]);
    const fieldTypes = field ? parseTypeArray(field.types) : null;
    if (!field || !fieldTypes || fieldTypes.length < 1 || !boundedInt(field.occurrences, 1, maxOccurrences)) return null;
    output[key] = Object.freeze({ types: fieldTypes, occurrences: field.occurrences });
  }
  return Object.freeze(output);
}

function ownerEnvFor(config) {
  return config.samplingLimit === FULL_SAMPLING_LIMIT ? FULL_OWNER_ENV : OWNER_ENV;
}

function parseTypeArray(value) {
  const values = dataArray(value, 6);
  if (values === null || values.some((item) => typeof item !== "string" || !SHAPE_TYPES.has(item)) ||
      new Set(values).size !== values.length) return null;
  return Object.freeze(values.slice());
}

function exactRecord(value, keys) {
  const record = plainRecord(value);
  if (!record) return null;
  const actual = Reflect.ownKeys(record);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !keys.includes(key))) return null;
  return record;
}

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]) || !descriptors[key].enumerable)) return null;
  const copy = Object.create(null);
  for (const key of keys) copy[key] = descriptors[key].value;
  return copy;
}

function dataArray(value, maximum) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : -1;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(descriptors).length !== length + 1) return null;
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    result.push(descriptor.value);
  }
  return result;
}

function boundedInt(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function requiredToolSurface(result) {
  const toolEntries = dataArray(result?.tools, 500);
  if (result?.isError === true || toolEntries === null) return false;
  const names = toolEntries.map((tool) => typeof tool?.name === "string" ? tool.name : "");
  return ["syntx_begin_login", "syntx_check_login", "syntx_unlink", OWNER_SOUL_SHAPE_TOOL_NAME].every((name) => names.includes(name));
}

async function pollLinked(client, attemptId, dependencies) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? delay;
  const deadline = now() + LOGIN_TIMEOUT_MS;
  while (now() < deadline) {
    const result = await callTool(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS).catch(() => null);
    const value = result?.structuredContent;
    if (result?.isError === true || value?.attempt_id !== attemptId) return false;
    if (value.status === "LINKED" && value.linked === true) return true;
    if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(value.status)) return false;
    await sleep(Math.min(LOGIN_POLL_MS, Math.max(1, deadline - now())));
  }
  return false;
}

async function unlinkAndReadBack(client, attemptId) {
  try {
    const unlink = await callTool(client, "syntx_unlink", { attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    if (unlink?.isError === true || unlink?.structuredContent?.status !== "REVOKED") return "UNCONFIRMED";
    const readback = await callTool(client, "syntx_check_login", { attempt_id: attemptId }, TOOL_TIMEOUT_MS);
    return readback?.isError !== true && readback?.structuredContent?.attempt_id === attemptId &&
      readback.structuredContent.status === "REVOKED" && readback.structuredContent.linked === false
      ? "REVOKED_READBACK_CONFIRMED" : "UNCONFIRMED";
  } catch { return "UNCONFIRMED"; }
}

async function createDefaultOwnerClient(options, sdk) {
  const { Client } = sdk.Client ? sdk : await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = sdk.StdioClientTransport ? sdk : await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "syntx-owner-soul-shape-acceptance", version: "1.0.0" }, { capabilities: {} });
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
}

async function callToolList(client) { return client.listTools({}, { timeout: TOOL_TIMEOUT_MS }); }
async function callTool(client, name, args, timeout) {
  return client.callTool({ name, arguments: args }, undefined, { timeout });
}

function waitAndEmit(waitAction, event, context, timeout, emit) {
  const controller = new AbortController();
  let pending;
  try { pending = Promise.resolve(waitAction(event, context, timeout, controller.signal)); }
  catch (error) { controller.abort(); throw error; }
  const observed = pending.catch(() => null);
  return (async () => {
    let sent = false;
    try { sent = await emit(); }
    catch { sent = false; }
    if (!sent) { controller.abort(); void observed; return null; }
    const action = await observed;
    const expectedAction = event === "BEGIN" ? "handoff_sent" : "approve_read";
    if (!action || action.action !== expectedAction || action.attempt_id !== context.attempt_id ||
        action.intent_fingerprint !== context.intent_fingerprint || (context.kind && action.kind !== context.kind)) return null;
    return action;
  })();
}

function emitPrivate(send, event, fields) {
  return Promise.resolve().then(() => send({ event, ...fields }, 5_000)).then((value) => value === true, () => false);
}

function parseToolError(result) {
  const record = plainRecord(result);
  const content = record ? dataArray(record.content, 32) : null;
  if (!content) return "TOOL_ERROR";
  try {
    let text;
    for (const item of content) {
      const entry = plainRecord(item);
      if (entry?.type === "text" && typeof entry.text === "string") { text = entry.text; break; }
    }
    const parsedValue = JSON.parse(typeof text === "string" ? text : "{}");
    const parsed = plainRecord(parsedValue);
    const error = parsed ? plainRecord(parsed.error) : null;
    const code = error?.code;
    return typeof code === "string" && ALLOWED_ERROR_CODES.has(code) ? code : "TOOL_ERROR";
  } catch { return "TOOL_ERROR"; }
}

function safeAttempt(value) {
  return typeof value === "string" && ATTEMPT_PATTERN.test(value) ? value : null;
}

function isSafeHandoffUri(value) {
  try {
    const url = new URL(value);
    const entries = [...url.searchParams.entries()];
    return url.protocol === "https:" && url.hostname === "t.me" && url.port === "" && url.pathname === "/syntxaibot" &&
      !url.username && !url.password && !url.hash && entries.length === 1 && entries[0][0] === "start" &&
      START_TOKEN_PATTERN.test(entries[0][1]);
  } catch { return false; }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
function summary(status, fields = {}) { return Object.freeze({ status, ...fields }); }
function isSourceInvocation() { return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; }
function isSourceCheckout() { return existsSync(join(PROJECT_ROOT, "AGENTS.md")) && existsSync(SERVER_PATH); }

function defaultSendPrivateIpc(message, timeoutMs) {
  if (typeof process.send !== "function") return Promise.resolve(false);
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
      if (!message || typeof message !== "object") return;
      const expectedAction = event === "BEGIN" ? "handoff_sent" : "approve_read";
      if (message.action === expectedAction && message.attempt_id === context.attempt_id &&
          message.intent_fingerprint === context.intent_fingerprint && (context.kind === undefined || message.kind === context.kind)) finish(message);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    io.on("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

if (isSourceInvocation()) {
  const config = parseOwnerSoulShapeStdioAcceptanceArgs(process.argv.slice(2));
  if (!config) {
    process.stderr.write("Refusing owner Soul shape read. Use the exact fixed-case confirmation, --real, and --case.");
    process.exitCode = 2;
  } else {
    const result = await runOwnerSoulShapeStdioAcceptance(config, process).catch(() => summary("FAILED", {
      case_id: OWNER_SOUL_SHAPE_CASE_ID, failure_stage: "HARNESS", failure_code: "HARNESS_FAILED"
    }));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "PASS_SHAPE_DIAGNOSTIC_ONLY") process.exitCode = 1;
  }
}
