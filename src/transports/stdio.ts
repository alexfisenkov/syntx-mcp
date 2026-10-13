#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ApplicationCore } from "../application/core.js";
import { createDefaultApplication } from "../application/factory.js";
import {
  createMcpServer,
  type CreateMcpServerOptions
} from "../mcp/server.js";
import { isMainModule } from "./is-main.js";
import { withOmittedAuthArguments } from "./omitted-auth-arguments.js";

export async function runStdioServer(
  application: ApplicationCore = createDefaultApplication(),
  serverOptions: CreateMcpServerOptions = {}
): Promise<void> {
  const server = createMcpServer(application, serverOptions);
  await server.connect(
    withOmittedAuthArguments(new StdioServerTransport())
  );
}

if (isMainModule(import.meta.url)) {
  runStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown startup error";
    console.error(`Failed to start stdio MCP server: ${message}`);
    process.exitCode = 1;
  });
}
