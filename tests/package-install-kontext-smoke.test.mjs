import assert from "node:assert/strict";
import test from "node:test";

const smokeModule = await import("../scripts/package-smoke/owner-kontext-stdio-smoke.mjs").catch(() => undefined);
const TOOL_NAMES = [
  "syntx_upload_kontext_reference_image",
  "syntx_owner_generate_kontext_image",
  "syntx_owner_reconcile_kontext_image",
  "syntx_owner_list_kontext_recoveries"
];
const VARIANTS = ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"];
const RESOLUTIONS = ["1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"];
const INPUT_MIME = ["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"];
const CANONICAL_MIME = ["image/jpeg", "image/png", "image/avif", "image/webp"];
const PARAMETER_NAMES = ["resolution", "cfg", "steps", "image_strength"];
const INPUT_METADATA_NAMES = ["mime_type", "width", "height", "size", "sha256", "metadata_confidence"];
const tool = (name, inputSchema, outputSchema, title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint, description) => ({
  name, inputSchema, outputSchema, description,
  annotations: { title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint }
});
const strictObject = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false
});
const stringEnum = (values) => ({ type: "string", enum: values });
const literal = (value) => ({ type: typeof value === "string" ? "string" : "boolean", const: value });
const imageMetadataSchema = strictObject({
  mime_type: stringEnum(CANONICAL_MIME),
  width: { type: "integer", exclusiveMinimum: 0, maximum: 0xffff_ffff },
  height: { type: "integer", exclusiveMinimum: 0, maximum: 0xffff_ffff },
  size: { type: "integer", minimum: 1, maximum: 10 * 1024 * 1024 },
  sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
  metadata_confidence: literal("CONTAINER_METADATA_ONLY")
}, INPUT_METADATA_NAMES);
const parametersSchema = strictObject({
  resolution: stringEnum(RESOLUTIONS),
  cfg: { type: "number", minimum: 1, maximum: 4 },
  steps: { type: "number", minimum: 10, maximum: 28 },
  image_strength: { type: "number", minimum: 0, maximum: 1 }
}, PARAMETER_NAMES);
const diagnosticSchema = strictObject({
  phase: stringEnum(["REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
    "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"]),
  post_started: { type: "boolean" }, echo_ack_known: { type: "boolean" },
  history_binding: stringEnum(["NONE", "PENDING", "READY", "INVALID"]),
  history_binding_reason: { type: ["string", "null"] },
  history_get_calls: { type: "integer", minimum: 0, maximum: 99 },
  history_get_calls_saturated: { type: "boolean" },
  inprogress_get_calls: { type: "integer", minimum: 0, maximum: 99 },
  inprogress_get_calls_saturated: { type: "boolean" },
  result_get_calls: { type: "integer", minimum: 0, maximum: 99 },
  result_get_calls_saturated: { type: "boolean" },
  result_status: stringEnum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]),
  result_reason: { type: ["string", "null"] }, model_eq_requested: { type: "boolean" }, model_eq_family: { type: "boolean" }
}, ["phase", "post_started", "echo_ack_known", "history_binding", "history_binding_reason", "history_get_calls",
  "history_get_calls_saturated", "inprogress_get_calls", "inprogress_get_calls_saturated", "result_get_calls",
  "result_get_calls_saturated", "result_status", "result_reason"]);

