#!/usr/bin/env node
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

let currentStage = "guard";
const confirmationFlag = "--confirm-live-owner-chat-smoke";
const hasExactCliConfirmation =
  process.argv.length === 3 && process.argv[2] === confirmationFlag;
const hasLegacyEnvironmentConfirmation =
  process.argv.length === 2 && process.env.SYNTX_LIVE_CHAT_SMOKE === "1";

if (!hasExactCliConfirmation && !hasLegacyEnvironmentConfirmation) {
  process.stderr.write(
    `Refusing live chat smoke: pass ${confirmationFlag} or set SYNTX_LIVE_CHAT_SMOKE=1 for the explicit owner check.\n`
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(
      `Live owner chat smoke failed at safe stage ${currentStage} without exposing upstream or account details.\n`
    );
    process.exitCode = 1;
  });
}

async function run() {
  currentStage = "platform";
  if (process.platform !== "darwin") {
    throw new Error("Unsupported local handoff platform.");
  }

  const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 15_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-chat-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  let chatUuid = null;
  let chatClient = null;
  try {
    currentStage = "begin_login";
    const begun = await client.callTool({
      name: "syntx_begin_login",
      arguments: {}
    });
    attemptId = begun.structuredContent?.attempt_id;
    const approvalLink = begun.content.find(
      (item) => item.type === "resource_link"
    );
    if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
      throw new Error("No safe user handoff was returned.");
    }

    currentStage = "telegram_handoff";
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri], {
      timeout: 10_000
    });

    currentStage = "check_login";
    let linked = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
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
      if (
        status === "EXPIRED" ||
        status === "FAILED_TERMINAL" ||
        status === "REVOKED"
      ) {
        break;
      }
    }
    if (!linked) throw new Error("Login did not complete.");

    chatClient = runtime.createChatClient(attemptId);
    const opaqueTitle = `mcp-empty-smoke-${randomUUID()}`;
    currentStage = "create_empty_chat";
    const created = await chatClient.createChat(
      "text",
      opaqueTitle,
      AbortSignal.timeout(15_000)
    );
    chatUuid = created.chat_uuid;

    currentStage = "delete_empty_chat";
    await chatClient.deleteChat(chatUuid, AbortSignal.timeout(15_000));
    chatUuid = null;

    currentStage = "unlink";
    const unlinked = await client.callTool({
      name: "syntx_unlink",
      arguments: { attempt_id: attemptId }
    });
    if (unlinked.structuredContent?.status !== "REVOKED") {
      throw new Error("Local unlink was not confirmed.");
    }
    attemptId = null;

    currentStage = "complete";
    process.stdout.write(
      `${JSON.stringify({
        telegram_link: "PASS",
        isolated_empty_chat_create: "PASS",
        isolated_empty_chat_delete: "PASS",
        local_credential_removed: "PASS",
        generation_started: false
      })}\n`
    );
  } finally {
    if (chatUuid !== null && chatClient !== null) {
      currentStage = "cleanup_chat";
      await chatClient
        .deleteChat(chatUuid, AbortSignal.timeout(15_000))
        .catch(() => undefined);
    }
    if (attemptId !== null) {
      currentStage = "cleanup_unlink";
      await client
        .callTool({
          name: "syntx_unlink",
          arguments: { attempt_id: attemptId }
        })
        .catch(() => undefined);
    }
    await client.close();
    await server.close();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
