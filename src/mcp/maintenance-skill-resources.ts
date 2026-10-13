import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SYNTX_MAINTENANCE_RESOURCE_URIS = Object.freeze({
  skill: "syntx://maintenance/skill",
  cliGuide: "syntx://maintenance/cli-guide",
  uiGuide: "syntx://maintenance/ui-guide"
} as const);

export type MaintenanceSkillResourceErrorCode =
  | "MAINTENANCE_RESOURCE_NOT_FOUND"
  | "MAINTENANCE_RESOURCE_UNAVAILABLE"
  | "MAINTENANCE_RESOURCE_TOO_LARGE"
  | "MAINTENANCE_RESOURCE_SYMLINK_REJECTED"
  | "MAINTENANCE_RESOURCE_INVALID_UTF8";

interface ResourceSpec {
  readonly name: string;
  readonly title: string;
  readonly uri: string;
  readonly relativePath: string;
  readonly description: string;
}

const MAX_RESOURCE_BYTES = 64 * 1024;
const RESOURCE_SPECS: readonly ResourceSpec[] = Object.freeze([
  Object.freeze({
    name: "syntx-maintenance-skill",
    title: "SYNTX MCP maintenance skill",
    uri: SYNTX_MAINTENANCE_RESOURCE_URIS.skill,
    relativePath: "skills/syntx-mcp-update/SKILL.md",
    description: "Portable instructions for maintaining SYNTX MCP catalog and settings coverage."
  }),
  Object.freeze({
    name: "syntx-maintenance-cli-guide",
    title: "SYNTX MCP maintenance CLI guide",
    uri: SYNTX_MAINTENANCE_RESOURCE_URIS.cliGuide,
    relativePath: "skills/syntx-mcp-update/references/maintenance-cli.md",
    description: "Offline compare and explicitly confirmed public catalog probe usage."
  }),
  Object.freeze({
    name: "syntx-maintenance-ui-guide",
    title: "SYNTX MCP maintenance UI audit guide",
    uri: SYNTX_MAINTENANCE_RESOURCE_URIS.uiGuide,
    relativePath: "skills/syntx-mcp-update/references/ui-audit-and-adaptation.md",
    description: "Safe UI coverage and source-to-code impact mapping guidance."
  })
]);

/** Register fixed, read-only package resources; no URI or path comes from a caller. */
export function registerSyntxMaintenanceSkillResources(
  server: Pick<McpServer, "registerResource">
): void {
  for (const resource of RESOURCE_SPECS) {
    server.registerResource(resource.name, resource.uri, {
      title: resource.title,
      description: resource.description,
      mimeType: "text/markdown"
    }, async (uri) => {
      if (uri.href !== resource.uri) throw new Error("MAINTENANCE_RESOURCE_NOT_FOUND");
      try {
        const text = await readPackagedResource(resource.relativePath);
        return {
          contents: [{ uri: resource.uri, mimeType: "text/markdown", text }]
        };
      } catch (error) {
        const code = error instanceof MaintenanceSkillResourceReadError
          ? error.code
          : "MAINTENANCE_RESOURCE_UNAVAILABLE";
        throw new Error(code);
      }
    });
  }
}

class MaintenanceSkillResourceReadError extends Error {
  readonly code: MaintenanceSkillResourceErrorCode;

  constructor(code: MaintenanceSkillResourceErrorCode) {
    super(code);
    this.name = "MaintenanceSkillResourceReadError";
    this.code = code;
  }
}

async function readPackagedResource(relativePath: string): Promise<string> {
  const root = await resolvePackageRoot(import.meta.url);
  const targetPath = resolve(root, ...relativePath.split("/"));
  const fromRoot = relative(root, targetPath);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  }

  let currentPath = root;
  const segments = relativePath.split("/");
  for (const [index, segment] of segments.entries()) {
    currentPath = resolve(currentPath, segment);
    let entry;
    try {
      entry = await lstat(currentPath);
    } catch {
      throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
    }
    if (entry.isSymbolicLink()) {
      throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_SYMLINK_REJECTED");
    }
    if (index < segments.length - 1 ? !entry.isDirectory() : !entry.isFile()) {
      throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
    }
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(currentPath);
  } catch {
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  }
  if (canonicalTarget !== currentPath) {
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_SYMLINK_REJECTED");
  }

  let file;
  try {
    file = await open(currentPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
    if (stat.size > MAX_RESOURCE_BYTES) throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_TOO_LARGE");

    const output = Buffer.alloc(MAX_RESOURCE_BYTES + 1);
    let total = 0;
    while (total < output.byteLength) {
      const { bytesRead } = await file.read(output, total, output.byteLength - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_RESOURCE_BYTES) {
        throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_TOO_LARGE");
      }
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(output.subarray(0, total));
    } catch {
      throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_INVALID_UTF8");
    }
  } catch (error) {
    if (error instanceof MaintenanceSkillResourceReadError) throw error;
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function resolvePackageRoot(moduleUrl: string): Promise<string> {
  let moduleDirectory: string;
  try {
    moduleDirectory = dirname(fileURLToPath(moduleUrl));
  } catch {
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  }
  const segments = moduleDirectory.split(sep).filter((segment) => segment.length > 0);
  const compiledModule = segments.slice(-3).join("/") === "dist/src/mcp";
  const sourceModule = segments.slice(-2).join("/") === "src/mcp";
  const root = compiledModule
    ? resolve(moduleDirectory, "../../../")
    : sourceModule
      ? resolve(moduleDirectory, "../../")
      : null;
  if (root === null) throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  try {
    return await realpath(root);
  } catch {
    throw new MaintenanceSkillResourceReadError("MAINTENANCE_RESOURCE_UNAVAILABLE");
  }
}
