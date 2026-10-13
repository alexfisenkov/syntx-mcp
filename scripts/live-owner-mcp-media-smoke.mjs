#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const CONFIRM_FLAG = "--confirm-live-owner-mcp-media-smoke";
const HANDOFF_ACK_TIMEOUT_MS = 120_000;
const SMOKE_DEADLINE_MS = 9 * 60_000;
const LOGIN_CHECKS = 40;
const LOGIN_POLL_DELAY_MS = 1_000;
const MCP_SHORT_TIMEOUT_MS = 5_500;
const GENERATION_TIMEOUT_MS = 420_000;
const validatedConfigs = new WeakSet();

/** Exact guard: unknown models, extra input and partial confirmation are refused. */
export function parseLiveOwnerMcpMediaSmokeArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 6 || argv[0] !== CONFIRM_FLAG ||
      argv[1] !== "--kind" || argv[3] !== "--model" || argv[5] !== "--handoff-json") return null;
  const kind = argv[2];
  const modelId = argv[4];
  if (kind === "image" && modelId === "banana-2.1") return markValidatedConfig({ kind, modelId });
  if (kind === "video" && modelId === "seedance_pro-fast") return markValidatedConfig({ kind, modelId });
  return null;
}

export async function runLiveOwnerMcpMediaSmoke(config, io = process, dependencies = undefined) {
  if (config === null || typeof config !== "object" || !validatedConfigs.has(config)) {
    throw new Error("The live smoke profile is not allowed.");
  }
  // `dependencies` is only for deterministic local tests; CLI calls never inject it.
  const loadedDependencies = dependencies ?? await loadRuntimeDependencies();
  const { Client, InMemoryTransport, createMcpServer, createObservedOwnerRuntime } = loadedDependencies;

  const deadline = createDeadline(SMOKE_DEADLINE_MS);
  const runtime = createObservedOwnerRuntime({
    requestTimeoutMs: 5_000,
    accountStatusEnabled: true,
    generateImageEnabled: config.kind === "image",
    generateVideoEnabled: config.kind === "video"
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-live-owner-mcp-media-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let attemptId = null;
  let generationCallStarted = false;
  let generationOutcome = null;
  let outcome = { status: "FAILED", artifact_count: 0, mime_types: [] };
  let localCleanupStatus = "NOT_ATTEMPTED";

  try {
    flow: {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const listed = await client.listTools({ timeout: MCP_SHORT_TIMEOUT_MS, maxTotalTimeout: MCP_SHORT_TIMEOUT_MS });
      const registeredToolNames = new Set((listed.tools ?? []).map((tool) => tool.name));
      const expectedToolNames = [
        "syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status",
        config.kind === "image" ? "syntx_owner_generate_image" : "syntx_owner_generate_video"
      ];
      if (expectedToolNames.some((name) => !registeredToolNames.has(name))) {
        outcome = { status: "MCP_TOOLS_MISSING", artifact_count: 0, mime_types: [] };
        break flow;
      }

      const begun = await callTool(client, { name: "syntx_begin_login", arguments: {} }, deadline.signal, MCP_SHORT_TIMEOUT_MS);
      attemptId = boundedString(begun.structuredContent?.attempt_id, /^link_[A-Za-z0-9_-]{20,120}$/u);
      const handoffUri = begun.content.find((item) => item.type === "resource_link")?.uri;
      if (begun.isError === true || attemptId === null || typeof handoffUri !== "string" || !isSafeHandoffUri(handoffUri)) {
        outcome = { status: "HANDOFF_FAILED", artifact_count: 0, mime_types: [] };
        break flow;
      }

      io.stdout.write(`${JSON.stringify({
        event: "BEGIN",
        status: "HANDOFF_REQUIRED",
        kind: config.kind,
        model_id: config.modelId,
        attempt_id: attemptId,
        handoff_uri: handoffUri
      })}\n`);

      const acknowledged = await waitForHandoffSent(io.stdin, deadline.signal, HANDOFF_ACK_TIMEOUT_MS);
      if (!acknowledged) {
        outcome = { status: "HANDOFF_NOT_CONFIRMED", artifact_count: 0, mime_types: [] };
        break flow;
      }

      let linked = false;
      for (let index = 0; index < LOGIN_CHECKS; index += 1) {
        await delay(index === 0 ? 1_500 : LOGIN_POLL_DELAY_MS, deadline.signal);
        const checked = await callTool(client, {
          name: "syntx_check_login",
          arguments: { attempt_id: attemptId }
        }, deadline.signal, MCP_SHORT_TIMEOUT_MS);
        if (checked.isError === true) break;
        if (checked.structuredContent?.linked === true) {
          linked = true;
          break;
        }
        const status = checked.structuredContent?.status;
        if (status === "EXPIRED" || status === "FAILED_TERMINAL" || status === "REVOKED") break;
      }
      if (!linked) {
        outcome = { status: "AUTH_NOT_LINKED", artifact_count: 0, mime_types: [] };
        break flow;
      }

      const accountStatus = await callTool(client, {
        name: "syntx_get_account_status",
        arguments: { link_attempt_id: attemptId }
      }, deadline.signal, 12_000);
      if (!hasActivePaidSubscription(accountStatus)) {
        outcome = { status: "SUBSCRIPTION_NOT_VERIFIED", artifact_count: 0, mime_types: [] };
        break flow;
      }

      const toolName = config.kind === "image" ? "syntx_owner_generate_image" : "syntx_owner_generate_video";
      const arguments_ = config.kind === "image"
        ? {
            link_attempt_id: attemptId,
            model_id: "banana-2.1",
            prompt: "Private owner MCP smoke: a simple abstract geometric still life, warm neutral background, no text, no people.",
            copies: 1,
            aspect_ratio: "1:1",
            settings_variant: "default"
          }
        : {
            link_attempt_id: attemptId,
            model_id: "seedance_pro-fast",
            prompt: "Private owner MCP smoke: a brief, simple abstract geometric animation on a neutral background, no text, no people.",
            copies: 1
          };

      generationCallStarted = true;
      // One tool call only. An uncertain outcome is reported and never retried;
      // the generation tool's remote chat is preserved, not deleted here.
      try {
        const generated = await callTool(client, { name: toolName, arguments: arguments_ }, deadline.signal, GENERATION_TIMEOUT_MS);
        generationOutcome = summarizeGenerationResult(generated, config.kind);
      } catch {
        // A timeout/transport failure may follow dispatch. Never retry this paid call.
        generationOutcome = { status: "OUTCOME_UNKNOWN", artifact_count: 0, mime_types: [] };
      }
      outcome = {
        status: generationOutcome.status,
        artifact_count: generationOutcome.artifact_count,
        mime_types: generationOutcome.mime_types,
        no_retry: generationOutcome.status === "OUTCOME_UNKNOWN"
      };
    }
  } catch {
    outcome = {
      status: generationCallStarted ? "OUTCOME_UNKNOWN" : "FAILED",
      artifact_count: 0,
      mime_types: [],
      ...(generationCallStarted ? { no_retry: true } : {})
    };
  } finally {
    deadline.cancel();
    if (attemptId !== null) {
      localCleanupStatus = await unlinkAttempt(client, attemptId);
    }
    await safeClose(() => client.close());
    await safeClose(() => server.close());
  }
  return { ...outcome, local_cleanup_status: localCleanupStatus };
}

export function buildSafeLiveOwnerMcpMediaSmokeReport(result) {
  return {
    status: result.status,
    artifact_count: result.artifact_count,
    mime_types: result.mime_types,
    local_cleanup_status: result.local_cleanup_status,
    ...(result.no_retry === true ? { no_retry: true } : {})
  };
}

function markValidatedConfig(config) {
  const frozen = Object.freeze(config);
  validatedConfigs.add(frozen);
  return frozen;
}

function createDeadline(milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("smoke deadline elapsed")), milliseconds);
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function callTool(client, request, signal, timeout) {
  return client.callTool(request, undefined, { signal, timeout, maxTotalTimeout: timeout });
}

async function loadRuntimeDependencies() {
  const [{ Client }, { InMemoryTransport }, { createMcpServer }, { createObservedOwnerRuntime }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/inMemory.js"),
    import("../dist/src/mcp/server.js"),
    import("../dist/src/runtime/observed-owner-runtime.js")
  ]);
  return { Client, InMemoryTransport, createMcpServer, createObservedOwnerRuntime };
}

