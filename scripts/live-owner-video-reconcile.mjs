#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";
import { LinkedAttemptCredentialBroker } from "../dist/src/adapter/syntx/link-credential-broker.js";

const CONFIRM_FLAG = "--confirm-video-reconcile";
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const POLL_WINDOW_MS = 180_000;
const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_RAW_MESSAGE_BYTES = 256 * 1024;
const MAX_DISCOVERED_MESSAGES = 16;
const V1_BASE_URL = new URL("https://api.syntx.ai/api/v1/");

const chatUuid = process.argv[3];
const messageId = process.argv[4];
let currentStage = "guard";

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  if (
    process.argv.length !== 5 ||
    process.argv[2] !== CONFIRM_FLAG ||
    !isSafeIdentifier(chatUuid) ||
    !isSafeIdentifier(messageId)
  ) {
    process.stderr.write(
      `Refusing video reconciliation. Usage: live-owner-video-reconcile.mjs ${CONFIRM_FLAG} <chat_uuid> <message_id>\n`
    );
    process.exitCode = 2;
  } else {
    await run(chatUuid, messageId).catch(async (error) => {
      const safeError = normalizeError(error);
      process.stderr.write(`Live video reconciliation failed at safe stage ${currentStage}: ${safeError}\n`);
      process.stdout.write(`${JSON.stringify({ status: "FAILED", stage: currentStage })}\n`);
      process.exitCode = 1;
    });
  }
}

