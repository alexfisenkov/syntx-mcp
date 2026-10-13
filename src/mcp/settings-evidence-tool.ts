import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizedSettingsParserGenericFormResultSchema } from "../catalog/normalized-settings-parser-generic-form-result.js";

export const SYNTX_SETTINGS_EVIDENCE_TOOL_NAME = "syntx_get_settings_evidence" as const;
const outputSchema = z.object({
  schema_version: z.literal("1.0.0"), network_access: z.literal(false), paid_operations: z.literal(false),
  results: z.array(z.object({ artifact_file: z.string(), form_id: z.string(), ai_name: z.string(), model_ids: z.array(z.string()), census_artifact_sha256: z.string(), public_catalog_sha256: z.string(), source_inventory_sha256: z.string(), completeness: z.literal("PARTIAL"), runtime_usable: z.literal(false), proven_projections: z.number().int().nonnegative(), blocked_projections: z.number().int().nonnegative(), form_blockers: z.number().int().nonnegative(), defaults: z.record(z.string(), z.unknown()) }).strict())
}).strict();
export type SettingsEvidenceOutput = z.infer<typeof outputSchema>;

export function registerSyntxSettingsEvidenceTool(server: McpServer): void {
  server.registerTool(SYNTX_SETTINGS_EVIDENCE_TOOL_NAME, {
    title: "Get version-bound settings evidence",
    description: "Read the immutable v8 generic settings evidence index. This is static, partial frontend evidence only: it performs no network/auth/paid operation and never claims an executable backend settings contract.",
    inputSchema: z.object({ form_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u).optional() }).strict(),
    outputSchema,
    annotations: { title: "Get version-bound settings evidence", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ form_id }): Promise<CallToolResult> => {
    const output = readSettingsEvidence(form_id);
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
  });
}

function readSettingsEvidence(formId?: string): SettingsEvidenceOutput {
  const candidates = [
    fileURLToPath(new URL("../../catalog/runtime/v8/generic", import.meta.url)),
    fileURLToPath(new URL("../../../catalog/runtime/v8/generic", import.meta.url))
  ];
  const directory = candidates.find((candidate) => {
    try { return readdirSync(candidate).length >= 0; } catch { return false; }
  }) ?? candidates[0]!;
  let entries: string[];
  try { entries = readdirSync(directory).filter((entry) => entry.endsWith(".json")).sort(); } catch { entries = []; }
  const results = entries.flatMap((artifactFile) => {
    try {
      const parsed = normalizedSettingsParserGenericFormResultSchema.parse(JSON.parse(readFileSync(join(directory, artifactFile), "utf8")));
      if (formId !== undefined && parsed.scope.form_id !== formId) return [];
      return [{ artifact_file: artifactFile, form_id: parsed.scope.form_id, ai_name: parsed.scope.ai_name, model_ids: [...parsed.scope.model_ids], census_artifact_sha256: parsed.bindings.census_manifest.artifact_sha256, public_catalog_sha256: parsed.bindings.census_manifest.public_catalog_sha256, source_inventory_sha256: parsed.bindings.census_manifest.source_inventory_sha256, completeness: "PARTIAL" as const, runtime_usable: false as const, proven_projections: parsed.result.summary.proven_projections, blocked_projections: parsed.result.summary.blocked_projections, form_blockers: parsed.result.summary.form_blockers, defaults: { ...parsed.form.projections.defaults } }];
    } catch { return []; }
  });
  return { schema_version: "1.0.0", network_access: false, paid_operations: false, results };
}
