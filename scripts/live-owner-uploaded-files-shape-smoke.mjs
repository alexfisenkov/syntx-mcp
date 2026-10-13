#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

const confirmationFlag = "--confirm-live-owner-uploaded-files-shape-smoke";
if (process.argv.length !== 3 || process.argv[2] !== confirmationFlag) {
  process.stderr.write(`Refusing live uploaded-files shape smoke: pass ${confirmationFlag} for the explicit owner check.\n`);
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write("Live owner uploaded-files shape smoke failed at a safe redacted stage.\n");
    process.exitCode = 1;
  });
}

async function run() {
  if (process.platform !== "darwin") throw new Error("Unsupported local handoff platform.");
  const runtime = createObservedOwnerRuntime({ requestTimeoutMs: 15_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-uploaded-files-shape-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  try {
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const approvalLink = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") throw new Error("No safe user handoff was returned.");
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

    let linked = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(attempt === 0 ? 1_500 : 1_000);
      const checked = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } });
      if (checked.structuredContent?.linked === true) { linked = true; break; }
      if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) break;
    }
    if (!linked) throw new Error("Login did not complete.");

    // One authenticated GET only. The diagnostic decoder returns shape, never values.
    const summary = await runtime.createReadClient(attemptId).inspectUploadedFilesResponseShape({ scope: "all", page: 1, page_size: 10 });
    assertSafeShapeSummary(summary);
    const unlinked = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } });
    if (unlinked.structuredContent?.status !== "REVOKED") throw new Error("Local unlink was not confirmed.");
    attemptId = null;
    process.stdout.write(`${JSON.stringify({
      status: "SHAPE_ONLY",
      decoder_status: summary.decoder_status,
      top_level: summary.top_level,
      item: summary.item ?? null,
      local_credential_removed: "PASS"
    })}\n`);
  } finally {
    if (attemptId !== null) await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).catch(() => undefined);
    await client.close();
    await server.close();
  }
}

function assertSafeShapeSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shape summary.");
  if (!["PASS", "UPSTREAM_PROTOCOL_ERROR"].includes(value.decoder_status)) throw new Error("Invalid decoder status.");
  for (const record of [value.top_level, value.item].filter(Boolean)) {
    if (!Array.isArray(record.keys) || !record.keys.every((key) => typeof key === "string")) throw new Error("Invalid shape keys.");
    if (!record.types || typeof record.types !== "object" || Array.isArray(record.types)) throw new Error("Invalid shape types.");
    for (const key of record.keys) if (!["null", "object", "array", "string", "number", "boolean"].includes(record.types[key])) throw new Error("Invalid shape type.");
  }
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
