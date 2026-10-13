#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

const flag = "--confirm-live-owner-uploaded-files-hidden-smoke";
if (process.argv.length !== 3 || process.argv[2] !== flag) {
  process.stderr.write(`Refusing hidden-files smoke: pass ${flag}.\n`);
  process.exitCode = 2;
} else {
  await run().catch(() => {
    process.stderr.write("Hidden-files smoke failed at a safe redacted stage.\n");
    process.exitCode = 1;
  });
}

async function run() {
  const runtime = createObservedOwnerRuntime({ uploadedFilesEnabled: true, requestTimeoutMs: 15_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-live-hidden-files-smoke", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  let attemptId = null;
  try {
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const link = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || link?.type !== "resource_link") throw new Error("handoff");
    await promisify(execFile)("/usr/bin/open", [link.uri], { timeout: 10_000 });
    let linked = false;
    for (let i = 0; i < 40; i += 1) {
      await delay(i === 0 ? 1500 : 1000);
      const checked = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } });
      if (checked.structuredContent?.linked === true) { linked = true; break; }
      if (["EXPIRED", "FAILED_TERMINAL", "REVOKED"].includes(checked.structuredContent?.status)) break;
    }
    if (!linked) throw new Error("login");
    const result = await client.callTool({ name: "syntx_list_uploaded_files", arguments: { link_attempt_id: attemptId, scope: "hidden", page: 1, page_size: 100 } });
    if (result.isError || !result.structuredContent) throw new Error("read");
    const value = result.structuredContent;
    if (!Array.isArray(value.items) || typeof value.has_more !== "boolean") throw new Error("shape");
    await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } });
    attemptId = null;
    process.stdout.write(JSON.stringify({ status: "PASS", shape_check: "PASS", hidden_item_count: value.items.length, has_more: value.has_more, local_credential_removed: "PASS" }) + "\n");
  } finally {
    if (attemptId !== null) await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }).catch(() => undefined);
    await client.close(); await server.close();
  }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
