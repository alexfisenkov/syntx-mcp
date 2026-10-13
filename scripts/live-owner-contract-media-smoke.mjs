#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSafeLiveOwnerMcpMediaSmokeReport } from "./live-owner-mcp-media-smoke.mjs";

const CONFIRM_FLAG = "--confirm-live-owner-contract-media-smoke";
const REGISTRY_VERSION_V1 = "sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json";
const REGISTRY_VERSION_V2 = "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json";
const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const OWNER_STDIO_SERVER_PATH = join(PROJECT_ROOT, "dist/src/transports/stdio-owner.js");
const HANDOFF_ACK_TIMEOUT_MS = 120_000;
const SMOKE_DEADLINE_MS = 9 * 60_000;
const LOGIN_CHECKS = 40;
const LOGIN_POLL_DELAY_MS = 1_000;
const MCP_SHORT_TIMEOUT_MS = 5_500;
const ACCOUNT_STATUS_TIMEOUT_MS = 12_000;
const GENERATION_TIMEOUT_MS = Object.freeze({ image: 190_000, video: 420_000 });
const PROFILES = Object.freeze({
  image: Object.freeze({
    modelId: "banana-2.1",
    operationId: "generate-image",
    expectedMime: "image/jpeg",
    prompt: "A minimal geometric still life of colored paper circles on a warm neutral tabletop, no text or people.",
    parameters: Object.freeze({ file_urls: Object.freeze([]) })
  }),
  video: Object.freeze({
    modelId: "seedance_pro-fast",
    operationId: "generate-video",
    expectedMime: "video/mp4",
    prompt: "A five-second geometric animation: three colored cubes slide slowly across a plain neutral background, no text or people.",
    parameters: Object.freeze({})
  })
});
const V2_VARIANT_IDS = Object.freeze({
  image: "banana21-image-1k-minimal-square",
  video: "seedance-pro-fast-video-720p-mini-16x9-5s-audio"
});
const validatedConfigs = new WeakSet();

/** Exact operator guard; model and operation are fixed by kind, never caller-selected. */
export function parseLiveOwnerContractMediaSmokeArgs(argv) {
  if (!Array.isArray(argv) || argv[0] !== CONFIRM_FLAG || argv[1] !== "--kind") return null;
  const kind = argv[2];
  if (kind !== "image" && kind !== "video") return null;
  let schemaVersion = "1.0.0";
  if (argv.length === 4 && argv[3] === "--handoff-json") {
    // Preserve the original v1 CLI as the default path.
  } else if (argv.length === 6 && argv[3] === "--schema-version" && argv[4] === "2.0.0" && argv[5] === "--handoff-json") {
    schemaVersion = "2.0.0";
  } else {
    return null;
  }
  const config = Object.freeze({
    kind,
    ...PROFILES[kind],
    schemaVersion,
    registryVersion: schemaVersion === "2.0.0" ? REGISTRY_VERSION_V2 : REGISTRY_VERSION_V1,
    ...(schemaVersion === "2.0.0" ? { variantId: V2_VARIANT_IDS[kind] } : {})
  });
  validatedConfigs.add(config);
  return config;
}

