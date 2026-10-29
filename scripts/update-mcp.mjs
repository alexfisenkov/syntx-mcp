#!/usr/bin/env node
import { McpSelfUpdateService } from "../dist/src/application/mcp-self-update-service.js";

const command = process.argv[2] ?? "check";
if (!new Set(["check", "apply", "rollback"]).has(command) || process.argv.length > 3) {
  console.error("Usage: syntx-mcp-update [check|apply|rollback]");
  process.exitCode = 2;
} else {
  const service = new McpSelfUpdateService();
  const result = command === "apply" ? await service.apply() : command === "rollback" ? await service.rollback() : await service.check();
  console.log(JSON.stringify(result));
  if (["UNAVAILABLE", "UPDATE_FAILED", "UNSUPPORTED_INSTALLATION", "BUSY", "ROLLBACK_INVALID"].includes(result.status)) process.exitCode = 1;
}
