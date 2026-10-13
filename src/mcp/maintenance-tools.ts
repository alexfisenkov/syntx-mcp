import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  buildSyntxMaintenanceAuditPlan,
  SyntxMaintenanceAuditPlanError,
  type SyntxMaintenanceAuditPlanV1
} from "../application/syntx-maintenance-audit-plan.js";
import {
  buildSyntxMaintenanceControlWalk,
  SyntxMaintenanceControlWalkError,
  type SyntxMaintenanceControlWalkV1
} from "../application/syntx-maintenance-control-walk.js";
import { SyntxMaintenanceReportError } from "../application/syntx-maintenance-report.js";
import { loadMaplessSettingsInventoryVersion, type MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import { getPublicCatalogDirectory, loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import type { SyntxPublicCatalogSnapshot } from "../catalog/syntx-public-catalog.js";

export const SYNTX_LIST_UPDATE_VERSIONS_TOOL_NAME = "syntx_list_update_versions" as const;
export const SYNTX_PLAN_MCP_UPDATE_TOOL_NAME = "syntx_plan_mcp_update" as const;

const VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const MAX_ARCHIVE_VERSIONS = 10_000;
const MAX_PAGE_SIZE = 100;
const MAX_CONTROL_ROWS = 250_000;
const MAX_CHECKPOINT_OBSERVATIONS = 4_000;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const versionSchema = z.string().regex(VERSION_PATTERN);
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceIdentitySchema = z.object({
  public_version: versionSchema.describe("Exact public archive identity."),
  public_hash: sha256Schema.describe("SHA-256 binding for the public archive."),
  settings_version: versionSchema.nullable().describe("Exact paired settings archive identity, or null when settings are not checked."),
  settings_hash: sha256Schema.nullable().describe("SHA-256 binding for paired settings, or null when settings are not checked.")
}).strict().superRefine((identity, context) => {
  if ((identity.settings_version === null) !== (identity.settings_hash === null)) {
    context.addIssue({ code: "custom", message: "settings identity fields must be paired" });
  }
});
const obligationSchema = z.enum([
  "controls", "conditional_branches", "actions", "references", "settings",
  "helper_store_sender", "results", "mcp_consumers"
]);
const modelCheckpointSchema = z.object({
  schema_version: z.literal("1.0.0").describe("Closed model audit checkpoint schema version."),
  source_identity: sourceIdentitySchema.describe("Exact public/settings source identity."),
  observations: z.array(z.object({
    model_id: z.string().regex(/^[A-Za-z0-9._-]{1,160}$/u).describe("Exact safe model ID from the source census."),
    obligation: obligationSchema.describe("Public-source audit obligation; account access is not portable."),
    status: z.enum(["OBSERVED", "UNSUPPORTED"]).describe("Operator-declared observation status only.")
  }).strict()).max(MAX_CHECKPOINT_OBSERVATIONS).describe("At most 4,000 closed observations; no freeform notes or account fields.")
}).strict().superRefine((checkpoint, context) => {
  const seen = new Set<string>();
  checkpoint.observations.forEach((observation, index) => {
    const key = `${observation.model_id}\0${observation.obligation}`;
    if (seen.has(key)) context.addIssue({ code: "custom", path: ["observations", index], message: "duplicate observation" });
    seen.add(key);
  });
});
const controlCheckpointSchema = z.object({
  schema_version: z.literal("1.0.0").describe("Closed per-control checkpoint schema version."),
  source_identity: sourceIdentitySchema.describe("Exact public/settings source identity."),
  observations: z.array(z.object({
    control_id: z.string().regex(/^ctl_[a-f0-9]{32}$/u).describe("Opaque control row ID from the static source walk."),
    fingerprint: sha256Schema.describe("Source-derived fingerprint for resume validation."),
    status: z.enum(["OBSERVED", "UNSUPPORTED"]).describe("Operator-declared source observation, not rendered UI proof.")
  }).strict()).max(MAX_CHECKPOINT_OBSERVATIONS).describe("At most 4,000 closed observations; no freeform notes or account fields.")
}).strict().superRefine((checkpoint, context) => {
  const seen = new Set<string>();
  checkpoint.observations.forEach((observation, index) => {
    if (seen.has(observation.control_id)) context.addIssue({ code: "custom", path: ["observations", index], message: "duplicate observation" });
    seen.add(observation.control_id);
  });
});
const pageInputSchema = z.object({
  offset: z.number().int().min(0).max(MAX_CONTROL_ROWS).describe("Zero-based offset within the complete returned row set."),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).describe("Rows to return on this page, at most 100.")
}).strict();
const controlPageInputSchema = pageInputSchema.extend({
  model_ids: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u)).max(100).optional()
    .describe("Optional exact model IDs to select control rows; global totals remain unfiltered.")
}).strict().superRefine((page, context) => {
  if (page.model_ids !== undefined && new Set(page.model_ids).size !== page.model_ids.length) {
    context.addIssue({ code: "custom", path: ["model_ids"], message: "model IDs must be unique" });
  }
});