function hasActivePaidSubscription(result) {
  if (result.isError === true) return false;
  const subscription = result.structuredContent?.subscription;
  return subscription?.active === true && typeof subscription.plan_type === "string" &&
    subscription.plan_type.trim().length > 0 && subscription.plan_type.trim().toUpperCase() !== "FREE";
}

function summarizeGenerationResult(result, kind) {
  if (result.isError === true) {
    const code = readSafeToolErrorCode(result);
    return { status: code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "GENERATION_FAILED", artifact_count: 0, mime_types: [] };
  }
  const key = kind === "image" ? "images" : "videos";
  const artifacts = result.structuredContent?.[key];
  if (!Array.isArray(artifacts)) return { status: "GENERATION_FAILED", artifact_count: 0, mime_types: [] };
  const mimeTypes = [...new Set(artifacts
    .map((artifact) => artifact && typeof artifact === "object" ? artifact.mime_type : null)
    .filter((value) => typeof value === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(value)))];
  const expectedMime = kind === "image" ? "image/jpeg" : "video/mp4";
  return {
    status: artifacts.length > 0 && mimeTypes.includes(expectedMime) ? "PASS" : "GENERATION_FAILED",
    artifact_count: artifacts.length,
    mime_types: mimeTypes
  };
}

function readSafeToolErrorCode(result) {
  for (const content of result.content ?? []) {
    if (content.type !== "text" || content.text.length > 4_096) continue;
    try {
      const parsed = JSON.parse(content.text);
      const code = parsed?.error?.code;
      if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code)) return code;
    } catch { /* Do not surface tool error text or values. */ }
  }
  return "GENERATION_FAILED";
}

function isSafeHandoffUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "t.me" && url.pathname === "/syntxaibot" &&
      url.username === "" && url.password === "" && url.searchParams.size === 1 &&
      /^auth_[0-9a-f-]{36}$/iu.test(url.searchParams.get("start") ?? "");
  } catch {
    return false;
  }
}

function boundedString(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

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
      } catch {
        finish(false);
      }
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
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolvePromise();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolvePromise();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function unlinkAttempt(client, attemptId) {
  try {
    const result = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }, undefined, { timeout: 8_000, maxTotalTimeout: 8_000 });
    return result.isError !== true && result.structuredContent?.status === "REVOKED" ? "REVOKED" : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

async function safeClose(close) {
  try { await close(); } catch { /* Best-effort local cleanup; never print internals. */ }
}

function isDirectInvocation() {
  return typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isDirectInvocation()) {
  const config = parseLiveOwnerMcpMediaSmokeArgs(process.argv.slice(2));
  if (config === null) {
    process.stderr.write(`Refusing live owner MCP media smoke. Usage: node scripts/live-owner-mcp-media-smoke.mjs ${CONFIRM_FLAG} --kind image|video --model banana-2.1|seedance_pro-fast --handoff-json\n`);
    process.exitCode = 2;
  } else {
    const io = {
      stdin: process.stdin,
      stdout: process.stdout
    };
    const result = await runLiveOwnerMcpMediaSmoke(config, io).catch(() => ({
      status: "FAILED",
      kind: config.kind,
      model_id: config.modelId,
      artifact_count: 0,
      mime_types: [],
      local_cleanup_status: "NOT_ATTEMPTED"
    }));
    process.stdout.write(`${JSON.stringify(buildSafeLiveOwnerMcpMediaSmokeReport(result))}\n`);
    if (result.status !== "PASS") process.exitCode = 1;
  }
}
