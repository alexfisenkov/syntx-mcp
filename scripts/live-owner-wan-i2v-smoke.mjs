#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

const CONFIRM_FLAG = "--confirm-live-wan-i2v-smoke";
const POLL_WINDOW_MS = 180_000;
const LOGIN_ATTEMPTS = 60;
const FIXED_PROMPT = "Animate this still image with a gentle cinematic camera move";
const TINY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
let stage = "guard";
let failureStage = null;

if (process.argv.length !== 3 || process.argv[2] !== CONFIRM_FLAG) {
  process.stderr.write(`Refusing real Wan i2v smoke: pass ${CONFIRM_FLAG} for the explicit owner check.\n`);
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stdout.write(`${JSON.stringify({ status: "OUTCOME_UNKNOWN", stage: failureStage ?? stage })}\n`);
    process.stderr.write(`Live Wan i2v smoke failed at safe stage ${failureStage ?? stage}; no upstream details were emitted.\n`);
    process.exitCode = 1;
  });
}

async function run() {
  if (process.platform !== "darwin") throw new Error("unsupported platform");
  const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 30_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-wan-i2v-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  let attemptId = null;
  let chatClient = null;
  let dispatchAccepted = false;
  try {
    stage = "begin_login";
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const link = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || link?.type !== "resource_link") throw new Error("login handoff unavailable");
    stage = "telegram_handoff";
    await promisify(execFile)("/usr/bin/open", [link.uri], { timeout: 10_000 });
    stage = "check_login";
    let linked = false;
    for (let i = 0; i < LOGIN_ATTEMPTS; i += 1) {
      await delay(i === 0 ? 1_500 : 1_000);
      const checked = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } });
      if (checked.structuredContent?.linked === true) { linked = true; break; }
      if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) break;
    }
    if (!linked) throw new Error("login did not complete");

    chatClient = runtime.createChatClient(attemptId);
    stage = "create_video_chat";
    const chat = await chatClient.createChat("video", "mcp-wan-i2v-smoke", AbortSignal.timeout(30_000));
    stage = "upload_reference";
    const references = await chatClient.uploadFileReferences({
      bytes: TINY_PNG,
      filename: "syntx-wan-i2v-smoke.png",
      mime_type: "image/png",
      destination: "hidden",
      check_duplicates: true,
      model_type: "wan_26_i2v"
    }, AbortSignal.timeout(30_000));
    if (references.length !== 1) throw new Error("unexpected reference count");

    stage = "start_video";
    const dispatch = await chatClient.startVideoWithInternalReferences({
      ai_name: "wan_video",
      chat_id: chat.chat_uuid,
      prompt: FIXED_PROMPT,
      settings: {
        model_type: "wan_26_i2v",
        file_urls: [],
        aspect_ratio: "1:1",
        resolution: "720P",
        video_duration: 5,
        prompt_extend: true,
        shot_type: "single",
        audio_setting: "auto",
        seed: null,
        native_audio: false
      }
    }, references, AbortSignal.timeout(30_000));
    dispatchAccepted = true;

    stage = "poll_result";
    const outcome = await pollResult(chatClient, chat.chat_uuid, dispatch.message_id);
    await saveObservation(outcome.status, outcome.terminal, outcome.artifact_mime);
    process.stdout.write(`${JSON.stringify({ status: outcome.status, terminal: outcome.terminal, artifact_mime: outcome.artifact_mime, chat_left_alive: true })}\n`);
    if (outcome.status !== "PASS") process.exitCode = 1;
  } finally {
    // Never delete a chat after upload or dispatch. This preserves a lead for
    // manual owner reconciliation when the paid outcome is uncertain.
    if (failureStage === null && stage !== "poll_result") failureStage = stage;
    if (attemptId !== null) {
      stage = "unlink";
      await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).catch(() => undefined);
    }
    await safeClose(() => client.close());
    await safeClose(() => server.close());
  }
}

async function pollResult(chatClient, chatUuid, echoedMessageId) {
  const deadline = Date.now() + POLL_WINDOW_MS;
  let candidateId = null;
  let terminal = false;
  let artifactMime = null;
  while (Date.now() < deadline) {
    await delay(2_000);
    const entries = await chatClient.listInProgress(chatUuid, AbortSignal.timeout(20_000));
    const candidate = entries.find((entry) => String(entry.message_id) !== String(echoedMessageId));
    if (candidate?.message_id !== undefined) candidateId = String(candidate.message_id);
    if (candidateId === null) continue;
    const message = await chatClient.getMessage(chatUuid, candidateId, AbortSignal.timeout(20_000));
    const exact = message.object_type === "video" && message.model_type === "wan_26_i2v";
    const mp4 = message.artifacts.find((artifact) => artifact.mime_type === "video/mp4");
    const still = entries.some((entry) => String(entry.message_id) === candidateId);
    if (exact && mp4) {
      terminal = true;
      artifactMime = "video/mp4";
      return { status: "PASS", terminal, artifact_mime: artifactMime };
    }
    if (!still) {
      terminal = true;
      return { status: "FAILED", terminal, artifact_mime: null };
    }
  }
  return { status: "OUTCOME_UNKNOWN", terminal: false, artifact_mime: null };
}

async function saveObservation(status, terminal, artifactMime) {
  const outDir = join(fileURLToPath(new URL("../.черновики", import.meta.url)), "wan-i2v-observation");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `observation-${Date.now()}.json`), JSON.stringify({ status, terminal, artifact_mime: artifactMime, chat_left_alive: true }, null, 2), "utf8");
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function safeClose(close) { try { await close(); } catch { /* best effort */ } }