async function run(targetChatUuid, targetMessageId) {
  currentStage = "platform";
  if (process.platform !== "darwin") throw new Error("unsupported platform");

  const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 15_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-video-reconcile", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  let observationPath = null;
  let reconciliationStarted = false;
  const observations = [];
  try {
    currentStage = "begin_login";
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const approvalLink = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
      throw new Error("missing safe handoff");
    }

    currentStage = "telegram_handoff";
    process.stdout.write(`Approve login in Telegram: ${approvalLink.uri}\n`);
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

    currentStage = "check_login";
    let linked = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await delay(attempt === 0 ? 1_500 : 1_000);
      const checked = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } });
      if (checked.structuredContent?.linked === true) {
        linked = true;
        break;
      }
      if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) break;
    }
    if (!linked) throw new Error("login did not complete");

    const chatClient = runtime.createChatClient(attemptId);
    reconciliationStarted = true;
    currentStage = "reconcile_video";
    const deadline = Date.now() + POLL_WINDOW_MS;
    let lastEnvelope = null;
    let seenInProgress = false;
    const discoveredMessageIds = new Set();
    const broker = new LinkedAttemptCredentialBroker(
      runtime.serverOptions.auth.linkService,
      runtime.serverOptions.auth.binding,
      attemptId
    );
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const requestSignal = AbortSignal.timeout(Math.min(15_000, remaining));
      let inProgress;
      try {
        inProgress = await chatClient.listInProgress(targetChatUuid, requestSignal);
      } catch (error) {
        if (!isTimeoutError(error)) throw error;
        observations.push({ at: new Date().toISOString(), message_id: targetMessageId, reconciliation_timeout: true });
        break;
      }
      const present = inProgress.some((entry) => String(entry.message_id) === targetMessageId);
      if (present) seenInProgress = true;
      if (!present) {
        try {
          const history = await readChatHistory(
            broker,
            targetChatUuid,
            AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now())))
          );
          for (const candidate of history.botMessageIds) {
            if (discoveredMessageIds.size >= MAX_DISCOVERED_MESSAGES) break;
            discoveredMessageIds.add(candidate);
          }
          observations.push({
            at: new Date().toISOString(),
            message_id: targetMessageId,
            history_discovery: history.messages
          });
        } catch (error) {
          if (isTimeoutError(error)) {
            observations.push({ at: new Date().toISOString(), message_id: targetMessageId, reconciliation_timeout: true });
            break;
          }
          if (!(error instanceof UnknownChatHistoryShapeError)) throw error;
          observations.push({
            at: new Date().toISOString(),
            message_id: targetMessageId,
            history_discovery: "unknown_shape"
          });
        }
      }
      let envelope;
      try {
        envelope = await chatClient.getMessage(
          targetChatUuid,
          targetMessageId,
          AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now())))
        );
      } catch (error) {
        if (!isTimeoutError(error)) throw error;
        observations.push({ at: new Date().toISOString(), message_id: targetMessageId, reconciliation_timeout: true });
        break;
      }
      lastEnvelope = envelope;
      observations.push({
        at: new Date().toISOString(),
        message_id: targetMessageId,
        still_in_progress: present,
        envelope
      });
      try {
        observations.push({
          at: new Date().toISOString(),
          message_id: targetMessageId,
          raw_message_diagnostic: await readRawMessageDiagnostic(
            broker,
            targetChatUuid,
            targetMessageId,
            AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now())))
          )
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          observations.push({
            at: new Date().toISOString(),
            message_id: targetMessageId,
            raw_message_diagnostic: "timeout"
          });
          break;
        }
        if (!(error instanceof UnknownRawMessageShapeError)) throw error;
        observations.push({
          at: new Date().toISOString(),
          message_id: targetMessageId,
          raw_message_diagnostic: "unknown_shape"
        });
      }
      for (const candidateId of discoveredMessageIds) {
        if (candidateId === targetMessageId) continue;
        const candidateEnvelope = await chatClient.getMessage(
          targetChatUuid,
          candidateId,
          AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now())))
        ).catch(() => null);
        if (candidateEnvelope !== null) {
          observations.push({
            at: new Date().toISOString(),
            message_id: candidateId,
            candidate_bot_message: candidateEnvelope
          });
          try {
            observations.push({
              at: new Date().toISOString(),
              message_id: candidateId,
              raw_message_diagnostic: await readRawMessageDiagnostic(
                broker,
                targetChatUuid,
                candidateId,
                AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now())))
              )
            });
          } catch (error) {
            if (!(error instanceof UnknownRawMessageShapeError)) throw error;
            observations.push({
              at: new Date().toISOString(),
              message_id: candidateId,
              raw_message_diagnostic: "unknown_shape"
            });
          }
          if (candidateEnvelope.artifacts.length > 0) lastEnvelope = candidateEnvelope;
        }
      }
      if (seenInProgress && !present) break;
      await delay(Math.min(2_000, Math.max(1, deadline - Date.now())));
    }

    currentStage = "save_observation";
    const classification = classifyProviderCompletedWithoutBotResult({
      targetMessageId,
      result: lastEnvelope,
      observations
    });
    const status = classification === null
      ? "OUTCOME_UNKNOWN"
      : "PROVIDER_COMPLETED_WITHOUT_BOT_RESULT";
    observationPath = await saveUnknownObservation({
      chat_uuid: targetChatUuid,
      message_id: targetMessageId,
      status,
      classification,
      observed_raw_diagnostics: summarizeRawDiagnostics(observations),
      observation_summary: summarizeObservations(observations)
    });
    process.stdout.write(`${JSON.stringify(classification === null
      ? {
          status,
          result: lastEnvelope,
          artifacts: lastEnvelope?.artifacts ?? [],
          observation_path: observationPath,
          chat_left_alive: true
        }
      : {
          status,
          classification,
          observation_path: observationPath,
          chat_left_alive: true,
          note: "No automatic retry or delete is performed."
        })}\n`);
  } finally {
    if (reconciliationStarted && observationPath === null) {
      await saveUnknownObservation({
        chat_uuid: targetChatUuid,
        message_id: targetMessageId,
        status: "OUTCOME_UNKNOWN",
        classification: null,
        result: null,
        observed_raw_diagnostics: summarizeRawDiagnostics(observations),
        observation_summary: summarizeObservations(observations),
        stage: currentStage,
        chat_left_alive: true
      }).catch(() => undefined);
    }
    if (attemptId !== null) {
      currentStage = "cleanup_unlink";
      await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).catch(() => undefined);
    }
    await client.close();
    await server.close();
  }
}

