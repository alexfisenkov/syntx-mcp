import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../dist/src/catalog/selected-discovery-catalog.js";
import {
  assertWanAdmissionPackagePaths,
  assertWanAdmissionSnapshot,
  assertWanImageToolSurface,
  assertWanNativePackagePaths,
  WanAdmissionSmokeError
} from "../scripts/package-install-wan-admission-smoke.mjs";
import { getOwnerWanImageSourceParameters, normalizeOwnerWanImageParameters } from "../dist/src/application/owner-wan-image-parameters.js";
import { OWNER_WAN_IMAGE_INPUT_POLICY } from "../dist/src/application/owner-wan-image-input-validator.js";
import { normalizeOwnerWanImagePrompt } from "../dist/src/application/owner-wan-image-prompt.js";
import { getOwnerWanImageSourceProfile } from "../dist/src/application/owner-wan-image-source-profile.js";
import { inspectBoundedOwnerWanBmp } from "../dist/src/application/owner-wan-bmp-inspector.js";

const VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const VARIANTS = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"];
const catalog = loadSelectedDiscoveryCatalog(VERSION).discoveryCatalog;

function sample(variant) {
  const ratio = variant === "wan_25_i2i_preview" ? "1:1" : variant === "wan_26_image" ? "1:1" : "1:1";
  const resolution = variant === "wan_25_i2i_preview" ? "720P" : variant === "wan_26_image" ? "720P" : "1K";
  const reference_count = variant === "wan_25_i2i_preview" ? 1 : variant === "wan_26_image" ? 1 : 0;
  return { variant, reference_count, parameters: {
    aspect_ratio: ratio, resolution, batch_size: 1, prompt_extend: false, seed: null,
    color_palette: null, bbox_list: Array.from({ length: reference_count }, () => [])
  } };
}

