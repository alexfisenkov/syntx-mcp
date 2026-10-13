#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

const confirmationFlag = "--confirm-live-owner-upload-file-smoke";
let currentStage = "guard";
if (!(process.argv.length === 3 && process.argv[2] === confirmationFlag)) {
  process.stderr.write(`Refusing live upload smoke: pass ${confirmationFlag} for the explicit owner mutation.\n`);
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write(`Live owner upload smoke failed at safe stage ${currentStage}; no upstream details were emitted.\n`);
    process.exitCode = 1;
  });
}

async function run() {
  if (process.platform !== "darwin") throw new Error("Unsupported local handoff platform.");
  const runtime = createObservedOwnerRuntime({ uploadFileEnabled: true, requestTimeoutMs: 15_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-upload-file-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  let attemptId = null;
  try {
    currentStage = "begin_login";
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const link = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || link?.type !== "resource_link") throw new Error("login handoff unavailable");
    currentStage = "telegram_handoff";
    await promisify(execFile)("/usr/bin/open", [link.uri], { timeout: 10_000 });
    currentStage = "check_login";
    let linked = false;
    for (let i = 0; i < 40; i += 1) {
      await delay(i === 0 ? 1500 : 1000);
      const checked = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } });
      if (checked.structuredContent?.linked === true) { linked = true; break; }
      if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) break;
    }
    if (!linked) throw new Error("login did not complete");
    currentStage = "upload_file";
    const result = await client.callTool({ name: "syntx_upload_file", arguments: {
      link_attempt_id: attemptId,
      model_id: "uni-1",
      filename: "syntx-mcp-upload-smoke.png",
      mime_type: "image/png",
      content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    }});
    if (result.isError || !result.structuredContent) throw new Error("upload did not return a receipt");
    const value = result.structuredContent;
    if (typeof value.status !== "string" || typeof value.file_id !== "string" || value.mime_type !== "image/png" || !Number.isInteger(value.size) || value.size <= 0) throw new Error("unsafe receipt shape");
    currentStage = "complete";
    process.stdout.write(JSON.stringify({ status: "PASS", receipt_shape: "PASS", local_credential_removed: "PENDING" }) + "\n");
  } finally {
    currentStage = currentStage === "complete" ? currentStage : "unlink";
    if (attemptId !== null) await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).catch(() => undefined);
    await client.close(); await server.close();
  }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
