import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import {
  getOwnerVeoOmniGenerationParameterReport,
  OWNER_VEO_OMNI_MODEL_ID
} from "../application/owner-veo-omni-parameters.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const sourcePinsSchema = z.object({
  public_catalog_version: z.literal("sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json"),
  public_models_sha256: z.literal("sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1"),
  source_build_id: z.literal("1792156098"),
  modules: z.object({
    veo_form: z.string().regex(SHA256),
    constants: z.string().regex(SHA256),
    video_sender: z.string().regex(SHA256),
    quality_helper: z.string().regex(SHA256),
    app: z.string().regex(SHA256),
    settings_helper: z.string().regex(SHA256),
    video_route: z.string().regex(SHA256)
  }).strict()
}).strict();

const pair = <A extends number, B extends number>(a: A, b: B) => z.tuple([z.literal(a), z.literal(b)]);
const controlsSchema = z.object({
  type: z.tuple([z.literal("text"), z.literal("image"), z.literal("references")]),
  upscale: z.object({
    values: z.tuple([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    labels: z.object({
      0: z.literal("720p"), 1: z.literal("1080p"), 2: z.literal("4K"), 3: z.literal("360p Draft")
    }).strict()
  }).strict(),
  aspect_ratio: z.tuple([z.literal("16:9"), z.literal("9:16")]),
  video_duration: z.tuple([z.literal(4), z.literal(6), z.literal(8), z.literal(10)]),
  reference_counts: z.object({
    text: z.object({ images: pair(0, 0), videos: pair(0, 0) }).strict(),
    image: z.object({ images: pair(1, 2), videos: pair(0, 0) }).strict(),
    references: z.object({
      images_only: z.object({ images: pair(1, 7), videos: pair(0, 0) }).strict(),
      one_video_with_images: z.object({ images: pair(0, 5), videos: pair(1, 1) }).strict()
    }).strict()
  }).strict(),
  initializer_candidate: z.object({
    type: z.literal("text"), aspect_ratio: z.literal("16:9"), video_duration: z.literal(8), upscale: z.literal(0),
    semantics: z.literal("FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT")
  }).strict()
}).strict();

const settingsSelectionSchema = z.object({
  helper_effect: z.literal("GLOBAL_SETTINGS_STORE_NOT_PAYLOAD_RETURN"),
  dispatch_owner: z.literal("VIDEO_ROUTE_NOT_OMNI_FORM"),
  truthy_custom_payload: z.literal("REPLACE_SETTINGS_SHALLOW_SNAPSHOT"),
  otherwise: z.literal("SHALLOW_SETTINGS_SNAPSHOT"),
  custom_payload_reset: z.literal("NULL_ON_RESET_PAGE_SETTINGS"),
  references: z.literal("OWNED_BINDING_REQUIRED")
}).strict();

const costProjectionSchema = z.object({
  caller_keys: z.tuple([z.literal("upscale"), z.literal("video_duration")]),
  video_reference_extra: z.object({ mode: z.literal("video_ref") }).strict(),
  mode_in_generation_settings: z.literal("NOT_ESTABLISHED_BY_COST_QUERY"),
  amount_or_quote: z.literal("UNPROVEN")
}).strict();

export const OWNER_VEO_OMNI_PARAMETER_TOOL_NAME = "syntx_get_veo_omni_parameters" as const;

export const ownerVeoOmniParameterReportOutputSchema = z.object({
  status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"),
  model_id: z.literal(OWNER_VEO_OMNI_MODEL_ID),
  ai_name: z.literal("veo3"),
  source_pins: sourcePinsSchema,
  controls: controlsSchema,
  settings_selection: settingsSelectionSchema,
  cost_projection: costProjectionSchema,
  effective_defaults: z.literal("UNKNOWN"),
  duration_upscale_compatibility: z.literal("UNKNOWN_NOT_ENFORCED"),
  settings_serializer: z.literal("SOURCE_JOINED_COMMON_SETTINGS_BRANCH_REFERENCES_UNBOUND"),
  runtime_usable: z.literal(false),
  dispatch_allowed: z.literal(false),
  backend_acceptance: z.literal("UNPROVEN")
}).strict();

const inputSchema = z.object({}).strict();

/** Registers the static source-only Veo Omni parameter report; it grants no generation or account capability. */
export function registerSyntxOwnerVeoOmniParameterTools(server: McpServer): void {
  server.registerTool(OWNER_VEO_OMNI_PARAMETER_TOOL_NAME, {
    title: "Get Veo Omni parameters",
    description: "Returns a static, source-only Veo Omni parameter report. It is not a generation tool, performs no account read, does not establish effective defaults, and does not allow dispatch.",
    inputSchema,
    outputSchema: ownerVeoOmniParameterReportOutputSchema,
    annotations: { title: "Get Veo Omni parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (input) => {
    if (!inputSchema.safeParse(input).success) return parameterError("INVALID_REQUEST");
    const parsed = ownerVeoOmniParameterReportOutputSchema.safeParse(getOwnerVeoOmniGenerationParameterReport());
    if (!parsed.success) return parameterError("OUTPUT_INVALID");
    const text = JSON.stringify(parsed.data);
    return { content: [{ type: "text", text }], structuredContent: parsed.data as Record<string, unknown> };
  });
}

function parameterError(code: "INVALID_REQUEST" | "OUTPUT_INVALID") {
  const message = code === "INVALID_REQUEST" ? "The parameter request is invalid." : "The static parameter report is unavailable.";
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }] };
}