/** Test dependencies are optional and never accepted from CLI arguments. */
export async function runLiveOwnerContractMediaSmoke(config, io = process, dependencies = undefined, runtimeLoader = loadRuntimeDependencies) {
  if (config === null || typeof config !== "object" || !validatedConfigs.has(config)) {
    throw new Error("The live contract-media profile is not allowed.");
  }

  const loaded = dependencies ?? await runtimeLoader();
  const { Client, StdioClientTransport } = loaded;
  const wait = typeof loaded.wait === "function" ? loaded.wait : delay;
  const deadline = createDeadline(SMOKE_DEADLINE_MS);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [OWNER_STDIO_SERVER_PATH],
    cwd: PROJECT_ROOT,
    env: {
      SYNTX_OWNER_ACCOUNT_STATUS: "1",
      SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
      SYNTX_GENERATION_CONTRACT_VERSION: config.registryVersion,
      ...(config.schemaVersion === "2.0.0" ? { SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION: "2.0.0" } : {})
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "syntx-live-owner-contract-media-smoke", version: "1.0.0" });
  let attemptId = null;
  let generationCallStarted = false;
  let outcome = { status: "FAILED", artifact_count: 0, mime_types: [] };
  let localCleanupStatus = "NOT_ATTEMPTED";
  let clientClosed = false;
  let transportClosed = false;

  try {
    await client.connect(transport);
    const listed = await client.listTools({}, mcpOptions(deadline.signal, MCP_SHORT_TIMEOUT_MS));
    const names = new Set((listed.tools ?? []).map((tool) => tool.name));
    const requiredTools = [
      "syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status",
      "syntx_get_generation_schema", "syntx_validate_generation", "syntx_owner_generate_media"
    ];
    if (requiredTools.some((name) => !names.has(name))) {
      outcome = { status: "MCP_TOOLS_MISSING", artifact_count: 0, mime_types: [] };
    } else {
      const begun = await callTool(client, { name: "syntx_begin_login", arguments: {} }, deadline.signal, MCP_SHORT_TIMEOUT_MS);
      attemptId = boundedString(begun.structuredContent?.attempt_id, /^link_[A-Za-z0-9_-]{20,120}$/u);
      const handoffUri = begun.content?.find((item) => item.type === "resource_link")?.uri;
      if (begun.isError === true || attemptId === null || !isSafeHandoffUri(handoffUri)) {
        outcome = { status: "HANDOFF_FAILED", artifact_count: 0, mime_types: [] };
      } else {
        io.stdout.write(`${JSON.stringify({ event: "BEGIN", kind: config.kind, attempt_id: attemptId, handoff_uri: handoffUri })}\n`);
        if (!await waitForHandoffSent(io.stdin, deadline.signal, HANDOFF_ACK_TIMEOUT_MS)) {
          outcome = { status: "HANDOFF_NOT_CONFIRMED", artifact_count: 0, mime_types: [] };
        } else {
          const linked = await waitForLinkedAttempt(client, attemptId, deadline.signal, wait);
          if (!linked) {
            outcome = { status: "AUTH_NOT_LINKED", artifact_count: 0, mime_types: [] };
          } else {
            const account = await callTool(client, {
              name: "syntx_get_account_status",
              arguments: { link_attempt_id: attemptId }
            }, deadline.signal, ACCOUNT_STATUS_TIMEOUT_MS);
            if (!hasActivePaidSubscription(account)) {
              outcome = { status: "SUBSCRIPTION_NOT_VERIFIED", artifact_count: 0, mime_types: [] };
            } else {
              const parameters = { prompt: config.prompt, ...config.parameters };
              const schema = await callTool(client, {
                name: "syntx_get_generation_schema",
                arguments: {
                  model_id: config.modelId,
                  operation_id: config.operationId,
                  ...(config.variantId === undefined ? {} : { variant_id: config.variantId })
                }
              }, deadline.signal, MCP_SHORT_TIMEOUT_MS);
              if (!schemaMatchesExactLiveProfile(schema, config)) {
                outcome = { status: "SCHEMA_NOT_LIVE_VERIFIED", artifact_count: 0, mime_types: [] };
              } else {
                const validation = await callTool(client, {
                  name: "syntx_validate_generation",
                  arguments: {
                    model_id: config.modelId,
                    operation_id: config.operationId,
                    ...(config.variantId === undefined ? {} : { variant_id: config.variantId }),
                    parameters
                  }
                }, deadline.signal, MCP_SHORT_TIMEOUT_MS);
                if (!validationMatchesExactRequest(validation, config)) {
                  outcome = { status: "LOCAL_VALIDATION_FAILED", artifact_count: 0, mime_types: [] };
                } else {
                  generationCallStarted = true;
                  try {
                    const generated = await callTool(client, {
                      name: "syntx_owner_generate_media",
                      arguments: {
                        link_attempt_id: attemptId,
                        model_id: config.modelId,
                        operation_id: config.operationId,
                        ...(config.variantId === undefined ? {} : { variant_id: config.variantId }),
                        parameters
                      }
                    }, deadline.signal, GENERATION_TIMEOUT_MS[config.kind]);
                    outcome = summarizeGenerationResult(generated, config.expectedMime);
                  } catch {
                    outcome = { status: "OUTCOME_UNKNOWN", artifact_count: 0, mime_types: [], no_retry: true };
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch {
    outcome = generationCallStarted
      ? { status: "OUTCOME_UNKNOWN", artifact_count: 0, mime_types: [], no_retry: true }
      : { status: "FAILED", artifact_count: 0, mime_types: [] };
  } finally {
    deadline.cancel();
    if (attemptId !== null) localCleanupStatus = await unlinkAttempt(client, attemptId);
    try { await client.close(); clientClosed = true; } catch { /* Continue best-effort child closure. */ }
    try { await transport.close(); transportClosed = true; } catch { /* Final metadata remains redacted. */ }
    if (!clientClosed || !transportClosed) {
      localCleanupStatus = attemptId === null ? "NOT_ATTEMPTED" : "UNKNOWN";
    }
  }
  return { ...outcome, local_cleanup_status: localCleanupStatus };
}

export function buildSafeLiveOwnerContractMediaSmokeReport(result) {
  return buildSafeLiveOwnerMcpMediaSmokeReport(result);
}

function mcpOptions(signal, timeout) { return { signal, timeout, maxTotalTimeout: timeout }; }

async function callTool(client, request, signal, timeout) {
  return client.callTool(request, undefined, mcpOptions(signal, timeout));
}

async function loadRuntimeDependencies() {
  if (!existsSync(OWNER_STDIO_SERVER_PATH)) throw new Error("Owner stdio build is unavailable.");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  return { Client, StdioClientTransport };
}

function createDeadline(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("smoke deadline elapsed")), milliseconds);
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function waitForLinkedAttempt(client, attemptId, signal, wait) {
  for (let index = 0; index < LOGIN_CHECKS; index += 1) {
    await wait(index === 0 ? 1_500 : LOGIN_POLL_DELAY_MS, signal);
    const checked = await callTool(client, {
      name: "syntx_check_login",
      arguments: { attempt_id: attemptId }
    }, signal, MCP_SHORT_TIMEOUT_MS);
    if (checked.isError === true) return false;
    if (checked.structuredContent?.linked === true) return true;
    if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) return false;
  }
  return false;
}

function schemaMatchesExactLiveProfile(result, config) {
  if (result.isError === true) return false;
  const value = result.structuredContent;
  const exactVariant = config.schemaVersion === "2.0.0"
    ? value?.contract_schema_version === "2.0.0" && value.variant_id === config.variantId &&
      value.parameter_schema_v2 !== null && typeof value.parameter_schema_v2 === "object"
    : value?.contract_schema_version === undefined && value?.variant_id === undefined;
  return exactVariant && value?.model_id === config.modelId && value.operation_id === config.operationId &&
    value.schema_status === "live_verified" && value.runtime_usable === false;
}

function validationMatchesExactRequest(result, config) {
  if (result.isError === true) return false;
  const value = result.structuredContent;
  const exactVariant = config.schemaVersion === "2.0.0"
    ? value?.contract_schema_version === "2.0.0" && value.variant_id === config.variantId
    : value?.contract_schema_version === undefined && value?.variant_id === undefined;
  return exactVariant && value?.model_id === config.modelId && value.operation_id === config.operationId &&
    value.validation_status === "VALID" && value.parameters_redacted === true;
}

function hasActivePaidSubscription(result) {
  if (result.isError === true) return false;
  const subscription = result.structuredContent?.subscription;
  return subscription?.active === true && typeof subscription.plan_type === "string" &&
    subscription.plan_type.trim().length > 0 && subscription.plan_type.trim().toUpperCase() !== "FREE";
}

function summarizeGenerationResult(result, expectedMime) {
  if (result.isError === true) {
    const code = readSafeToolErrorCode(result);
    return ["PRE_DISPATCH_FAILED", "PREPARED_REQUEST_MISMATCH", "INVALID_TOOL_INPUT"].includes(code)
      ? { status: "GENERATION_FAILED", artifact_count: 0, mime_types: [] }
      : { status: "OUTCOME_UNKNOWN", artifact_count: 0, mime_types: [], no_retry: true };
  }
  const artifacts = result.structuredContent?.artifacts;
  if (!Array.isArray(artifacts)) return { status: "OUTCOME_UNKNOWN", artifact_count: 0, mime_types: [], no_retry: true };
  const mimeTypes = [...new Set(artifacts.map((artifact) => artifact && typeof artifact === "object" ? artifact.mime_type : null)
    .filter((mime) => typeof mime === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mime)))];
  return artifacts.length > 0 && mimeTypes.includes(expectedMime)
    ? { status: "PASS", artifact_count: artifacts.length, mime_types: mimeTypes }
    : { status: "OUTCOME_UNKNOWN", artifact_count: artifacts.length, mime_types: mimeTypes, no_retry: true };
}

function readSafeToolErrorCode(result) {
  for (const item of result.content ?? []) {
    if (item.type !== "text" || item.text.length > 4_096) continue;
    try {
      const parsed = JSON.parse(item.text);
      const code = parsed?.error?.code;
      if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code)) return code;
    } catch { /* Never expose upstream or local raw error payloads. */ }
  }
  return "GENERATION_FAILED";
}

function isSafeHandoffUri(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/syntxaibot" &&
      url.username === "" && url.password === "" && url.searchParams.size === 1 &&
      /^auth_[0-9a-f-]{36}$/iu.test(url.searchParams.get("start") ?? "");
  } catch { return false; }
}

function boundedString(value, pattern) { return typeof value === "string" && pattern.test(value) ? value : null; }

function waitForHandoffSent(input, signal, timeoutMs) {
  return new Promise((resolvePromise) => {
    let buffer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("data", onData);
      input.off("end", onEnd);
      signal.removeEventListener("abort", onAbort);
      input.pause();
      resolvePromise(result);
    };
    const onData = (chunk) => {
      buffer += String(chunk);
      if (Buffer.byteLength(buffer, "utf8") > 1_024) return finish(false);
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).replace(/\r$/u, "");
      if (buffer.slice(newline + 1).trim() !== "") return finish(false);
      try {
        const value = JSON.parse(line);
        finish(value !== null && typeof value === "object" && !Array.isArray(value) &&
          Object.keys(value).length === 1 && value.action === "handoff_sent");
      } catch { finish(false); }
    };
    const onEnd = () => finish(false);
    const onAbort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    input.setEncoding("utf8");
    input.on("data", onData);
    input.once("end", onEnd);
    signal.addEventListener("abort", onAbort, { once: true });
    input.resume();
  });
}