const planInputSchema = z.object({
  baseline_public_version: versionSchema.describe("Exact archived baseline public version; no path or URL."),
  candidate_public_version: versionSchema.describe("Exact archived candidate public version; no path or URL."),
  baseline_settings_version: versionSchema.optional().describe("Optional settings archive paired with the baseline public version."),
  candidate_settings_version: versionSchema.optional().describe("Optional settings archive paired with the candidate public version."),
  model_checkpoint: modelCheckpointSchema.optional().describe("Closed public-source model progress checkpoint; only OBSERVED/UNSUPPORTED statuses."),
  control_checkpoint: controlCheckpointSchema.optional().describe("Closed per-control progress checkpoint; only OBSERVED/UNSUPPORTED statuses."),
  model_page: pageInputSchema.describe("Page for the full candidate model census."),
  removed_page: pageInputSchema.describe("Page for removed model IDs from the source diff."),
  control_page: controlPageInputSchema.optional().describe("Optional source-derived control page; requires paired baseline/candidate settings archives.")
}).strict();

const auditStatusSchema = z.enum(["NOT_VISITED", "OBSERVED", "BLOCKED_BY_PLAN", "UNSUPPORTED"]);
const modalitySchema = z.enum(["image", "video", "audio", "other", "text", "unknown"]);
const countSchema = z.number().int().nonnegative();
const pageOutputShape = {
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
  total: countSchema,
  next_offset: z.number().int().nonnegative().nullable()
} as const;
const modelPageOutputSchema = z.object({
  ...pageOutputShape,
  items: z.array(z.object({
    model_id: z.string().regex(/^[A-Za-z0-9._-]{1,160}$/u),
    modality: modalitySchema,
    mandatory_gate: z.boolean(),
    affected: z.boolean(),
    checkpoint_stale: z.boolean(),
    obligations: z.array(z.object({ id: z.string(), status: auditStatusSchema }).strict())
  }).strict()).max(MAX_PAGE_SIZE)
}).strict();
const removedPageOutputSchema = z.object({
  ...pageOutputShape,
  items: z.array(z.object({
    model_id: z.string().regex(/^[A-Za-z0-9._-]{1,160}$/u),
    checkpoint_stale: z.boolean()
  }).strict()).max(MAX_PAGE_SIZE)
}).strict();
const collectionSummarySchema = z.object({
  baseline_count: countSchema,
  candidate_count: countSchema,
  added_count: countSchema,
  removed_count: countSchema,
  changed_count: countSchema,
  unchanged_count: countSchema
}).strict();
const planSummarySchema = z.object({
  baseline_public_version: versionSchema,
  candidate_public_version: versionSchema,
  baseline_settings_version: versionSchema.nullable(),
  candidate_settings_version: versionSchema.nullable(),
  public_source_hash_change_count: countSchema,
  public_source_hash_only_drift: z.boolean(),
  proof_revalidation_required: z.boolean(),
  affected_public_source_model_count: countSchema,
  ai: collectionSummarySchema,
  models: collectionSummarySchema,
  llm_models: collectionSummarySchema,
  settings: z.object({
    status: z.enum(["COMPARED", "NOT_CHECKED"]),
    impact_status: z.enum(["NOT_CHECKED", "NO_CHANGES", "FORM_BOUND_PARTIAL", "SHARED_HELPER_PARTIAL"]),
    affected_model_count: countSchema,
    added_form_count: countSchema,
    removed_form_count: countSchema,
    changed_form_count: countSchema,
    changed_helper_count: countSchema,
    source_hash_change_count: countSchema
  }).strict(),
  census_model_count: countSchema,
  affected_model_count: countSchema,
  modality_counts: z.object({ image: countSchema, video: countSchema, audio: countSchema, other: countSchema, text: countSchema, unknown: countSchema }).strict(),
  models_with_unknown_form_count: countSchema.nullable(),
  model_checkpoint_resume: z.object({
    status: z.enum(["NONE", "EXACT_SOURCE", "CARRIED_UNAFFECTED", "SOURCE_CHANGED_RESET"]),
    carried_observation_count: countSchema,
    stale_model_count: countSchema
  }).strict(),
  coverage: z.object({
    public_control_observations: z.literal("USER_DECLARED_ONLY"),
    conditional_visibility: z.literal("NOT_EVALUATED"),
    account_access: z.literal("NOT_CHECKED"),
    rendered_ui: z.literal("NOT_CHECKED"),
    provider_acceptance: z.literal("NOT_CHECKED")
  }).strict()
}).strict();
const controlPageOutputSchema = z.object({
  ...pageOutputShape,
  model_ids: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u)).max(100).nullable(),
  items: z.array(z.object({
    control_id: z.string().regex(/^ctl_[a-f0-9]{32}$/u),
    model_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u),
    form_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).nullable(),
    control_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    origins: z.array(z.enum(["FORM_MODEL_VALUE", "GENERIC_SETTING", "PAYLOAD_FIELD", "PUBLIC_SETTING", "ENUM_CONSTRAINT", "STATIC_DEFAULT"])),
    fingerprint: sha256Schema,
    change_status: z.enum(["NEW", "UNCHANGED", "CHANGED"]),
    status: z.enum(["NOT_VISITED", "OBSERVED", "UNSUPPORTED", "STALE"])
  }).strict()).max(MAX_PAGE_SIZE)
}).strict();
const controlWalkOutputSchema = z.object({
  total_controls: countSchema,
  diff: z.object({
    baseline_control_count: countSchema,
    candidate_control_count: countSchema,
    added_control_count: countSchema,
    removed_control_count: countSchema,
    changed_control_count: countSchema
  }).strict(),
  status_counts: z.object({ not_visited: countSchema, observed: countSchema, unsupported: countSchema, stale: countSchema }).strict(),
  models_with_gaps: countSchema,
  gap_counts: z.array(z.object({ code: z.string(), count: countSchema }).strict()),
  checkpoint_resume: z.object({
    status: z.enum(["NONE", "EXACT_SOURCE", "CARRIED_UNAFFECTED", "SOURCE_CHANGED_RESET"]),
    carried_observation_count: countSchema,
    stale_control_count: countSchema
  }).strict(),
  checkpoint_template: controlCheckpointSchema,
  coverage: z.object({
    conditional_visibility: z.literal("NOT_EVALUATED"),
    account_access: z.literal("NOT_CHECKED"),
    rendered_ui: z.literal("NOT_CHECKED"),
    provider_acceptance: z.literal("NOT_CHECKED")
  }).strict(),
  page: controlPageOutputSchema
}).strict();
const planOutputSchema = z.object({
  schema_version: z.literal("1.0.0"),
  operation: z.literal("MCP_MAINTENANCE_PLAN"),
  network_access: z.literal(false),
  archive_writes: z.literal(false),
  source_identity: sourceIdentitySchema,
  plan_summary: planSummarySchema,
  model_checkpoint_template: modelCheckpointSchema,
  model_page: modelPageOutputSchema,
  removed_model_page: removedPageOutputSchema,
  control_walk: controlWalkOutputSchema.nullable(),
  automatic_runtime_promotion: z.literal(false),
  paid_operations: z.literal(false)
}).strict();

