#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

const CONFIRM_FLAG = "--confirm-live-video-contract";
const MAX_PROMPT_BYTES = 16 * 1024;
const MAX_SETTINGS_BYTES = 16 * 1024;
const MAX_SETTINGS_KEYS = 64;
const MAX_MODEL_LENGTH = 128;
const POLL_WINDOW_MS = 180_000;

const aiName = process.argv[3];
const prompt = process.argv[4];
const settings = parseSettings(process.argv[5]);
let currentStage = "guard";
const validInvocation =
  process.argv.length === 6 &&
  process.argv[2] === CONFIRM_FLAG &&
  isSafeModelName(aiName) &&
  isSafePrompt(prompt) &&
  settings !== null;

if (!validInvocation) {
  process.stderr.write(
    `Refusing live video contract observation. Usage: live-owner-video-contract-observe.mjs ${CONFIRM_FLAG} "<ai_name>" "<prompt>" '<settings_json>'\n`
  );
  process.exitCode = 2;
} else {
  await run(aiName, prompt, settings).catch((error) => {
    // Deliberately report only the safe stage. Upstream bodies, credentials,
    // prompts, and provider error text must not cross this boundary.
    process.stderr.write(
      `Live video contract observation failed at safe stage ${currentStage}: ${normalizeError(error)}\n`
    );
    process.stdout.write(`${JSON.stringify({ status: "FAILED", stage: currentStage })}\n`);
    process.exitCode = 1;
  });
}

async function run(model, requestedPrompt, settings) {
  currentStage = "platform";
  if (process.platform !== "darwin") throw new Error("unsupported platform");

  const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 15_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-video-contract-observe", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  let chatUuid = null;
  let receiptMessageId = null;
  const observations = [];
  let dispatchAccepted = false;
  let observationSaved = false;
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
    currentStage = "create_video_chat";
    const created = await chatClient.createChat(
      "video",
      `mcp-video-contract-observe-${randomUUID()}`,
      AbortSignal.timeout(15_000)
    );
    chatUuid = created.chat_uuid;
    process.stdout.write("Video chat created; dispatching the explicitly confirmed contract.\n");

    currentStage = "start_video";
    const receipt = await chatClient.startVideo(
      { ai_name: model, chat_id: chatUuid, prompt: requestedPrompt, settings: settings },
      AbortSignal.timeout(30_000)
    );
    receiptMessageId = safeObservationId(receipt?.message_id);
    dispatchAccepted = true;
    observations.push({ at: new Date().toISOString(), phase: "start_video", message_id: receipt.message_id });
    process.stdout.write(`${JSON.stringify({ status: "DISPATCH_ACCEPTED", chat_id: chatUuid, message_id: receipt.message_id })}\n`);

    currentStage = "poll_video_contract";
    const deadline = Date.now() + POLL_WINDOW_MS;
    let lastMessageId = null;
    let seenInProgress = false;
    let terminalObserved = false;
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      await delay(Math.min(2_000, remaining));
      const inProgress = await chatClient.listInProgress(chatUuid, AbortSignal.timeout(Math.min(15_000, remaining)));
      const candidate = inProgress.find((entry) => String(entry?.message_id) !== String(receipt.message_id));
      if (candidate?.message_id === undefined && lastMessageId === null) {
        observations.push({ at: new Date().toISOString(), phase: "list_in_progress", entries: inProgress.length });
        continue;
      }
      if (candidate?.message_id !== undefined) {
        lastMessageId = String(candidate.message_id);
        seenInProgress = true;
      }
      const envelope = await chatClient.getMessage(
        chatUuid,
        lastMessageId,
        AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now())))
      );
      const stillInProgress = inProgress.some((entry) => String(entry?.message_id) === lastMessageId);
      observations.push({ at: new Date().toISOString(), phase: "poll", message_id: lastMessageId, still_in_progress: stillInProgress, envelope });
      // `envelope` is already the reviewed redacted shape; disappearance from
      // listInProgress after a readable envelope is the only safe terminal hint.
      if (seenInProgress && !stillInProgress) {
        terminalObserved = true;
        break;
      }
    }

    currentStage = "save_observation";
    const outDir = join(fileURLToPath(new URL("../.черновики", import.meta.url)), "video-contract-observation");
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `observation-${Date.now()}.json`);
    await writeFile(outPath, JSON.stringify({ status: terminalObserved ? "TERMINAL_OBSERVED" : "POLL_TIMEOUT", model: model, observations }, null, 2), "utf8");
    observationSaved = true;
    process.stdout.write(`${JSON.stringify({ status: terminalObserved ? "TERMINAL_OBSERVED" : "POLL_TIMEOUT", observation_path: outPath, chat_left_alive: true })}\n`);
  } finally {
    // Never delete a video chat: after dispatch, timeout and write failures all
    // need the chat to remain available for manual inspection and recovery.
    if (chatUuid !== null && !observationSaved) {
      const failureStage = currentStage;
      await writeUnknownObservation(failureStage, true, dispatchAccepted, chatUuid, receiptMessageId).catch(() => undefined);
    }
    if (chatUuid !== null && dispatchAccepted) {
      process.stdout.write(`${JSON.stringify({ status: "CHAT_LEFT_ALIVE", chat_id: chatUuid })}\n`);
    }
    if (attemptId !== null) {
      currentStage = "cleanup_unlink";
      await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).catch(() => undefined);
    }
    await client.close();
    await server.close();
  }
}

async function writeUnknownObservation(stage, chatPresent, dispatchAccepted, chatUuid, messageId) {
  const outDir = join(fileURLToPath(new URL("../.черновики", import.meta.url)), "video-contract-observation");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `unknown-${Date.now()}-${randomUUID()}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        status: "OUTCOME_UNKNOWN",
        stage,
        chat_present: chatPresent,
        dispatch_accepted: dispatchAccepted,
        chat_uuid: safeObservationId(chatUuid),
        ...(safeObservationId(messageId) === null ? {} : { message_id: safeObservationId(messageId) })
      },
      null,
      2
    ),
    "utf8"
  );
}

function safeObservationId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    ? value
    : null;
}

function isSafeModelName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_MODEL_LENGTH && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isSafePrompt(value) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_PROMPT_BYTES) return false;
  return !/[\u0000-\u001F\u007F]/.test(value);
}

function parseSettings(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_SETTINGS_BYTES) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  let keyCount = 0;
  return isSafeSettingsObject(parsed, () => {
    keyCount += 1;
    return keyCount <= MAX_SETTINGS_KEYS;
  })
    ? parsed
    : null;
}

function isSafeSettingsObject(value, countKey) {
  if (value === null) return false;
  if (typeof value === "string") return !/[\u0000-\u001F\u007F]/.test(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every((item) => isSafeSettingsValue(item, countKey));
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor" || /[\u0000-\u001F\u007F]/.test(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !countKey()) return false;
    if (!isSafeSettingsValue(descriptor.value, countKey)) return false;
  }
  return true;
}

function isSafeSettingsValue(value, countKey) {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return !/[\u0000-\u001F\u007F]/.test(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isSafeSettingsValue(item, countKey));
  return isPlainObject(value) && isSafeSettingsObject(value, countKey);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeError(error) {
  return error instanceof Error && error.message === "unsupported platform" ? error.message : "safe error";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
