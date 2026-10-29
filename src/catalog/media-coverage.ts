import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DiscoveryCatalogRepository, DiscoveryModelRecord } from "./discovery-catalog.js";
import type { RuntimeCapabilityCatalog, RuntimeCapabilityRecord } from "./runtime-capability-catalog.js";
import { z } from "zod/v4";

export const MEDIA_COVERAGE_VERSION = "2.0.0" as const;

export interface MediaCoverageRecord {
  readonly model_id: string;
  readonly ai_name: string;
  readonly display_name: string;
  readonly active: boolean;
  readonly modalities: DiscoveryModelRecord["modalities"];
  readonly operations: DiscoveryModelRecord["operations"];
  readonly operation_role: "SELECTOR" | "MODEL_OPERATION";
  readonly settings: DiscoveryModelRecord["settings"];
  readonly settings_status: "LIMITED_RUNTIME_TUPLE_ONLY" | "MIXED_LIMITED_AND_NATIVE" | "NATIVE_PARAMETER_ROUTE_PRESENT" | "NATIVE_GENERATION_ROUTE_SETTINGS_UNCLASSIFIED" | "PUBLIC_METADATA_ONLY" | "SOURCE_ONLY" | "UNKNOWN";
  readonly runtime_status: "CODE_MAPPED" | "SOURCE_ONLY" | "UNKNOWN";
  readonly result_status: "HISTORICAL_RESULT" | "NO_RESULT_EVIDENCE" | "UNKNOWN";
  readonly provider_case_status: "HISTORICAL_CASE" | "NOT_PROVEN" | "UNKNOWN";
  readonly historical_evidence: RuntimeCapabilityRecord["evidence"] | "NONE";
  readonly mcp_tool_names: readonly string[];
  readonly mcp_tool_groups: readonly string[];
  readonly operator_flags: readonly string[] | null;
  readonly notes: readonly string[];
}

export interface MediaCoveragePage {
  readonly schema_version: "1.0.0";
  readonly coverage_version: typeof MEDIA_COVERAGE_VERSION;
  readonly catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT";
  readonly runtime_usable: false;
  readonly source_hashes: DiscoveryCatalogRepository["source_hashes"];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly next_offset: number | null;
  readonly census: Readonly<Record<string, number>>;
  readonly interpretation_notes: readonly string[];
  readonly items: readonly MediaCoverageRecord[];
}

const PAGE_MAX = 100;
const nativeAliasBindingSchema = z.object({
  public_model_ids: z.array(z.string().min(1)).min(1),
  tool_names: z.array(z.string().min(1)).min(1),
  operator_flag: z.string().regex(/^SYNTX_OWNER_[A-Z0-9_]+$/u),
  route_evidence_sources: z.array(z.string().min(1)).min(1),
  operation_note: z.string().min(1)
}).strict();

const routeSnapshotSchema = z.object({
  schema_version: z.literal("2.0.0"),
  captured_date: z.iso.date(),
  public_catalog_version: z.string().min(1),
  public_source_hashes: z.object({ ai: z.string().min(1), llm_models: z.string().min(1), models: z.string().min(1) }).strict(),
  owner_tool_schema_profile_catalog_version: z.string().min(1),
  owner_tool_count: z.null(),
  owner_tool_count_status: z.literal("UNVERIFIED_FOR_ROUTE_EXTENSION"),
  route_method: z.literal("OWNER_STDIO_TOOLS_LIST_MODEL_ID_ENUMS_AND_CONSTS_PLUS_EXACT_NATIVE_ALIAS_BINDINGS"),
  routes: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
  native_alias_bindings: z.array(nativeAliasBindingSchema).min(1)
}).strict();

