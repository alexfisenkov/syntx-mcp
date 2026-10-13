#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

let currentStage = "guard";
let failureStage = null;
const confirmationFlag = "--confirm-live-owner-uploaded-files-smoke";
const hasExactCliConfirmation =
  process.argv.length === 3 && process.argv[2] === confirmationFlag;

// This is an explicit owner-authorized, read-only GET. There is deliberately
// no environment-variable bypass, and no upload/delete/download path here.
if (!hasExactCliConfirmation) {
  process.stderr.write(
    `Refusing live uploaded-files smoke: pass ${confirmationFlag} for the explicit owner check.\n`
  );
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(
      `Live owner uploaded-files smoke failed at safe stage ${failureStage ?? currentStage} without exposing file metadata.\n`
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
    uploadedFilesEnabled: true,
    requestTimeoutMs: 15_000
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-uploaded-files-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  let cleanupPassed = false;
  try {
    currentStage = "begin_login";
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
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

    currentStage = "uploaded_files_read";
    const result = await client.callTool({
      name: "syntx_list_uploaded_files",
      arguments: { link_attempt_id: attemptId, scope: "all", page: 1, page_size: 10 }
    });
    if (result.isError) {
      const text = result.content.find((item) => item.type === "text")?.text ?? "";
      const code = /^\{"error":\{"code":"([A-Z_]+)"/u.exec(text)?.[1] ?? "UNKNOWN_ERROR";
      process.stdout.write(`${JSON.stringify({ status: "UPSTREAM_READ_ERROR", error_code: code, local_credential_removed: "PENDING" })}\n`);
      throw new Error("Uploaded-files read returned a controlled error.");
    }
    if (!result.structuredContent) {
      throw new Error("Uploaded-files read did not return a result.");
    }

    currentStage = "uploaded_files_shape";
    assertSafeUploadedFilesShape(result.structuredContent);
    const itemCount = result.structuredContent.items.length;
    const hasMore = result.structuredContent.has_more;

    currentStage = "unlink";
    const unlinked = await client.callTool({
      name: "syntx_unlink",
      arguments: { attempt_id: attemptId }
    });
    cleanupPassed = unlinked.structuredContent?.status === "REVOKED";
    if (!cleanupPassed) throw new Error("Local unlink was not confirmed.");
    attemptId = null;

    currentStage = "complete";
    process.stdout.write(`${JSON.stringify({
      status: "PASS",
      shape_check: "PASS",
      item_count: itemCount,
      has_more: hasMore,
      local_credential_removed: "PASS"
    })}\n`);
  } finally {
    if (failureStage === null && currentStage !== "complete") failureStage = currentStage;
    if (attemptId !== null) {
      currentStage = "cleanup_unlink";
      await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).then((value) => {
        cleanupPassed = value.structuredContent?.status === "REVOKED";
      }).catch(() => undefined);
    }
    await client.close();
    await server.close();
    void cleanupPassed;
  }
}

function assertSafeUploadedFilesShape(value) {
  if (!isRecord(value)) throw new Error("Uploaded-files shape is not an object.");
  if (value.page !== 1 || value.page_size !== 10 || typeof value.has_more !== "boolean") {
    throw new Error("Uploaded-files page shape is invalid.");
  }
  if (value.total !== null && !Number.isInteger(value.total)) {
    throw new Error("Uploaded-files total shape is invalid.");
  }
  if (!Array.isArray(value.items) || value.items.length > 10) {
    throw new Error("Uploaded-files items shape is invalid.");
  }
  for (const item of value.items) {
    if (!isRecord(item)) throw new Error("Uploaded-files item shape is invalid.");
    for (const key of ["id", "filename", "mime_type", "created_at"]) {
      if (item[key] !== undefined && typeof item[key] !== "string") {
        throw new Error("Uploaded-files item metadata shape is invalid.");
      }
    }
    if (item.size !== undefined && (!Number.isInteger(item.size) || item.size < 0)) {
      throw new Error("Uploaded-files item size shape is invalid.");
    }
    for (const forbidden of ["url", "object_url", "signed_url", "download_url"]) {
      if (forbidden in item) throw new Error("Uploaded-files returned a forbidden URL field.");
    }
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
