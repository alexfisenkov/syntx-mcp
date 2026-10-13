#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";
import { ACCOUNT_CONTRACT_EVIDENCE } from "../dist/src/adapter/syntx/account-decoder.js";

let currentStage = "guard";
const confirmationFlag = "--confirm-live-owner-account-status-smoke";
const hasExactCliConfirmation =
  process.argv.length === 3 && process.argv[2] === confirmationFlag;

// This is an explicit read-only owner check. There is intentionally no
// environment-variable bypass: account data must never be read accidentally.
if (!hasExactCliConfirmation) {
  process.stderr.write(
    `Refusing live account-status smoke: pass ${confirmationFlag} for the explicit owner check.\n`
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(
      `Live owner account-status smoke failed at safe stage ${currentStage} without exposing account details.\n`
    );
    process.exitCode = 1;
  });
}

async function run() {
  currentStage = "platform";
  if (process.platform !== "darwin") {
    throw new Error("Unsupported local handoff platform.");
  }

  currentStage = "runtime_initialization";
  const runtime = createObservedOwnerRuntime({
    accountStatusEnabled: true,
    requestTimeoutMs: 15_000
  });
  currentStage = "server_initialization";
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-account-status-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
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

    currentStage = "account_status";
    const status = await client.callTool({
      name: "syntx_get_account_status",
      arguments: { link_attempt_id: attemptId }
    });
    if (status.isError || !status.structuredContent) {
      throw new Error("Account-status read did not return a result.");
    }
    currentStage = "account_status_shape";
    assertSafeAccountStatusShape(status.structuredContent);

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
    // Never print balance, subscription state, plan, dates, IDs, or upstream
    // payloads. This summary proves only that the read-only tool returned.
    process.stdout.write(
      `${JSON.stringify({
        telegram_link: "PASS",
        account_status_read: "PASS",
        shape_check: "PASS",
        returned_fields: "REDACTED",
        local_credential_removed: "PASS",
        generation_started: false
      })}\n`
    );
  } finally {
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

function assertSafeAccountStatusShape(value) {
  if (!isRecord(value)) throw new Error("Account-status shape is not an object.");
  if (!isRecord(value.balance) || value.balance.unit !== "tokens") {
    throw new Error("Account-status balance shape is invalid.");
  }
  if (value.balance.available !== null && typeof value.balance.available !== "string") {
    throw new Error("Account-status balance shape is invalid.");
  }
  if (!isRecord(value.subscription)) {
    throw new Error("Account-status subscription shape is invalid.");
  }
  if (value.subscription.active !== null && typeof value.subscription.active !== "boolean") {
    throw new Error("Account-status subscription shape is invalid.");
  }
  for (const field of ["plan_type", "end_date", "end_date_kind"]) {
    if (value.subscription[field] !== null && typeof value.subscription[field] !== "string") {
      throw new Error("Account-status subscription shape is invalid.");
    }
  }
  if (value.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE) {
    throw new Error("Account-status contract evidence is missing.");
  }
  if (typeof value.source_build !== "string" || typeof value.observed_at !== "string") {
    throw new Error("Account-status provenance shape is invalid.");
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