function bmp() {
  const bytes = Buffer.alloc(58);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(58, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(1, 18); bytes.writeInt32LE(1, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(0, 30); bytes.writeUInt32LE(4, 34);
  return bytes;
}

function snapshot() {
  return {
    descriptor: getOwnerWanImageSourceParameters(),
    profiles: VARIANTS.map((variant) => getOwnerWanImageSourceProfile(variant, catalog, VERSION)),
    normalized: VARIANTS.map((variant) => normalizeOwnerWanImageParameters(sample(variant))),
    inputPolicy: OWNER_WAN_IMAGE_INPUT_POLICY,
    promptSamples: VARIANTS.map((variant) => normalizeOwnerWanImagePrompt({ variant, prompt: "WAN package admission" })),
    promptMetric: normalizeOwnerWanImagePrompt({ variant: "wan_27_image", prompt: "😀\nX" }),
    bmpLimits: inspectBoundedOwnerWanBmp(bmp())
  };
}

function rejects(mutator, code) {
  const value = structuredClone(snapshot());
  mutator(value);
  assert.throws(() => assertWanAdmissionSnapshot(value),
    (error) => error instanceof WanAdmissionSmokeError && error.code === code);
}

test("packed WAN APIs and selected e551 archive satisfy the installed admission contract", () => {
  assert.equal(assertWanAdmissionSnapshot(snapshot()), true);
  assert.throws(() => normalizeOwnerWanImageParameters({ ...sample("wan_27_image_pro"), reference_count: 1,
    parameters: { ...sample("wan_27_image_pro").parameters, resolution: "4K", bbox_list: [[]] } }));
  const newlineEmoji = normalizeOwnerWanImagePrompt({ variant: "wan_27_image", prompt: "😀\nX" });
  assert.equal(newlineEmoji.length_units, 5);
});

test("installed checker requires the frozen guide and every compiled WAN admission module", () => {
  const required = [
    "docs/модели/WAN-image-источники-и-параметры.md",
    ...["owner-wan-image-parameters", "owner-wan-image-input-validator", "owner-wan-bmp-inspector", "owner-wan-image-prompt", "owner-wan-image-source-profile"]
      .flatMap((name) => [`dist/src/application/${name}.js`, `dist/src/application/${name}.d.ts`])
  ];
  assertWanAdmissionPackagePaths(new Set(required));
  assert.throws(() => assertWanAdmissionPackagePaths(new Set(required.filter((path) => !path.endsWith("owner-wan-image-prompt.js")))),
    (error) => error instanceof WanAdmissionSmokeError && error.code === "INSTALLED_WAN_PACKAGE_CONTENT_MISSING");
});

test("installed contract rejects a missing WAN variant", () => {
  rejects((value) => value.profiles.pop(), "INSTALLED_WAN_VARIANT_COVERAGE_MISMATCH");
});

test("installed contract rejects a missing explicit parameter field", () => {
  rejects((value) => { delete value.descriptor.controls.seed; }, "INSTALLED_WAN_PARAMETER_DESCRIPTOR_MISMATCH");
});

test("installed contract rejects a size cost alias", () => {
  rejects((value) => { value.normalized[0].cost_inputs = { size: "720P", batch_size: 1 }; }, "INSTALLED_WAN_PROFILE_OR_NORMALIZER_MISMATCH");
});

test("installed contract rejects an altered prompt budget", () => {
  rejects((value) => { value.profiles[0].prompt_policy.maximum_units = 5_000; }, "INSTALLED_WAN_PROFILE_OR_NORMALIZER_MISMATCH");
});

test("installed contract rejects proof scope that exceeds metadata-only evidence", () => {
  rejects((value) => { value.profiles[0].backend_acceptance = "ACCEPTED"; }, "INSTALLED_WAN_PROFILE_OR_NORMALIZER_MISMATCH");
});

const NATIVE_VARIANTS = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"];
const NATIVE_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9", "1:2", "2:1", "1:3", "3:1", "4:5", "5:4"];
const NATIVE_RESOLUTIONS = ["720P", "1080P", "1K", "2K", "4K"];
const NATIVE_PARAMS = ["aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list"];
const NATIVE_TOOLS = [
  "syntx_upload_wan_reference_image", "syntx_owner_generate_wan_image",
  "syntx_owner_reconcile_wan_image", "syntx_owner_list_wan_recoveries"
];

const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const string = (extra = {}) => ({ type: "string", ...extra });
const makeAnnotations = (title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint) =>
  ({ title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
const tool = (name, inputSchema, outputSchema, annotation, description = "") => ({ name, inputSchema, outputSchema, annotations: annotation, description });
function validWanTools() {
  const variant = string({ enum: NATIVE_VARIANTS });
  const mime = string({ enum: ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/webp"] });
  const canonicalMime = string({ enum: ["image/png", "image/jpeg", "image/bmp", "image/webp"] });
  const paletteItem = object({ hex: string({ pattern: "^#[0-9A-F]{6}$" }), ratio: string({ pattern: "^(?:100|[1-9]\\d?)\\.00%$" }) });
  const rect = { type: "array", items: Array.from({ length: 4 }, () => ({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER })), additionalItems: false, minItems: 4, maxItems: 4 };
  const params = object({
    aspect_ratio: string({ enum: NATIVE_RATIOS }), resolution: string({ enum: NATIVE_RESOLUTIONS }),
    batch_size: { type: "integer", minimum: 1, maximum: 4 }, prompt_extend: { type: "boolean" },
    seed: { anyOf: [{ type: "integer", minimum: 0, maximum: 2_147_483_647 }, { type: "null" }] },
    color_palette: { anyOf: [{ type: "array", minItems: 3, maxItems: 10, items: paletteItem }, { type: "null" }] },
    bbox_list: { type: "array", maxItems: 9, items: { type: "array", maxItems: 2, items: rect } }
  });
  const coordinate = object({
    orientation: { anyOf: [{ type: "integer", minimum: 1, maximum: 8 }, { type: "null" }] },
    projected_width: { anyOf: [{ type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 }, { type: "null" }] },
    projected_height: { anyOf: [{ type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 }, { type: "null" }] },
    confidence: string({ enum: ["HEADER_ORIENTATION_PROJECTION_NOT_BROWSER_DECODE", "UNSUPPORTED_OR_MALFORMED_METADATA"] })
  });
  const uploadOutput = object({
    status: { const: "uploaded" }, reference_handle: string({ pattern: "^wan_image_[0-9a-f-]{36}$" }), variant,
    original_mime_type: mime, mime_type: canonicalMime, width: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 },
    height: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 }, size: { type: "integer", exclusiveMinimum: 0, maximum: 20_971_520 },
    sha256: string({ pattern: "^sha256:[a-f0-9]{64}$" }), expires_in_seconds: { type: "integer", minimum: 1, maximum: 900 },
    metadata_confidence: { const: "CONTAINER_METADATA_ONLY" }, coordinate_projection: coordinate
  });
  const publicImage = object({ mime_type: canonicalMime, width: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 }, height: { type: "integer", exclusiveMinimum: 0, maximum: 4_294_967_295 },
    size: { type: "integer", exclusiveMinimum: 0, maximum: 20_971_520 }, sha256: string({ pattern: "^sha256:[a-f0-9]{64}$" }),
    metadata_confidence: { const: "CONTAINER_METADATA_ONLY" } });
  const artifact = object({ url: string({ format: "uri" }), mime_type: { anyOf: [string({ pattern: "^image\\/[a-z0-9.+-]{1,64}$" }), { type: "null" }] },
    mime_source: string({ enum: ["URL_EXTENSION", "UNKNOWN"] }), width: { type: "null" }, height: { type: "null" }, geometry_verified: { const: false } });
  const resultOutput = object({
    status: { const: "result_observed" }, backend_acceptance: { const: "unproven" }, ai_name: { const: "wan_image" }, model_id: variant, variant,
    operation_id: { const: "generate-image" }, profile_id: { const: "wan-image-source-reviewed-v1" }, profile_schema_hash: string({ pattern: "^sha256:[a-f0-9]{64}$" }),
    catalog_version: string({ minLength: 1, maxLength: 160 }), request_fingerprint: string({ pattern: "^sha256:[a-f0-9]{64}$" }), parameters: params,
    cost_inputs: object({ batch_size: { type: "integer", minimum: 1, maximum: 4 } }), cost_input_confidence: { const: "SOURCE_JOINED_BATCH_SIZE_ONLY" },
    requested_batch_size: { type: "integer", minimum: 1, maximum: 4 },
    bbox_coordinate_policy: { anyOf: [{ const: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" }, { type: "null" }] },
    reference_count: { type: "integer", minimum: 0, maximum: 9 }, input_images: { type: "array", maxItems: 9, items: publicImage },
    artifacts: { type: "array", minItems: 1, maxItems: 4, items: artifact }, expected_output_geometry: { type: "null" }, geometry_verified: { const: false }
  });
  const diagnostic = object({
    phase: string({ enum: ["REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"] }),
    post_started: { type: "boolean" }, echo_ack_known: { type: "boolean" }, history_binding: string({ enum: ["NONE", "PENDING", "READY", "INVALID"] }),
    history_binding_reason: { anyOf: [{ type: "string", enum: ["INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH", "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE", "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH", "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH", "BOT_BATCH_EXCEEDS_REQUEST", "BOT_BATCH_PENDING"] }, { type: "null" }] },
    history_get_calls: { type: "integer", minimum: 0, maximum: 255 }, history_get_calls_saturated: { type: "boolean" },
    inprogress_get_calls: { type: "integer", minimum: 0, maximum: 255 }, inprogress_get_calls_saturated: { type: "boolean" },
    result_get_calls: { type: "integer", minimum: 0, maximum: 255 }, result_get_calls_saturated: { type: "boolean" },
    result_status: string({ enum: ["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"] }),
    result_reason: { anyOf: [{ type: "string", enum: ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESULT_BATCH_PENDING", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH", "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID", "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE", "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_OBJECT_DUPLICATE"] }, { type: "null" }] }
  });
  const recoveries = object({ recovery_id: string({ pattern: "^wan_image_recovery_[0-9a-f-]{36}$" }), created_at: string({ format: "date-time" }), model_id: variant,
    operation_id: { const: "generate-image" }, status: { const: "OUTCOME_UNKNOWN" }, diagnostic });
  const attempt = string({ pattern: "^link_[A-Za-z0-9_-]{20,120}$" });
  const uploadInput = object({ link_attempt_id: attempt, variant, content_base64: string({ minLength: 4, maxLength: Math.ceil((20 * 1024 * 1024) / 3) * 4,
    pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" }),
    filename: string({ description: "Portable basename at most 255 UTF-8 bytes. Local paths and URLs are not accepted." }), mime_type: mime });
  const generateInput = object({ link_attempt_id: attempt, variant, reference_handles: { type: "array", maxItems: 9, items: string({ pattern: "^wan_image_[0-9a-f-]{36}$" }) },
    parameters: params, prompt: string({ description: "Required explicit prompt. Source-observed limit is UTF-16 code units plus LF count; preserve the original, do not clip." }),
    bbox_coordinate_policy: { anyOf: [{ const: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" }, { type: "null" }], description: "Required explicit policy. This does not prove browser-natural dimensions." } });
  const toolAnnotations = [
    makeAnnotations("Upload a WAN image reference", false, true, false, true), makeAnnotations("Generate images with WAN", false, true, false, true),
    makeAnnotations("Reconcile a WAN image outcome", true, false, true, true), makeAnnotations("List WAN image recoveries", true, false, true, false)
  ];
  return [
    tool(NATIVE_TOOLS[0], uploadInput, uploadOutput, toolAnnotations[0]),
    tool(NATIVE_TOOLS[1], generateInput, resultOutput, toolAnnotations[1], "Cost inputs contain batch_size only. An OUTCOME_UNKNOWN result may mean dispatch occurred; do not retry."),
    tool(NATIVE_TOOLS[2], object({ link_attempt_id: attempt, recovery_id: string({ pattern: "^wan_image_recovery_[0-9a-f-]{36}$" }) }), resultOutput, toolAnnotations[2], "GET-only process-local recovery."),
    tool(NATIVE_TOOLS[3], object({ link_attempt_id: attempt, limit: { type: "integer", minimum: 1, maximum: 20, default: 20 } }, ["link_attempt_id"]),
      object({ recoveries: { type: "array", maxItems: 20, items: recoveries }, confidence_scope: { const: "process_local_get_only_recovery" } }), toolAnnotations[3], "List bounded process-local recoveries." )
  ];
}

test("installed WAN native validator accepts default-off and the full opt-in tool contract", () => {
  assert.deepEqual(assertWanImageToolSurface([], false), { wan_tool_count: 0 });
  assert.deepEqual(assertWanImageToolSurface(validWanTools(), true), { wan_tool_count: 4 });
});

test("installed WAN native validator rejects schema, variant, field, policy, proof, and annotation drift", () => {
  const cases = [
    (tools) => { tools[1].inputSchema.properties.variant.enum.pop(); },
    (tools) => { delete tools[1].inputSchema.properties.parameters.properties.seed; tools[1].inputSchema.properties.parameters.required.pop(); },
    (tools) => { tools[0].inputSchema.properties.content_base64.maxLength -= 4; },
    (tools) => { tools[1].inputSchema.properties.bbox_coordinate_policy.anyOf.pop(); },
    (tools) => { tools[1].outputSchema.properties.backend_acceptance.const = "accepted"; },
    (tools) => { tools[1].outputSchema.properties.artifacts.maxItems = 3; },
    (tools) => { tools[0].outputSchema.properties.coordinate_projection.additionalProperties = true; },
    (tools) => { tools[3].outputSchema.properties.recoveries.items.properties.diagnostic.properties.phase.enum.pop(); },
    (tools) => { tools[0].annotations.title = "Unexpected title"; }
  ];
  for (const mutate of cases) {
    const tools = structuredClone(validWanTools());
    mutate(tools);
    assert.throws(() => assertWanImageToolSurface(tools, true),
      (error) => error instanceof WanAdmissionSmokeError && error.code.startsWith("INSTALLED_WAN_NATIVE_"));
  }
  assert.throws(() => assertWanImageToolSurface(validWanTools().slice(0, 3), true),
    (error) => error instanceof WanAdmissionSmokeError && error.code === "INSTALLED_WAN_NATIVE_TOOL_SET_MISMATCH");
  assert.throws(() => assertWanImageToolSurface(validWanTools(), false),
    (error) => error instanceof WanAdmissionSmokeError && error.code === "INSTALLED_WAN_NATIVE_DEFAULT_OFF_FAILED");
});

test("installed WAN native package requires its frozen guide, six application modules, and MCP tools", () => {
  const paths = ["docs/модели/WAN-image-источники-и-параметры.md", "dist/src/mcp/owner-wan-image-tools.js", "dist/src/mcp/owner-wan-image-tools.d.ts",
    ...["owner-wan-image-coordinate-metadata", "owner-wan-image-request-preparer", "owner-wan-image-upload-service",
      "owner-wan-image-one-shot-policy", "owner-wan-image-history-binding", "owner-wan-image-generation-service"]
      .flatMap((name) => [`dist/src/application/${name}.js`, `dist/src/application/${name}.d.ts`])];
  assert.equal(assertWanNativePackagePaths(new Set(paths)), true);
  assert.throws(() => assertWanNativePackagePaths(new Set(paths.filter((path) => !path.endsWith("owner-wan-image-history-binding.js")))),
    (error) => error instanceof WanAdmissionSmokeError && error.code === "INSTALLED_WAN_NATIVE_PACKAGE_CONTENT_MISSING");
});