const GENERATOR_FLAGS: Readonly<Record<string, string>> = Object.freeze({
  syntx_owner_generate_acttwo_video: "SYNTX_OWNER_ACTTWO",
  syntx_owner_generate_clarity_upscale_image: "SYNTX_OWNER_CLARITY_UPSCALE",
  syntx_owner_generate_elevenlabs_dialogue: "SYNTX_OWNER_ELEVENLABS_DIALOGUE",
  syntx_owner_generate_elevenlabs_sts: "SYNTX_OWNER_ELEVENLABS_STS",
  syntx_owner_generate_elevenlabs_tts: "SYNTX_OWNER_ELEVENLABS_TTS",
  syntx_owner_generate_expanded_t2v: "SYNTX_OWNER_EXPANDED_T2V",
  syntx_owner_generate_flux3_video: "SYNTX_OWNER_FLUX3_VIDEOS",
  syntx_owner_generate_flux_image: "SYNTX_OWNER_FLUX_IMAGE_REFERENCES",
  syntx_owner_generate_grok_i2v_video: "SYNTX_OWNER_GROK_I2V",
  syntx_owner_generate_grok_reference: "SYNTX_OWNER_GROK_IMAGE_REFERENCES",
  syntx_owner_generate_grok_t2i_image: "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  syntx_owner_generate_grok_t2v: "SYNTX_OWNER_GROK_T2V",
  syntx_owner_generate_grok_v2v: "SYNTX_OWNER_GROK_V2V",
  syntx_owner_generate_hailuo01_director_t2v: "SYNTX_OWNER_HAILUO01_DIRECTOR_T2V",
  syntx_owner_generate_hailuo01_t2v: "SYNTX_OWNER_HAILUO01_T2V",
  syntx_owner_generate_hailuo02_i2v: "SYNTX_OWNER_HAILUO02_I2V",
  syntx_owner_generate_hailuo02_t2v: "SYNTX_OWNER_HAILUO02_T2V",
  syntx_owner_generate_hailuo23_t2v: "SYNTX_OWNER_HAILUO23_T2V",
  syntx_owner_generate_hailuo_initial_video: "SYNTX_OWNER_HAILUO_INITIAL",
  syntx_owner_generate_hailuo_live_t2v: "SYNTX_OWNER_HAILUO_LIVE_T2V",
  syntx_owner_generate_happy_horse_video: "SYNTX_OWNER_HAPPY_HORSE",
  syntx_owner_generate_heygen4_video: "SYNTX_OWNER_HEYGEN4",
  syntx_owner_generate_higgsfield_dop_video: "SYNTX_OWNER_HIGGSFIELD_DOP",
  syntx_owner_generate_ideogram_image: "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES",
  syntx_owner_generate_image: "SYNTX_OWNER_GENERATE_IMAGE",
  syntx_owner_generate_kling4_video: "SYNTX_OWNER_KLING4",
  syntx_owner_generate_kling_i2v_video: "SYNTX_OWNER_KLING_I2V",
  syntx_owner_generate_kling_keyframes: "SYNTX_OWNER_KLING_KEYFRAMES",
  syntx_owner_generate_kling_media_video: "SYNTX_OWNER_KLING_MEDIA",
  syntx_owner_generate_kling_motion_control_video: "SYNTX_OWNER_KLING_MOTION_CONTROL",
  syntx_owner_generate_kling_t2v: "SYNTX_OWNER_KLING_T2V",
  syntx_owner_generate_kontext_image: "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES",
  syntx_owner_generate_luma_t2v: "SYNTX_OWNER_LUMA_T2V",
  syntx_owner_generate_magnific_upscale_image: "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  syntx_owner_generate_runway_i2v_video: "SYNTX_OWNER_RUNWAY_I2V",
  syntx_owner_generate_runway_image: "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES",
  syntx_owner_generate_seedance20_t2v: "SYNTX_OWNER_SEEDANCE20_T2V",
  syntx_owner_generate_seedance25_t2v_video: "SYNTX_OWNER_SEEDANCE25_T2V",
  syntx_owner_generate_seedream_image: "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES",
  syntx_owner_generate_soul_image: "SYNTX_OWNER_SOUL_IMAGE_REFERENCES",
  syntx_owner_generate_standard_image: "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  syntx_owner_generate_suno_audio: "SYNTX_OWNER_SUNO_GENERATION",
  syntx_owner_generate_switchx_video: "SYNTX_OWNER_SWITCHX_VIDEO",
  syntx_owner_generate_topaz_astra: "SYNTX_OWNER_TOPAZ_ASTRA",
  syntx_owner_generate_topaz_enhance: "SYNTX_OWNER_TOPAZ_ENHANCE",
  syntx_owner_generate_uni_image: "SYNTX_OWNER_UNI_IMAGE_REFERENCES",
  syntx_owner_generate_veo_omni_references: "SYNTX_OWNER_VEO_OMNI_REFERENCES",
  syntx_owner_generate_veo_omni_t2v: "SYNTX_OWNER_VEO_OMNI_T2V",
  syntx_owner_generate_veo_t2v: "SYNTX_OWNER_VEO_T2V",
  syntx_owner_generate_video: "SYNTX_OWNER_GENERATE_VIDEO",
  syntx_owner_generate_video2audio: "SYNTX_OWNER_VIDEO2AUDIO",
  syntx_owner_generate_wan25_i2v_preview_video: "SYNTX_OWNER_WAN25_I2V_PREVIEW",
  syntx_owner_generate_wan25_t2v_video: "SYNTX_OWNER_WAN25_T2V_PREVIEW",
  syntx_owner_generate_wan26_i2v_video: "SYNTX_OWNER_WAN26_I2V",
  syntx_owner_generate_wan26_r2v_video: "SYNTX_OWNER_WAN26_R2V",
  syntx_owner_generate_wan27_i2v_video: "SYNTX_OWNER_WAN27_I2V",
  syntx_owner_generate_wan27_r2v: "SYNTX_OWNER_WAN27_R2V",
  syntx_owner_generate_wan27_videoedit_video: "SYNTX_OWNER_WAN27_VIDEOEDIT",
  syntx_owner_generate_wan30_edit_video: "SYNTX_OWNER_WAN30_EDIT_VIDEOS",
  syntx_owner_generate_wan30_first_last_video: "SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS",
  syntx_owner_generate_wan30_omni_video: "SYNTX_OWNER_WAN30_OMNI_VIDEOS",
  syntx_owner_generate_wan30_reference_video: "SYNTX_OWNER_WAN30_REFERENCE_VIDEOS",
  syntx_owner_generate_wan_image: "SYNTX_OWNER_WAN_IMAGE_REFERENCES",
  syntx_owner_generate_wan_t2i_image: "SYNTX_OWNER_WAN_T2I_IMAGE",
  syntx_owner_generate_wan_t2v_video: "SYNTX_OWNER_WAN_T2V_VIDEOS",
  syntx_owner_get_existing_video_recovery: "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY"
});