function validKontextTools() {
  const uploadInput = strictObject({
    link_attempt_id: { type: "string", pattern: "^link_[A-Za-z0-9_-]{20,120}$" },
    variant: stringEnum(VARIANTS),
    content_base64: { type: "string", minLength: 4, maxLength: Math.ceil((10 * 1024 * 1024) / 3) * 4,
      pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$" },
    filename: { type: "string", description: "Portable basename only; the 255-byte limit is a local portability rule." },
    mime_type: stringEnum(INPUT_MIME)
  });
  const uploadOutput = strictObject({
    status: literal("uploaded"), reference_handle: { type: "string", pattern: "^kontext_image_[0-9a-f-]{36}$" }, variant: stringEnum(VARIANTS),
    original_mime_type: stringEnum(INPUT_MIME), mime_type: stringEnum(CANONICAL_MIME),
    width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 },
    size: { type: "integer", minimum: 1, maximum: 10 * 1024 * 1024 },
    sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    expires_in_seconds: { type: "integer", minimum: 1, maximum: 900 },
    metadata_confidence: literal("CONTAINER_METADATA_ONLY")
  });
  const generateInput = strictObject({
    link_attempt_id: { type: "string" }, variant: stringEnum(VARIANTS),
    reference_handles: { type: "array", maxItems: 4, items: { type: "string", pattern: "^kontext_image_[0-9a-f-]{36}$" } },
    parameters: parametersSchema, workflow_policy: literal("LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA"),
    prompt: { type: "string", description: "Required, nonblank prompt; original whitespace is preserved. The UTF-8 limit is local, not a provider limit." }
  });
  const generationOutput = strictObject({
    status: literal("result_observed"), backend_acceptance: literal("unproven"), ai_name: literal("flux"),
    model_id: stringEnum(VARIANTS), variant: stringEnum(VARIANTS), operation_id: literal("generate-image"),
    profile_id: literal("flux-kontext-source-reviewed-v1"), profile_schema_hash: { type: "string" },
    catalog_version: { type: "string" }, request_fingerprint: { type: "string" }, parameters: parametersSchema,
    requested_resolution: stringEnum(RESOLUTIONS), workflow_policy: literal("LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA"),
    reference_count: { type: "integer", minimum: 0, maximum: 4 },
    input_images: { type: "array", maxItems: 4, items: imageMetadataSchema }, expected_output_geometry: { type: "null" },
    actual_image: strictObject({ mime_type: { type: "string", pattern: "^image\\/[a-z0-9.+-]{1,64}$" }, width: { type: "null" }, height: { type: "null" }}),
    geometry_verified: literal(false),
    artifact: strictObject({ url: { type: "string", format: "uri" }, mime_type: { type: "string" }, mime_source: literal("URL_EXTENSION") })
  });
  const reconcileInput = strictObject({ link_attempt_id: { type: "string" }, recovery_id: { type: "string" } });
  const listInput = strictObject({ link_attempt_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20, default: 20 } }, ["link_attempt_id"]);
  const recoveryItem = strictObject({
    recovery_id: { type: "string", pattern: "^kontext_recovery_[0-9a-f-]{36}$" },
    created_at: { type: "string", format: "date-time" }, model_id: stringEnum(VARIANTS),
    operation_id: literal("generate-image"), status: literal("OUTCOME_UNKNOWN"), diagnostic: diagnosticSchema
  });
  const recoveryOutput = strictObject({
    recoveries: { type: "array", maxItems: 20, items: recoveryItem }, confidence_scope: literal("process_local_get_only_recovery")
  });
  return [
    tool(TOOL_NAMES[0], uploadInput, uploadOutput, "Upload a Flux Kontext reference image", false, true, false, true,
      "Upload an owner image; local 10 MiB resource guard is not a provider limit."),
    tool(TOOL_NAMES[1], generateInput, generationOutput, "Generate an image with Flux Kontext", false, true, false, true,
      "Request contract: ordered opaque reference handles (0–1 for Pro/Max, 1–4 for Multi). Required nonblank prompt and explicit local policy."),
    tool(TOOL_NAMES[2], reconcileInput, generationOutput, "Reconcile a Flux Kontext image result", true, false, true, true,
      "GET-only reconciliation; process-local recovery."),
    tool(TOOL_NAMES[3], listInput, recoveryOutput, "List Flux Kontext recovery handles", true, false, true, false,
      "Read up to 20 process-local recovery records for the exact attempt. No provider request is performed.")
  ];
}

test("installed Kontext smoke validator enforces default-off subset without pinning total tools", () => {
  assert.equal(typeof smokeModule?.assertKontextOwnerToolSurface, "function");
  assert.deepEqual(smokeModule.assertKontextOwnerToolSurface([{ name: "syntx_get_model" }], false), { kontext_tool_count: 0 });
  assert.deepEqual(smokeModule.assertKontextOwnerToolSurface([...validKontextTools(), { name: "syntx_get_model" }], true),
    { kontext_tool_count: 4 });
});

