#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

/**
 * One explicit, owner-only smoke for the shipped video MCP tool. It is a real
 * billed dispatch when run with the exact flag. The profile is intentionally
 * fixed to the one live-verified Seedance contract; this script does not
 * accept a prompt, settings, URL, or model from its caller.
 */
const CONFIRM_FLAG = "--confirm-live-generate-video-tool-smoke";
const FIXED_MODEL_ID = "seedance-2.0";
const FIXED_PROMPT = "A cinematic aerial shot of a futuristic city at sunset";
const LOGIN_ATTEMPTS = 60;
const TOOL_TIMEOUT_MS = 190_000;
let currentStage = "guard";

const hasExactConfirmation =
  process.argv.length === 3 && process.argv[2] === CONFIRM_FLAG;

if (!hasExactConfirmation) {
  process.stderr.write(
    `Refusing real video-tool smoke: pass ${CONFIRM_FLAG} for the explicit owner check.\n`
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    // Keep the machine-readable stdout surface deliberately non-sensitive.
    process.stdout.write(
      `${JSON.stringify({
        status: "FAILED",
        tool_result_present: false,
        video_mime: null
      })}\n`
    );
    process.stderr.write(
      `Live owner video-tool smoke failed at safe stage ${currentStage}; no upstream details were printed.\n`
    );
    process.exitCode = 1;
  });
}

async function run() {
  currentStage = "platform";
  if (process.platform !== "darwin") {
    throw new Error("Unsupported local handoff platform.");
  }

  const runtime = createObservedOwnerRuntime({
    requestTimeoutMs: 30_000,
    generateVideoEnabled: true
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-generate-video-tool-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  let toolResult = null;
  try {
    currentStage = "begin_login";
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const approvalLink = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
      throw new Error("No safe user handoff was returned.");
    }

    currentStage = "telegram_handoff";
    // Do not print the approval URI: stdout is reserved for the redacted
    // result summary and the URI is not part of the machine-readable output.
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

    currentStage = "check_login";
    let linked = false;
    for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt += 1) {
      await delay(attempt === 0 ? 1_500 : 1_000);
      const checked = await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: attemptId }
      });
      if (checked.structuredContent?.linked === true) {
        linked = true;
        break;
      }
      const status = checked.structuredContent?.status;
      if (status === "EXPIRED" || status === "FAILED_TERMINAL" || status === "REVOKED") {
        break;
      }
    }
    if (!linked) throw new Error("Login did not complete in time.");

    currentStage = "generate_video_tool";
    // The shipped MCP tool owns the exact settings contract. Calling it here
    // (rather than raw fetch or the application function) closes the tool-path
    // verification gap. The race bounds this local call; it never retries.
    toolResult = await boundedCall(
      client.callTool({
        name: "syntx_owner_generate_video",
        arguments: {
          link_attempt_id: attemptId,
          model_id: FIXED_MODEL_ID,
          prompt: FIXED_PROMPT,
          copies: 1
        }
      }),
      TOOL_TIMEOUT_MS
    );

    const video = toolResult.structuredContent?.videos?.[0];
    const videoMime =
      toolResult.isError === true || typeof video?.mime_type !== "string"
        ? null
        : video.mime_type;
    const passed =
      toolResult.isError !== true &&
      Array.isArray(toolResult.structuredContent?.videos) &&
      toolResult.structuredContent.videos.length > 0 &&
      videoMime === "video/mp4";

    currentStage = "complete";
    process.stdout.write(
      `${JSON.stringify({
        status: passed ? "PASS" : "FAILED",
        tool_result_present: true,
        video_mime: videoMime
      })}\n`
    );
    if (!passed) process.exitCode = 1;
  } finally {
    // Unlink only removes the local credential. After dispatch we deliberately
    // do not delete the chat, retry, or inspect/log the prompt/body/URL: an
    // uncertain paid outcome must remain available for manual reconciliation.
    if (attemptId !== null) {
      currentStage = "unlink";
      await client
        .callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } })
        .catch(() => undefined);
    }
    // Cleanup failures must never overwrite a safe tool result or turn a
    // completed smoke into a misleading provider failure.
    currentStage = "close_client";
    await safeClose(() => client.close());
    currentStage = "close_server";
    await safeClose(() => server.close());
  }
}

async function boundedCall(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded video-tool call timed out")), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function safeClose(close) {
  try {
    await close();
  } catch {
    // Cleanup is best effort and must not replace the safe operation result.
  }
}