function loadReviewedOwnerRoutes(discovery: DiscoveryCatalogRepository) {
  const routePath = fileURLToPath(new URL("../../../catalog/media-coverage/owner-tool-routes-v2.json", import.meta.url));
  const raw: unknown = JSON.parse(readFileSync(routePath, "utf8"));
  const snapshot = routeSnapshotSchema.parse(raw);
  if (JSON.stringify(snapshot.public_source_hashes) !== JSON.stringify(discovery.source_hashes)) {
    throw new TypeError("MEDIA_COVERAGE_OWNER_ROUTE_SOURCE_MISMATCH");
  }
  const records = new Map<string, { tools: string[]; flags: string[] }>();
  const toolSets = new Map<string, Set<string>>();
  const flagSets = new Map<string, Set<string>>();
  for (const [modelId, toolNames] of Object.entries(snapshot.routes)) {
    discovery.getModel(modelId);
    toolSets.set(modelId, new Set(toolNames));
  }
  for (const binding of snapshot.native_alias_bindings) {
    for (const modelId of binding.public_model_ids) {
      discovery.getModel(modelId);
      const tools = toolSets.get(modelId) ?? new Set<string>();
      for (const name of binding.tool_names) tools.add(name);
      toolSets.set(modelId, tools);
      const flags = flagSets.get(modelId) ?? new Set<string>();
      flags.add(binding.operator_flag);
      flagSets.set(modelId, flags);
    }
  }
  for (const [modelId, toolSet] of toolSets) {
    const tools = [...toolSet].sort();
    if (tools.some((tool) => !(tool.startsWith("syntx_owner_") || tool.startsWith("syntx_get_") || tool.startsWith("syntx_upload_")) || tool === "syntx_get_model" || tool === "syntx_get_generation_schema")) {
      throw new TypeError("MEDIA_COVERAGE_OWNER_ROUTE_TOOL_INVALID");
    }
    const flags = [...new Set([...tools.flatMap((tool) => GENERATOR_FLAGS[tool] ? [GENERATOR_FLAGS[tool]!] : []), ...(flagSets.get(modelId) ?? [])])].sort();
    records.set(modelId, { tools, flags });
  }
  return records;
}

export class MediaCoverageCatalog {
  readonly #records: MediaCoverageRecord[];
  readonly #sourceHashes: DiscoveryCatalogRepository["source_hashes"];

  constructor(discovery: DiscoveryCatalogRepository, runtime?: RuntimeCapabilityCatalog | null) {
    this.#sourceHashes = discovery.source_hashes;
    const runtimeById = new Map((runtime?.list() ?? []).map((record) => [record.model_id, record]));
    const ownerRoutes = loadReviewedOwnerRoutes(discovery);
    // Discovery's search API is intentionally bounded; use cursor pagination to retain the full immutable census.
    const models: DiscoveryModelRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = discovery.search({ include_inactive: true, limit: PAGE_MAX, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) models.push(discovery.getModel(item.id));
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    this.#records = models.filter((model) => model.modalities.some((modality) => modality !== "text"))
      .map((model) => projectRecord(model, runtimeById.get(model.id), ownerRoutes.get(model.id)));
  }

  page(input: { offset?: number; limit?: number; include_inactive?: boolean } = {}): MediaCoveragePage {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10_000 || !Number.isSafeInteger(limit) || limit < 1 || limit > PAGE_MAX) {
      throw new TypeError("MEDIA_COVERAGE_PAGE_INVALID");
    }
    const records = input.include_inactive === true ? this.#records : this.#records.filter((item) => item.active);
    const items = records.slice(offset, offset + limit);
    return {
      schema_version: "1.0.0", coverage_version: MEDIA_COVERAGE_VERSION,
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", runtime_usable: false,
      source_hashes: this.#sourceHashes, total: records.length, offset, limit,
      next_offset: offset + items.length < records.length ? offset + items.length : null,
      census: census(records),
      interpretation_notes: ["Hailuo Minimax is a selector root, not a generator profile.", "Seedance Editor is an operation attached to seedance-2.5; it is not a separate public model ID."],
      items
    };
  }
}

