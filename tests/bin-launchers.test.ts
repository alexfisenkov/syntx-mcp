import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { TOOL_NAMES } from "../src/mcp/server.js";

test(
  "npm-style symlinked stdio launcher initializes instead of exiting silently",
  { timeout: 5000 },
  async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "syntx-bin-"));
    const launcher = join(temporaryDirectory, "syntx-mcp-stdio");
    symlinkSync(resolve("dist/src/transports/stdio.js"), launcher);
    const client = new Client({ name: "symlink-stdio-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [launcher],
      cwd: process.cwd(),
      stderr: "pipe"
    });

    try {
      await client.connect(transport as unknown as Transport);
      const tools = await client.listTools();
      assert.deepEqual(
        tools.tools.map((tool) => tool.name),
        TOOL_NAMES
      );
    } finally {
      await client.close().catch(() => undefined);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

test(
  "npm-style symlinked HTTP launcher listens and serves health",
  { timeout: 5000 },
  async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "syntx-bin-"));
    const launcher = join(temporaryDirectory, "syntx-mcp-http");
    symlinkSync(resolve("dist/src/transports/http.js"), launcher);
    const port = await reservePort();
    const child = spawn(process.execPath, [launcher], {
      cwd: process.cwd(),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) }
    });

    try {
      await waitForStderr(child, "MCP HTTP server listening");
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(response.status, 200);
      assert.equal((await response.json() as { status?: string }).status, "ok");
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child);
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
);

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

function waitForStderr(
  child: ChildProcessWithoutNullStreams,
  expected: string
): Promise<void> {
  return new Promise((resolveWait, reject) => {
    let stderr = "";
    const onData = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.includes(expected)) {
        cleanup();
        resolveWait();
      }
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `HTTP launcher exited with code ${String(code)} before listening; stderr=${stderr}`
        )
      );
    };
    const cleanup = () => {
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };
    child.stderr.on("data", onData);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()));
}