async function saveUnknownObservation(value) {
  const outDir = join(fileURLToPath(new URL("../.черновики", import.meta.url)), "video-reconcile-observation");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `unknown-${Date.now()}.json`);
  const safeValue = {
    status: value.status === "PROVIDER_COMPLETED_WITHOUT_BOT_RESULT"
      ? value.status
      : "OUTCOME_UNKNOWN",
    chat_uuid: safeProviderId(value.chat_uuid),
    message_id: safeProviderId(value.message_id),
    classification: value.classification === "PROVIDER_COMPLETED_WITHOUT_BOT_RESULT"
      ? value.classification
      : null,
    observed_raw_diagnostics: Array.isArray(value.observed_raw_diagnostics)
      ? value.observed_raw_diagnostics
      : [],
    observation_summary: isRecord(value.observation_summary)
      ? value.observation_summary
      : {},
    stage: safeToken(value.stage),
    chat_left_alive: value.chat_left_alive === true
  };
  await writeFile(outPath, JSON.stringify(safeValue, null, 2), "utf8");
  return outPath;
}

function isSafeIdentifier(value) {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function normalizeError(error) {
  return error instanceof Error && error.message === "unsupported platform" ? error.message : "safe error";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class UnknownChatHistoryShapeError extends Error {}
class UnknownRawMessageShapeError extends Error {}

function classifyProviderCompletedWithoutBotResult({ targetMessageId, result, observations }) {
  if (!isRecord(result) || !Array.isArray(result.artifacts) || result.artifacts.length !== 0) return null;
  if (observations.some((entry) => entry?.reconciliation_timeout === true
    || entry?.raw_message_diagnostic === "timeout")) return null;
  const targetDiagnostics = observations
    .filter((entry) => entry?.message_id === targetMessageId && isRecord(entry.raw_message_diagnostic))
    .map((entry) => entry.raw_message_diagnostic);
  if (targetDiagnostics.length === 0) return null;

  let historyWasUnknown = false;
  let botMessageWasObserved = false;
  let artifactWasObserved = false;
  for (const observation of observations) {
    if (observation?.history_discovery === "unknown_shape") historyWasUnknown = true;
    if (Array.isArray(observation?.history_discovery)) {
      for (const message of observation.history_discovery) {
        if (message?.author_id === -1) botMessageWasObserved = true;
        if (Array.isArray(message?.objects) && message.objects.some(hasArtifactDiagnostic)) {
          artifactWasObserved = true;
        }
      }
    }
    if (isRecord(observation?.candidate_bot_message)) {
      botMessageWasObserved = true;
      if (Array.isArray(observation.candidate_bot_message.artifacts)
        && observation.candidate_bot_message.artifacts.length > 0) artifactWasObserved = true;
    }
    if (isRecord(observation?.raw_message_diagnostic)
      && observation.raw_message_diagnostic.objects.some(hasArtifactDiagnostic)) artifactWasObserved = true;
  }
  if (historyWasUnknown || botMessageWasObserved || artifactWasObserved) return null;
  if (!targetDiagnostics.every((diagnostic) => (
    diagnostic.author_id !== -1
    && Array.isArray(diagnostic.objects)
    && diagnostic.objects.length > 0
    && diagnostic.objects.every((object) => (
      object.object_type === "text" && object.completed === true
    ))
  ))) return null;
  return "PROVIDER_COMPLETED_WITHOUT_BOT_RESULT";
}

function hasArtifactDiagnostic(object) {
  return isRecord(object)
    && (typeof object.artifact_host === "string" || typeof object.artifact_mime === "string");
}

function isTimeoutError(error) {
  return isRecord(error) && ["AbortError", "TimeoutError"].includes(error.name);
}

function summarizeRawDiagnostics(observations) {
  return observations
    .filter((entry) => isRecord(entry?.raw_message_diagnostic))
    .map((entry) => {
      const diagnostic = entry.raw_message_diagnostic;
      return {
        message_id: safeProviderId(entry.message_id),
        author_id: safeNumber(diagnostic.author_id),
        object_count: Array.isArray(diagnostic.objects) ? diagnostic.objects.length : 0,
        completed_text_only: Array.isArray(diagnostic.objects)
          && diagnostic.objects.length > 0
          && diagnostic.objects.every((object) => object?.object_type === "text" && object?.completed === true),
        artifact_observed: Array.isArray(diagnostic.objects)
          && diagnostic.objects.some(hasArtifactDiagnostic)
      };
    });
}

function summarizeObservations(observations) {
  return {
    sample_count: observations.length,
    history_unknown: observations.some((entry) => entry?.history_discovery === "unknown_shape"),
    bot_message_observed: observations.some((entry) => (
      Array.isArray(entry?.history_discovery)
        ? entry.history_discovery.some((message) => message?.author_id === -1)
        : isRecord(entry?.candidate_bot_message)
    )),
    artifact_observed: observations.some((entry) => (
      isRecord(entry?.candidate_bot_message)
        && Array.isArray(entry.candidate_bot_message.artifacts)
        && entry.candidate_bot_message.artifacts.length > 0
    ))
  };
}

async function readChatHistory(broker, targetChatUuid, signal) {
  return broker.useCredential(async (credential) => {
    const request = globalThis.fetch;
    const response = await request(new URL(`chats/${targetChatUuid}`, V1_BASE_URL), {
      method: "GET",
      headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
      signal
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.startsWith("application/json")) {
      throw new Error("chat history response rejected");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_HISTORY_BYTES) throw new Error("chat history response too large");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("chat history response is not UTF-8");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("chat history response is not JSON");
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
      throw new UnknownChatHistoryShapeError("chat history shape is unknown");
    }
    const messages = [];
    const botMessageIds = [];
    for (const message of parsed.messages.slice(0, MAX_DISCOVERED_MESSAGES)) {
      if (!isRecord(message)) continue;
      const id = safeProviderId(message.id);
      if (id === undefined) continue;
      const objects = Array.isArray(message.message_object) ? message.message_object : [];
      const safeObjects = objects.filter(isRecord).map((object) => ({
        id: safeProviderId(object.id),
        object_type: safeToken(object.object_type),
        model_type: safeToken(object.model_type),
        completed: object.completed === true
      }));
      const safeMessage = {
        id,
        author_id: safeNumber(message.author_id),
        objects: safeObjects
      };
      messages.push(safeMessage);
      if (message.author_id === -1) botMessageIds.push(id);
    }
    return { messages, botMessageIds };
  });
}

async function readRawMessageDiagnostic(broker, targetChatUuid, targetMessageId, signal) {
  return broker.useCredential(async (credential) => {
    const request = globalThis.fetch;
    const response = await request(new URL(`chats/${targetChatUuid}/${targetMessageId}`, V1_BASE_URL), {
      method: "GET",
      headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
      signal
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.startsWith("application/json")) {
      throw new Error("raw message response rejected");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RAW_MESSAGE_BYTES) throw new Error("raw message response too large");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("raw message response is not UTF-8");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("raw message response is not JSON");
    }
    if (!isRecord(parsed)) throw new UnknownRawMessageShapeError("raw message shape is unknown");
    const raw = isRecord(parsed.raw) ? parsed.raw : parsed;
    const id = safeProviderId(parsed.id) ?? safeProviderId(raw.id);
    const authorId = safeNumber(parsed.author_id ?? raw.author_id);
    const objects = Array.isArray(parsed.message_object)
      ? parsed.message_object
      : Array.isArray(raw.message_object) ? raw.message_object : null;
    if (id === undefined || authorId === undefined || objects === null) {
      throw new UnknownRawMessageShapeError("raw message shape is unknown");
    }
    return {
      id,
      author_id: authorId,
      objects: objects.filter(isRecord).map((object) => {
        const diagnostic = {
          object_type: safeToken(object.object_type),
          model_type: safeToken(object.model_type),
          completed: object.completed === true
        };
        const artifact = safeArtifactDiagnostic(object);
        return artifact === undefined ? diagnostic : { ...diagnostic, ...artifact };
      })
    };
  });
}

function safeArtifactDiagnostic(object) {
  const objectUrl = typeof object.object_url === "string" ? object.object_url : undefined;
  let host;
  if (objectUrl !== undefined) {
    try {
      const parsed = new URL(objectUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") host = parsed.hostname;
    } catch {
      host = undefined;
    }
  }
  const mime = safeMimeType(object.mime_type);
  if (host === undefined && mime === undefined) return undefined;
  return { artifact_host: host, artifact_mime: mime };
}

function safeMimeType(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(value)
    ? value.toLowerCase()
    : undefined;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeProviderId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && SAFE_IDENTIFIER.test(value)) return value;
  return undefined;
}

function safeToken(value) {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : undefined;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export { classifyProviderCompletedWithoutBotResult };