function projectRecord(model: DiscoveryModelRecord, runtime: RuntimeCapabilityRecord | undefined, route: { tools: string[]; flags: string[] } | undefined): MediaCoverageRecord {
  const operationRole = model.id === "hailuo-minimax" ? "SELECTOR" : "MODEL_OPERATION";
  const hasDispatchRoute = route?.tools.some((tool) => /^syntx_owner_(?:generate|cover|extend)_/u.test(tool)) === true;
  const hasGenericTuple = route?.tools.some((tool) => tool === "syntx_owner_generate_image" || tool === "syntx_owner_generate_video") === true;
  const hasNativeParameterRoute = route?.tools.some((tool) => /^syntx_(?:owner_)?get_.*_parameters$/u.test(tool)) === true;
  const hasNativeGenerationRoute = route?.tools.some((tool) => tool.startsWith("syntx_owner_generate_") && tool !== "syntx_owner_generate_image" && tool !== "syntx_owner_generate_video") === true;
  const settingsStatus = hasGenericTuple
    ? hasNativeParameterRoute || hasNativeGenerationRoute ? "MIXED_LIMITED_AND_NATIVE" : "LIMITED_RUNTIME_TUPLE_ONLY"
    : hasNativeParameterRoute ? "NATIVE_PARAMETER_ROUTE_PRESENT"
      : hasNativeGenerationRoute ? "NATIVE_GENERATION_ROUTE_SETTINGS_UNCLASSIFIED"
        : route ? "PUBLIC_METADATA_ONLY" : model.operations.length > 0 ? "SOURCE_ONLY" : "UNKNOWN";
  return {
    model_id: model.id, ai_name: model.ai_name, display_name: model.display_name,
    active: model.active, modalities: [...model.modalities], operations: structuredClone(model.operations),
    operation_role: operationRole,
    settings: structuredClone(model.settings),
    settings_status: settingsStatus,
    runtime_status: hasDispatchRoute ? "CODE_MAPPED" : model.operations.length > 0 ? "SOURCE_ONLY" : "UNKNOWN",
    result_status: runtime?.result_status === "LIVE_OWNER" ? "HISTORICAL_RESULT" : hasDispatchRoute ? "NO_RESULT_EVIDENCE" : "UNKNOWN",
    provider_case_status: runtime?.result_status === "LIVE_OWNER" ? "HISTORICAL_CASE" : hasDispatchRoute ? "NOT_PROVEN" : "UNKNOWN",
    historical_evidence: runtime?.evidence ?? "NONE",
    mcp_tool_names: route?.tools ?? [],
    mcp_tool_groups: route?.flags ?? [],
    operator_flags: route ? route.flags.length > 0 ? route.flags : null : null,
    notes: ["Public catalog metadata does not grant account entitlement or dispatch permission.", ...(hasDispatchRoute ? ["A registered dispatch tool schema proves code routing only, not a provider result."] : route ? ["Registered parameter/source tools are listed, but no exact dispatch route was established."] : []), ...(settingsStatus === "LIMITED_RUNTIME_TUPLE_ONLY" ? ["The generic owner profile exposes only its reviewed legacy tuple; it does not prove full settings coverage."] : []), ...(settingsStatus === "MIXED_LIMITED_AND_NATIVE" ? ["The generic tuple is narrow; additional exact native tool routes are listed separately, and full settings coverage is not inferred."] : []), ...(operationRole === "SELECTOR" ? ["Hailuo Minimax is a selector root, not a generator profile."] : []), ...(!model.active ? ["This public catalog identity is inactive; mapped code does not enable generation."] : []), ...(route ? route.flags.length === 0 ? ["Exact registered tool names are mapped; the operator flag was not resolved from the runtime/config map."] : [] : [model.operations.length > 0 ? "Source operation is known; no exact registered model_id tool literal was found." : "No source operation or runtime mapping was established for this model ID."])]
  };
}

function census(records: readonly MediaCoverageRecord[]): Record<string, number> {
  const result: Record<string, number> = { image: 0, video: 0, audio: 0, text: 0, unknown: 0, active: 0, inactive: 0 };
  for (const record of records) {
    for (const modality of record.modalities) result[modality] = (result[modality] ?? 0) + 1;
    if (record.active) result.active = (result.active ?? 0) + 1;
    else result.inactive = (result.inactive ?? 0) + 1;
  }
  return result;
}