function delay(milliseconds, signal) {
  return new Promise((resolvePromise) => {
    if (signal.aborted) return resolvePromise();
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolvePromise(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); resolvePromise(); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function unlinkAttempt(client, attemptId) {
  try {
    const result = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }, undefined,
      { timeout: 8_000, maxTotalTimeout: 8_000 });
    return result.isError !== true && result.structuredContent?.status === "REVOKED" ? "REVOKED" : "UNKNOWN";
  } catch { return "UNKNOWN"; }
}

function isDirectInvocation() {
  return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectInvocation()) {
  const config = parseLiveOwnerContractMediaSmokeArgs(process.argv.slice(2));
  if (config === null) {
    process.stderr.write(`Refusing live owner contract-media smoke. Usage: node scripts/live-owner-contract-media-smoke.mjs ${CONFIRM_FLAG} --kind image|video [--schema-version 2.0.0] --handoff-json\n`);
    process.exitCode = 2;
  } else {
    const result = await runLiveOwnerContractMediaSmoke(config, process).catch(() => ({
      status: "FAILED", artifact_count: 0, mime_types: [], local_cleanup_status: "NOT_ATTEMPTED"
    }));
    process.stdout.write(`${JSON.stringify(buildSafeLiveOwnerContractMediaSmokeReport(result))}\n`);
    if (result.status !== "PASS") process.exitCode = 1;
  }
}
