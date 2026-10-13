#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

/**
 * One-off, throwaway smoke test (not a shipped path): calls the REAL
 * shipped `syntx_owner_generate_image` MCP tool end-to-end, exactly as a
 * real MCP client would — not raw fetch, not generateOneOwnerImage()
 * directly. Closes the observation gap named in решения.md/DEBT-055: the
 * tool itself had never been executed against live SYNTX. Makes exactly
 * one REAL, PAID generation.
 */

const CONFIRM_FLAG = "--confirm-live-generate-tool-smoke";
const promptArg = process.argv[3];
const hasConfirmation =
  process.argv.length === 4 &&
  process.argv[2] === CONFIRM_FLAG &&
  typeof promptArg === "string" &&
  promptArg.length > 0;

if (!hasConfirmation) {
  process.stderr.write(
    `Refusing: this makes one REAL, PAID call through the shipped syntx_owner_generate_image tool.\nUsage: live-owner-generate-tool-smoke.mjs ${CONFIRM_FLAG} "<prompt text>"\n`
  );
  process.exitCode = 2;
} else {
  await run(promptArg).catch((error) => {
    process.stderr.write(`Smoke test failed: ${error instanceof Error ? error.message : "unknown"}\n`);
    process.exitCode = 1;
  });
}

async function run(prompt) {
  if (process.platform !== "darwin") {
    throw new Error("Unsupported local handoff platform.");
  }

  const runtime = createObservedOwnerRuntime({
    requestTimeoutMs: 30_000,
    generateImageEnabled: true
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "syntx-owner-generate-tool-smoke", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  let attemptId = null;
  try {
    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} });
    attemptId = begun.structuredContent?.attempt_id;
    const approvalLink = begun.content.find((item) => item.type === "resource_link");
    if (typeof attemptId !== "string" || approvalLink?.type !== "resource_link") {
      throw new Error("No safe user handoff was returned.");
    }
    process.stdout.write(`Approve login in Telegram: ${approvalLink.uri}\n`);
    await promisify(execFile)("/usr/bin/open", [approvalLink.uri], { timeout: 10_000 });

    let linked = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
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
      if (status === "EXPIRED" || status === "FAILED_TERMINAL" || status === "REVOKED") break;
    }
    if (!linked) throw new Error("Login did not complete in time.");
    process.stdout.write("Login confirmed.\n");

    process.stdout.write("Calling the real syntx_owner_generate_image tool now (real, paid dispatch)...\n");
    const result = await client.callTool({
      name: "syntx_owner_generate_image",
      arguments: {
        link_attempt_id: attemptId,
        prompt,
        copies: 1,
        aspect_ratio: "1:1"
      }
    });
    process.stdout.write(`Tool result: ${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (attemptId !== null) {
      await client
        .callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } })
        .catch(() => undefined);
    }
    await client.close();
    await server.close();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