type PlanInput = z.infer<typeof planInputSchema>;
type MaintenancePlanErrorCode =
  | "MCP_MAINTENANCE_INPUT_INVALID"
  | "MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE"
  | "MCP_MAINTENANCE_ARCHIVE_INVALID"
  | "MCP_MAINTENANCE_SETTINGS_PAIR_MISMATCH"
  | "MCP_MAINTENANCE_CHECKPOINT_INVALID"
  | "MCP_MAINTENANCE_CHECKPOINT_SOURCE_MISMATCH"
  | "MCP_MAINTENANCE_OUTPUT_LIMIT_EXCEEDED"
  | "MCP_MAINTENANCE_OPERATION_FAILED";
const PLAN_ERROR_MESSAGES: Readonly<Record<MaintenancePlanErrorCode, string>> = Object.freeze({
  MCP_MAINTENANCE_INPUT_INVALID: "Maintenance tool input is invalid.",
  MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE: "A packaged maintenance archive is unavailable.",
  MCP_MAINTENANCE_ARCHIVE_INVALID: "A packaged maintenance archive failed validation.",
  MCP_MAINTENANCE_SETTINGS_PAIR_MISMATCH: "The selected settings archive is not bound to its selected public archive.",
  MCP_MAINTENANCE_CHECKPOINT_INVALID: "A maintenance checkpoint is invalid or exceeds the allowed bound.",
  MCP_MAINTENANCE_CHECKPOINT_SOURCE_MISMATCH: "A maintenance checkpoint belongs to a different source version.",
  MCP_MAINTENANCE_OUTPUT_LIMIT_EXCEEDED: "The maintenance checkpoint template exceeds the allowed output bound.",
  MCP_MAINTENANCE_OPERATION_FAILED: "The maintenance operation could not be completed safely."
});