test("installed stdio options target the extracted package child from consumer cwd using the current Node", () => {
  assert.equal(typeof smokeModule?.createInstalledKontextStdioOptions, "function");
  assert.deepEqual(smokeModule.createInstalledKontextStdioOptions("/tmp/consumer/node_modules/syntx-mcp", "/tmp/consumer",
    { SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES: "1" }), {
    command: process.execPath,
    args: ["/tmp/consumer/node_modules/syntx-mcp/dist/src/transports/stdio-owner.js"],
    cwd: "/tmp/consumer", env: { SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES: "1" }, stderr: "pipe"
  });
});

test("installed Kontext smoke rejects missing or duplicate tools and unexpected default activation", () => {
  const tools = validKontextTools();
  assert.throws(() => smokeModule.assertKontextOwnerToolSurface(tools.slice(1), true),
    (error) => error?.code === "INSTALLED_KONTEXT_TOOL_SET_MISMATCH");
  assert.throws(() => smokeModule.assertKontextOwnerToolSurface([...tools, tools[0]], true),
    (error) => error?.code === "INSTALLED_KONTEXT_TOOL_SET_MISMATCH");
  assert.throws(() => smokeModule.assertKontextOwnerToolSurface(tools, false),
    (error) => error?.code === "INSTALLED_KONTEXT_DEFAULT_OFF_FAILED");
});

test("installed Kontext smoke detects schema mutations across variants, controls, policy, MIME and resolutions", () => {
  const mutations = [
    ["widen variant enum", (tools) => { tools[1].inputSchema.properties.variant.enum.push("flux-kontext-ultra"); }],
    ["widen input MIME", (tools) => { tools[0].inputSchema.properties.mime_type.enum.push("image/gif"); }],
    ["widen canonical MIME", (tools) => { tools[0].outputSchema.properties.mime_type.enum.push("image/gif"); }],
    ["widen resolution", (tools) => { tools[1].inputSchema.properties.parameters.properties.resolution.enum.push("2048x2048"); }],
    ["widen CFG range", (tools) => { tools[1].inputSchema.properties.parameters.properties.cfg.maximum = 5; }],
    ["integerize fractional steps", (tools) => { tools[1].inputSchema.properties.parameters.properties.steps.type = "integer"; }],
    ["remove prompt requirement", (tools) => { tools[1].inputSchema.required = tools[1].inputSchema.required.filter((name) => name !== "prompt"); }],
    ["remove workflow policy", (tools) => { delete tools[1].inputSchema.properties.workflow_policy; }],
    ["widen upload resource cap", (tools) => { tools[0].inputSchema.properties.content_base64.maxLength += 1; }],
    ["freeze receipt expiry at 900", (tools) => { tools[0].outputSchema.properties.expires_in_seconds = { type: "integer", const: 900 }; }],
    ["open parameter object", (tools) => { tools[1].inputSchema.properties.parameters.additionalProperties = true; }]
  ];
  for (const [label, mutate] of mutations) {
    const tools = structuredClone(validKontextTools());
    mutate(tools);
    assert.throws(() => smokeModule.assertKontextOwnerToolSurface(tools, true),
      (error) => error?.code === "INSTALLED_KONTEXT_SCHEMA_INVALID", label);
  }
});

test("installed Kontext smoke validates strict outputs and semantic annotations", () => {
  const mutations = [
    ["remove write annotation", (tools) => { delete tools[0].annotations; }],
    ["mark generation read-only", (tools) => { tools[1].annotations.readOnlyHint = true; }],
    ["claim verified geometry", (tools) => { tools[1].outputSchema.properties.geometry_verified.const = true; }],
    ["expose metadata URL", (tools) => { tools[1].outputSchema.properties.input_images.items.properties.url = { type: "string" }; }],
    ["open nested output object", (tools) => { tools[1].outputSchema.properties.artifact.additionalProperties = true; }],
    ["remove local recovery scope", (tools) => { delete tools[3].outputSchema.properties.confidence_scope; }],
    ["remove GET-only description", (tools) => { tools[2].description = "Reconcile result."; }]
  ];
  for (const [label, mutate] of mutations) {
    const tools = structuredClone(validKontextTools());
    mutate(tools);
    assert.throws(() => smokeModule.assertKontextOwnerToolSurface(tools, true),
      (error) => error?.code === "INSTALLED_KONTEXT_SCHEMA_INVALID" || error?.code === "INSTALLED_KONTEXT_ANNOTATIONS_INVALID", label);
  }
});
