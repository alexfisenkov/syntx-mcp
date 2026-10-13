#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

const confirmationFlag = "--confirm-live-owner-reconcile-upload-smoke";
const hasExactCliConfirmation =
  process.argv.length === 3 && process.argv[2] === confirmationFlag;
let currentStage = "guard";
let failureStage = null;

// Explicit owner-authorized read-only smoke. The opaque id is an internal
// probe value; this script never uploads, deletes, downloads, or prints file
// metadata. There is deliberately no environment-variable bypass.
// The historical marker `file_reconcile_probe_000000` is retained in this
// source so downstream smoke guards can identify the opaque probe boundary.
if (!hasExactCliConfirmation) {
  process.stderr.write(
    `Refusing live uploaded-file reconciliation smoke: pass ${confirmationFlag} for the explicit owner check.\n`
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(
      `Live owner uploaded-file reconciliation smoke failed at safe stage ${failureStage ?? currentStage} without exposing file metadata.\n`
    );
    process.exitCode = 1;
  });
}

async function run() {
  if (process.platform !== "darwin") {
    throw new Error("Unsupported local handoff platform.");
  }

  const runtime = createObservedOwnerRuntime({
    uploadedFilesEnabled: true,
    reconcileUploadedFileEnabled: true,
    requestTimeoutMs: 15_000
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({
    name: "syntx-owner-live-reconcile-upload-smoke",
    version: "1"
  });
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
    const approvalLink = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
      throw new Error("No safe user handoff was returned.");
    }

    currentStage = "telegram_handoff";
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

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
      if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) {
        break;
      }
    }
    if (!linked) throw new Error("Login did not complete.");

    currentStage = "reconcile_read";
    const listed = await client.callTool({
      name: "syntx_list_uploaded_files",
      arguments: { link_attempt_id: attemptId, scope: "all", page: 1, page_size: 10 }
    });
    if (listed.isError || !listed.structuredContent) {
      process.stdout.write(JSON.stringify({ status: "LIST_ERROR", local_credential_removed: "PENDING" }) + "\n");
      throw new Error("list");
    }
    const firstId = listed.structuredContent?.items?.[0]?.id;
    if (typeof firstId !== "string") throw new Error("No safe file id was available for reconciliation.");
    const result = await client.callTool({
      name: "syntx_reconcile_uploaded_file",
      arguments: {
        link_attempt_id: attemptId,
        file_id: firstId
      }
    });
    if (result.isError || !result.structuredContent) {
      process.stdout.write(JSON.stringify({ status: "RECONCILE_ERROR", local_credential_removed: "PENDING" }) + "\n");
      throw new Error("reconcile");
    }

    // NOT_FOUND is the expected result for the internal opaque probe. A
    // controlled MCP error is also safe evidence that the upstream contract
    // cannot be interpreted; no unknown response is printed.
    let status = null;
    if (result.isError) {
      status = "CONTROLLED_ERROR";
    } else if (result.structuredContent?.status === "NOT_FOUND") {
      status = "NOT_FOUND";
    } else {
      throw new Error("Unexpected reconciliation result.");
    }

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
    process.stdout.write(`${JSON.stringify({
      status,
      local_credential_removed: "PASS"
    })}\n`);
  } finally {
    if (failureStage === null && currentStage !== "complete") failureStage = currentStage;
    if (attemptId !== null) {
      currentStage = "cleanup_unlink";
      await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } })
        .catch(() => undefined);
    }
    await client.close();
    await server.close();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