const listVersionsInputSchema = z.object({
  source_kind: z.enum(["public", "settings"]).describe("Which packaged archive family to list; settings entries report their exact public binding."),
  offset: z.number().int().min(0).max(MAX_ARCHIVE_VERSIONS).describe("Zero-based offset within all validated versions."),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).describe("Versions to return on this page, at most 100.")
}).strict();

const publicVersionItemSchema = z.object({
  kind: z.literal("public"),
  version: versionSchema,
  sha256: sha256Schema
}).strict();
const settingsVersionItemSchema = z.object({
  kind: z.literal("settings"),
  version: versionSchema,
  sha256: sha256Schema,
  paired_public_version: versionSchema,
  paired_public_archive_available: z.boolean()
}).strict();
const listVersionsOutputSchema = z.object({
  schema_version: z.literal("1.0.0"),
  source_kind: z.enum(["public", "settings"]),
  network_access: z.literal(false),
  archive_writes: z.literal(false),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  has_more: z.boolean(),
  items: z.array(z.union([publicVersionItemSchema, settingsVersionItemSchema])).max(MAX_PAGE_SIZE)
}).strict();

type ListVersionsInput = z.infer<typeof listVersionsInputSchema>;
type ListVersionsOutput = z.infer<typeof listVersionsOutputSchema>;
type MaintenanceArchiveErrorCode = "MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE" | "MCP_MAINTENANCE_ARCHIVE_INVALID";

const ERROR_MESSAGES: Readonly<Record<MaintenanceArchiveErrorCode, string>> = Object.freeze({
  MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE: "The packaged maintenance archive is unavailable.",
  MCP_MAINTENANCE_ARCHIVE_INVALID: "A packaged maintenance archive failed validation."
});

/** Fixed-package, offline maintenance tools; no caller path or URL is accepted. */
export function registerSyntxMaintenanceTools(server: Pick<McpServer, "registerTool">): void {
  server.registerTool(SYNTX_LIST_UPDATE_VERSIONS_TOOL_NAME, {
    title: "List SYNTX update archive versions",
    description: "List exact validated public or settings archive versions from the packaged catalog. Settings entries state the exact public version they bind to and whether that public archive is available. This is offline, read-only, and does not inspect account access or rendered UI.",
    inputSchema: listVersionsInputSchema,
    outputSchema: listVersionsOutputSchema,
    annotations: {
      title: "List SYNTX update archive versions",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = readVersionPage(input);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output as unknown as Record<string, unknown>
      };
    } catch (error) {
      const code = error instanceof MaintenanceArchiveReadError
        ? error.code
        : "MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE";
      return maintenanceError(code);
    }
  });

  server.registerTool(SYNTX_PLAN_MCP_UPDATE_TOOL_NAME, {
    title: "Plan a SYNTX MCP update",
    description: "Build an offline, source-bound audit plan from exact packaged public and optional paired settings archives. Returns explicit paged model/control census slices and complete global counts. Checkpoints carry only OBSERVED/UNSUPPORTED public-source progress; account access, tariff, rendered UI, and provider acceptance remain unchecked. This tool performs no fetch, write, archive, authentication, or paid operation.",
    inputSchema: planInputSchema,
    outputSchema: planOutputSchema,
    annotations: {
      title: "Plan a SYNTX MCP update",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async (input): Promise<CallToolResult> => {
    try {
      const output = buildPlanOutput(input);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output as unknown as Record<string, unknown>
      };
    } catch (error) {
      return maintenancePlanError(classifyPlanError(error));
    }
  });
}

