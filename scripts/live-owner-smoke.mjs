#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

let currentStage = "guard";
const confirmationFlag = "--confirm-live-owner-smoke";
const hasExactCliConfirmation =
  process.argv.length === 3 && process.argv[2] === confirmationFlag;
const hasLegacyEnvironmentConfirmation =
  process.argv.length === 2 && process.env.SYNTX_LIVE_SMOKE === "1";

if (!hasExactCliConfirmation && !hasLegacyEnvironmentConfirmation) {
  process.stderr.write(
    `Refusing live auth: pass ${confirmationFlag} or set SYNTX_LIVE_SMOKE=1 for the explicit owner smoke.\n`
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(
      `Live owner smoke failed at safe stage ${currentStage} without exposing upstream or account details.\n`
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
  const client = new Client({ name: "syntx-owner-live-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  try {
    currentStage = "catalog";
    const catalog = await client.callTool({
      name: "syntx_search_models",
      arguments: { query: "banana2", limit: 5 }
    });
    if (catalog.structuredContent?.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT") {
      throw new Error("Unexpected catalog profile.");
    }

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
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri]);

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

    currentStage = "model_access";
    const access = await client.callTool({
      name: "syntx_get_model_access",
      arguments: {
        link_attempt_id: attemptId,
        model_id: "banana2",
        cost_parameters: { image_size: "2K" }
      }
    });
    if (
      access.isError ||
      typeof access.structuredContent?.access !== "boolean" ||
      typeof access.structuredContent?.cost !== "number"
    ) {
      throw new Error("Account-scoped model info shape was not confirmed.");
    }

    currentStage = "unlink";
    await client.callTool({
      name: "syntx_unlink",
      arguments: { attempt_id: attemptId }
    });
    attemptId = null;
    currentStage = "complete";
    process.stdout.write(
      `${JSON.stringify({
        catalog_snapshot: "PASS",
        telegram_link: "PASS",
        account_model_info_shape: "PASS",
        local_credential_removed: "PASS",
        generation_started: false
      })}\n`
    );
  } finally {
    if (attemptId !== null) {
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
