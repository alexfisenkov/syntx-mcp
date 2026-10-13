#!/usr/bin/env node
import { createObservedOwnerRuntime } from "../runtime/observed-owner-runtime.js";
import { createHttpServer } from "./http.js";
import { isMainModule } from "./is-main.js";

const LOOPBACK_HOST = "127.0.0.1";

export function createObservedOwnerHttpServer(port: number) {
  // Deliberately narrower than stdio-owner.ts: neither account-status nor
  // real-money generation is exposed over HTTP yet — both need a separate
  // authentication decision first (DEBT-050), not just an env flag.
  const runtime = createObservedOwnerRuntime();
  const allowedOrigins = [
    `http://${LOOPBACK_HOST}:${port}`,
    `http://localhost:${port}`
  ];
  return createHttpServer({
    allowedOrigins,
    resolveApplication: () => runtime.application,
    resolveMcpServerOptions: () => runtime.serverOptions
  });
}

function parseOwnerPort(value: string | undefined): number {
  const port = Number(value ?? "3030");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("OWNER_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

if (isMainModule(import.meta.url)) {
  const port = parseOwnerPort(process.env.OWNER_PORT);
  const server = createObservedOwnerHttpServer(port);
  server.listen(port, LOOPBACK_HOST, () => {
    console.error(
      `Local owner MCP server listening on http://${LOOPBACK_HOST}:${port}/mcp`
    );
  });
}