function readVersionPage(input: ListVersionsInput): ListVersionsOutput {
  const catalogRoot = getPublicCatalogDirectory();
  const historyDirectory = input.source_kind === "public"
    ? join(catalogRoot, "public")
    : join(catalogRoot, "settings", "v2");
  let names: string[];
  try {
    const directoryStat = lstatSync(historyDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) failArchive("MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE");
    names = readdirSync(historyDirectory).filter((name) => VERSION_PATTERN.test(name)).sort();
  } catch (error) {
    if (error instanceof MaintenanceArchiveReadError) throw error;
    failArchive("MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE");
  }
  if (names.length > MAX_ARCHIVE_VERSIONS) failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID");
  const total = names.length;
  const pageNames = names.slice(input.offset, input.offset + input.limit);
  const publicVersions = input.source_kind === "settings" ? new Set(readVersionNames(join(catalogRoot, "public"))) : null;
  const items = pageNames.map((version) => {
    const match = VERSION_PATTERN.exec(version);
    if (!match || match[0] !== version) failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID");
    if (input.source_kind === "public") {
      try { loadPublicCatalogVersion(version); }
      catch { failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID"); }
      return { kind: "public" as const, version, sha256: `sha256:${match[0].slice(7, -5)}` };
    }

    let inventory;
    try { inventory = loadMaplessSettingsInventoryVersion(version); }
    catch { failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID"); }
    const pairedVersion = inventory.public_catalog.version;
    if (!VERSION_PATTERN.test(pairedVersion)) failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID");
    const pairedAvailable = publicVersions!.has(pairedVersion);
    if (pairedAvailable) {
      try { loadPublicCatalogVersion(pairedVersion); }
      catch { failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID"); }
    }
    return {
      kind: "settings" as const,
      version,
      sha256: `sha256:${match[0].slice(7, -5)}`,
      paired_public_version: pairedVersion,
      paired_public_archive_available: pairedAvailable
    };
  });
  const nextOffset = input.offset + pageNames.length;
  return listVersionsOutputSchema.parse({
    schema_version: "1.0.0",
    source_kind: input.source_kind,
    network_access: false,
    archive_writes: false,
    offset: input.offset,
    limit: input.limit,
    total,
    next_offset: nextOffset < total ? nextOffset : null,
    has_more: nextOffset < total,
    items
  });
}

function readVersionNames(directory: string): string[] {
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) failArchive("MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE");
    const names = readdirSync(directory).filter((name) => VERSION_PATTERN.test(name)).sort();
    if (names.length > MAX_ARCHIVE_VERSIONS) failArchive("MCP_MAINTENANCE_ARCHIVE_INVALID");
    return names;
  } catch (error) {
    if (error instanceof MaintenanceArchiveReadError) throw error;
    failArchive("MCP_MAINTENANCE_ARCHIVE_UNAVAILABLE");
  }
}

function buildPlanOutput(input: PlanInput) {
  if (!VERSION_PATTERN.test(input.baseline_public_version) || !VERSION_PATTERN.test(input.candidate_public_version)) {
    failPlan("MCP_MAINTENANCE_INPUT_INVALID");
  }
  const hasBaselineSettings = input.baseline_settings_version !== undefined;
  const hasCandidateSettings = input.candidate_settings_version !== undefined;
  const hasSettings = hasBaselineSettings && hasCandidateSettings;
  if (hasBaselineSettings !== hasCandidateSettings || (input.control_page !== undefined && !hasSettings) ||
      (input.control_checkpoint !== undefined && input.control_page === undefined)) failPlan("MCP_MAINTENANCE_INPUT_INVALID");
  validateCheckpointBounds(input);

  const baselinePublic = loadPublicArchive(input.baseline_public_version);
  const candidatePublic = loadPublicArchive(input.candidate_public_version);
  const baselineSettings = hasSettings ? loadSettingsArchive(input.baseline_settings_version!) : undefined;
  const candidateSettings = hasSettings ? loadSettingsArchive(input.candidate_settings_version!) : undefined;
  if (baselineSettings !== undefined && candidateSettings !== undefined &&
      (baselineSettings.public_catalog.version !== input.baseline_public_version ||
        candidateSettings.public_catalog.version !== input.candidate_public_version)) {
    failPlan("MCP_MAINTENANCE_SETTINGS_PAIR_MISMATCH");
  }
  let plan: SyntxMaintenanceAuditPlanV1;
  try {
    plan = buildSyntxMaintenanceAuditPlan({
      baseline_public: baselinePublic,
      candidate_public: candidatePublic,
      ...(baselineSettings === undefined ? {} : { baseline_settings: baselineSettings, candidate_settings: candidateSettings! }),
      ...(input.model_checkpoint === undefined ? {} : { checkpoint: input.model_checkpoint })
    });
  } catch (error) {
    throw error;
  }

  const controlWalk = input.control_page === undefined ? null : buildControlWalk(
    plan,
    baselineSettings!,
    candidateSettings!,
    input.control_page,
    input.control_checkpoint
  );
  const modelCheckpointTemplate = plan.checkpoint_template;
  const controlCheckpointTemplate = controlWalk?.checkpoint_template;
  const templateObservationCount = modelCheckpointTemplate.observations.length + (controlCheckpointTemplate?.observations.length ?? 0);
  const templateBytes = Buffer.byteLength(JSON.stringify({ modelCheckpointTemplate, controlCheckpointTemplate }), "utf8");
  if (templateObservationCount > MAX_CHECKPOINT_OBSERVATIONS || templateBytes > MAX_CHECKPOINT_BYTES) {
    failPlan("MCP_MAINTENANCE_OUTPUT_LIMIT_EXCEEDED");
  }

  const modalityCounts = { image: 0, video: 0, audio: 0, other: 0, text: 0, unknown: 0 };
  const staleModelIds = new Set(plan.checkpoint_resume.stale_model_ids);
  for (const model of plan.census.models) modalityCounts[model.modality] += 1;
  const modelRows = plan.census.models.map((model) => ({ ...model, checkpoint_stale: staleModelIds.has(model.model_id) }));
  const removedRows = plan.census.removed_model_ids.map((model_id) => ({ model_id, checkpoint_stale: staleModelIds.has(model_id) }));
  const modelPage = pageRows(modelRows, input.model_page.offset, input.model_page.limit);
  const removedModelPage = pageRows(removedRows, input.removed_page.offset, input.removed_page.limit);
  const report = plan.report;
  const output = {
    schema_version: "1.0.0" as const,
    operation: "MCP_MAINTENANCE_PLAN" as const,
    network_access: false as const,
    archive_writes: false as const,
    source_identity: plan.source_identity,
    plan_summary: {
      baseline_public_version: input.baseline_public_version,
      candidate_public_version: input.candidate_public_version,
      baseline_settings_version: input.baseline_settings_version ?? null,
      candidate_settings_version: input.candidate_settings_version ?? null,
      public_source_hash_change_count: report.public_source_hashes.changed.length,
      public_source_hash_only_drift: report.public_source_hashes.source_hash_only_drift,
      proof_revalidation_required: report.public_source_hashes.proof_revalidation_required,
      affected_public_source_model_count: report.public_source_hashes.affected_model_ids.length,
      ai: summarizeCollection(report.deltas.ai),
      models: summarizeCollection(report.deltas.models),
      llm_models: summarizeCollection(report.deltas.llm_models),
      settings: {
        status: report.settings.status,
        impact_status: report.settings.impact_status,
        affected_model_count: report.settings.affected_model_ids.length,
        added_form_count: report.settings.added_form_ids.length,
        removed_form_count: report.settings.removed_form_ids.length,
        changed_form_count: report.settings.changed_forms.length,
        changed_helper_count: report.settings.changed_helper_ids.length,
        source_hash_change_count: report.settings.source_hash_changes.length
      },
      census_model_count: plan.census.total_models,
      affected_model_count: plan.affected_queue.model_ids.length,
      modality_counts: modalityCounts,
      models_with_unknown_form_count: candidateSettings === undefined
        ? null
        : candidateSettings.models.filter((model) => model.form_binding_status !== "STRUCTURAL_MATCH" || model.form_id === null).length,
      model_checkpoint_resume: {
        status: plan.checkpoint_resume.status,
        carried_observation_count: plan.checkpoint_resume.carried_observation_count,
        stale_model_count: plan.checkpoint_resume.stale_model_ids.length
      },
      coverage: {
        public_control_observations: "USER_DECLARED_ONLY" as const,
        conditional_visibility: "NOT_EVALUATED" as const,
        account_access: "NOT_CHECKED" as const,
        rendered_ui: "NOT_CHECKED" as const,
        provider_acceptance: "NOT_CHECKED" as const
      }
    },
    model_checkpoint_template: modelCheckpointTemplate,
    model_page: modelPage,
    removed_model_page: removedModelPage,
    control_walk: controlWalk,
    automatic_runtime_promotion: false as const,
    paid_operations: false as const
  };
  return planOutputSchema.parse(output);
}

function buildControlWalk(
  plan: SyntxMaintenanceAuditPlanV1,
  baselineSettings: MaplessSettingsInventory,
  candidateSettings: MaplessSettingsInventory,
  pageInput: NonNullable<PlanInput["control_page"]>,
  checkpoint: z.infer<typeof controlCheckpointSchema> | undefined
) {
  let walk: SyntxMaintenanceControlWalkV1;
  try {
    walk = buildSyntxMaintenanceControlWalk({
      audit_plan: plan,
      baseline_settings: baselineSettings,
      candidate_settings: candidateSettings,
      ...(checkpoint === undefined ? {} : { checkpoint })
    });
  } catch (error) {
    throw error;
  }
  return summarizeControlWalk(walk, pageInput);
}

function summarizeControlWalk(
  walk: SyntxMaintenanceControlWalkV1,
  pageInput: NonNullable<PlanInput["control_page"]>
) {
  const selectedModelIds = pageInput.model_ids === undefined ? null : [...pageInput.model_ids].sort(compareText);
  const selected = selectedModelIds === null
    ? walk.controls
    : walk.controls.filter((control) => selectedModelIds.includes(control.model_id));
  const statusCounts = { not_visited: 0, observed: 0, unsupported: 0, stale: 0 };
  for (const control of walk.controls) {
    if (control.status === "NOT_VISITED") statusCounts.not_visited += 1;
    else if (control.status === "OBSERVED") statusCounts.observed += 1;
    else if (control.status === "UNSUPPORTED") statusCounts.unsupported += 1;
    else statusCounts.stale += 1;
  }
  const gaps = new Map<string, number>();
  let modelsWithGaps = 0;
  for (const model of walk.models) {
    if (model.gaps.length > 0) modelsWithGaps += 1;
    for (const gap of model.gaps) gaps.set(gap.code, (gaps.get(gap.code) ?? 0) + gap.count);
  }
  return {
    total_controls: walk.controls.length,
    diff: {
      baseline_control_count: walk.diff.baseline_control_count,
      candidate_control_count: walk.diff.candidate_control_count,
      added_control_count: walk.diff.added_control_ids.length,
      removed_control_count: walk.diff.removed_control_ids.length,
      changed_control_count: walk.diff.changed_control_ids.length
    },
    status_counts: statusCounts,
    models_with_gaps: modelsWithGaps,
    gap_counts: [...gaps.entries()].sort(([left], [right]) => compareText(left, right)).map(([code, count]) => ({ code, count })),
    checkpoint_resume: {
      status: walk.checkpoint_resume.status,
      carried_observation_count: walk.checkpoint_resume.carried_observation_count,
      stale_control_count: walk.checkpoint_resume.stale_control_ids.length
    },
    checkpoint_template: walk.checkpoint_template,
    coverage: {
      conditional_visibility: "NOT_EVALUATED" as const,
      account_access: "NOT_CHECKED" as const,
      rendered_ui: "NOT_CHECKED" as const,
      provider_acceptance: "NOT_CHECKED" as const
    },
    page: { ...pageRows(selected, pageInput.offset, pageInput.limit), model_ids: selectedModelIds }
  };
}

function summarizeCollection(collection: SyntxMaintenanceAuditPlanV1["report"]["deltas"]["models"]) {
  return {
    baseline_count: collection.baseline_count,
    candidate_count: collection.candidate_count,
    added_count: collection.added_ids.length,
    removed_count: collection.removed_ids.length,
    changed_count: collection.changed.length,
    unchanged_count: collection.unchanged_count
  };
}

function validateCheckpointBounds(input: PlanInput): void {
  const observations = (input.model_checkpoint?.observations.length ?? 0) + (input.control_checkpoint?.observations.length ?? 0);
  const bytes = Buffer.byteLength(JSON.stringify({
    ...(input.model_checkpoint === undefined ? {} : { model_checkpoint: input.model_checkpoint }),
    ...(input.control_checkpoint === undefined ? {} : { control_checkpoint: input.control_checkpoint })
  }), "utf8");
  if (observations > MAX_CHECKPOINT_OBSERVATIONS || bytes > MAX_CHECKPOINT_BYTES) {
    failPlan("MCP_MAINTENANCE_CHECKPOINT_INVALID");
  }
}

function pageRows<T>(rows: readonly T[], offset: number, limit: number, modelIds: readonly string[] | null = null) {
  const items = rows.slice(offset, offset + limit);
  const nextOffset = offset + items.length < rows.length ? offset + items.length : null;
  return { offset, limit, total: rows.length, next_offset: nextOffset, items, ...(modelIds === null ? {} : { model_ids: modelIds }) };
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function loadPublicArchive(version: string): SyntxPublicCatalogSnapshot {
  try { return loadPublicCatalogVersion(version); }
  catch { failPlan("MCP_MAINTENANCE_ARCHIVE_INVALID"); }
}

function loadSettingsArchive(version: string): MaplessSettingsInventory {
  try { return loadMaplessSettingsInventoryVersion(version); }
  catch { failPlan("MCP_MAINTENANCE_ARCHIVE_INVALID"); }
}

function classifyPlanError(error: unknown): MaintenancePlanErrorCode {
  if (error instanceof MaintenanceArchiveReadError) return error.code;
  if (error instanceof SyntxMaintenanceAuditPlanError) {
    if (error.code === "CHECKPOINT_SOURCE_MISMATCH") return "MCP_MAINTENANCE_CHECKPOINT_SOURCE_MISMATCH";
    if (error.code === "UNSAFE_CHECKPOINT") return "MCP_MAINTENANCE_CHECKPOINT_INVALID";
    if (error.code === "INVALID_INPUT") return "MCP_MAINTENANCE_INPUT_INVALID";
  }
  if (error instanceof SyntxMaintenanceControlWalkError) {
    if (error.code === "CHECKPOINT_SOURCE_MISMATCH") return "MCP_MAINTENANCE_CHECKPOINT_SOURCE_MISMATCH";
    if (error.code === "UNSAFE_CHECKPOINT" || error.code === "CONTROL_CHECKPOINT_LIMIT_EXCEEDED") return "MCP_MAINTENANCE_CHECKPOINT_INVALID";
    if (error.code === "INVALID_INPUT") return "MCP_MAINTENANCE_INPUT_INVALID";
  }
  if (error instanceof SyntxMaintenanceReportError) {
    if (error.code === "SETTINGS_PUBLIC_BINDING_MISMATCH") return "MCP_MAINTENANCE_SETTINGS_PAIR_MISMATCH";
    if (error.code === "SETTINGS_PAIR_REQUIRED") return "MCP_MAINTENANCE_INPUT_INVALID";
    if (error.code === "INVALID_PUBLIC_SNAPSHOT" || error.code === "INVALID_SETTINGS_SNAPSHOT") return "MCP_MAINTENANCE_ARCHIVE_INVALID";
  }
  if (error instanceof MaintenancePlanReadError) return error.code;
  return "MCP_MAINTENANCE_OPERATION_FAILED";
}

class MaintenanceArchiveReadError extends Error {
  constructor(readonly code: MaintenanceArchiveErrorCode) {
    super(code);
    this.name = "MaintenanceArchiveReadError";
  }
}

class MaintenancePlanReadError extends Error {
  constructor(readonly code: MaintenancePlanErrorCode) {
    super(code);
    this.name = "MaintenancePlanReadError";
  }
}

function failArchive(code: MaintenanceArchiveErrorCode): never {
  throw new MaintenanceArchiveReadError(code);
}

function failPlan(code: MaintenancePlanErrorCode): never {
  throw new MaintenancePlanReadError(code);
}

function maintenanceError(code: MaintenanceArchiveErrorCode): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message: ERROR_MESSAGES[code] } }) }]
  };
}

function maintenancePlanError(code: MaintenancePlanErrorCode): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message: PLAN_ERROR_MESSAGES[code] } }) }]
  };
}
