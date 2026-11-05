import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SYNTX_MAINTENANCE_RESOURCE_URIS } from "../mcp/maintenance-skill-resources.js";

const forbiddenTools = new Set([
  "syntx_upload_standard_image_reference_file",
  "syntx_update_check", "syntx_update_apply", "syntx_update_rollback"
]);
const forbiddenInputProperties = new Set(["absolute_path", "local_path", "file_path", "command", "executable", "environment", "cwd"]);
export const REMOTE_OWNER_RESOURCE_URIS: ReadonlySet<string> = new Set(Object.values(SYNTX_MAINTENANCE_RESOURCE_URIS));

/** Fail closed for local-execution inputs even if a future local tool changes its name. */
export function isRemoteOwnerToolAllowed(tool: Tool): boolean {
  if (!/^syntx_[a-z0-9_]+$/u.test(tool.name) || forbiddenTools.has(tool.name)) return false;
  const inspect = (value: unknown, depth: number): boolean => {
    if (depth > 40) return false;
    if (value === null || typeof value !== "object") return true;
    if (Array.isArray(value)) return value.every((item) => inspect(item, depth + 1));
    const record = value as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object" &&
        Object.keys(record.properties).some((key) => forbiddenInputProperties.has(key))) return false;
    return Object.values(record).every((item) => inspect(item, depth + 1));
  };
  return inspect(tool.inputSchema, 0);
}
