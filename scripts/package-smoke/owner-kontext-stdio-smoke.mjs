import { join } from "node:path";

export const OWNER_KONTEXT_TOOL_NAMES = Object.freeze([
  "syntx_upload_kontext_reference_image",
  "syntx_owner_generate_kontext_image",
  "syntx_owner_reconcile_kontext_image",
  "syntx_owner_list_kontext_recoveries"
]);

const VARIANTS = Object.freeze(["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"]);
const RESOLUTIONS = Object.freeze(["1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"]);
const INPUT_MIME_TYPES = Object.freeze(["image/jpeg", "image/jpg", "image/png", "image/avif", "image/webp"]);
const CANONICAL_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"]);
const PARAMETER_NAMES = Object.freeze(["resolution", "cfg", "steps", "image_strength"]);
const INPUT_IMAGE_METADATA_NAMES = Object.freeze(["mime_type", "width", "height", "size", "sha256", "metadata_confidence"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const BASE64_PATTERN = "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$";

const EXPECTED_ANNOTATIONS = Object.freeze([
  { title: "Upload a Flux Kontext reference image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  { title: "Generate an image with Flux Kontext", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  { title: "Reconcile a Flux Kontext image result", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  { title: "List Flux Kontext recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
]);

export class OwnerKontextPackageSmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = "OwnerKontextPackageSmokeError";
    this.code = code;
  }
}

export function createInstalledKontextStdioOptions(installedPackagePath, consumerPath, env) {
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze([join(installedPackagePath, "dist/src/transports/stdio-owner.js")]),
    cwd: consumerPath,
    env: Object.freeze({ ...env }),
    stderr: "pipe"
  });
}

/** Validates only the installed Kontext subset; other MCP tools may be present. */
export function assertKontextOwnerToolSurface(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") fail("INSTALLED_KONTEXT_TOOLS_LIST_INVALID");
  const names = tools.filter((tool) => OWNER_KONTEXT_TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) fail("INSTALLED_KONTEXT_DEFAULT_OFF_FAILED");
    return Object.freeze({ kontext_tool_count: 0 });
  }
  if (names.length !== OWNER_KONTEXT_TOOL_NAMES.length ||
      OWNER_KONTEXT_TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    fail("INSTALLED_KONTEXT_TOOL_SET_MISMATCH");
  }
  const byName = new Map(tools.filter((tool) => OWNER_KONTEXT_TOOL_NAMES.includes(tool?.name)).map((tool) => [tool.name, tool]));
  const [upload, generate, reconcile, list] = OWNER_KONTEXT_TOOL_NAMES.map((name) => byName.get(name));
  assertStrictObject(upload.inputSchema,
    ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], []);
  assertStrictObject(generate.inputSchema,
    ["link_attempt_id", "variant", "reference_handles", "parameters", "workflow_policy", "prompt"], []);
  assertStrictObject(generate.inputSchema.properties.parameters, PARAMETER_NAMES, []);
  assertStrictObject(reconcile.inputSchema, ["link_attempt_id", "recovery_id"], []);
  assertStrictObject(list.inputSchema, ["link_attempt_id"], ["limit"]);
  for (const tool of [upload, generate, reconcile, list]) {
    assertAllObjectsStrict(tool.inputSchema);
    assertStrictOutput(tool.outputSchema);
    assertAllObjectsStrict(tool.outputSchema);
  }

  const uploadProperties = upload.inputSchema.properties;
  const generateProperties = generate.inputSchema.properties;
  const parameters = generateProperties.parameters.properties;
  const uploadOutput = upload.outputSchema.properties;
  const generateOutput = generate.outputSchema.properties;
  const listOutput = list.outputSchema.properties;
  const recoveryArray = listOutput.recoveries;
  const recoveryItem = recoveryArray?.items;
  const diagnostic = recoveryItem?.properties?.diagnostic;
  assertStrictObject(upload.outputSchema, ["status", "reference_handle", "variant", "original_mime_type", "mime_type",
    "width", "height", "size", "sha256", "expires_in_seconds", "metadata_confidence"], []);
  assertStrictObject(generate.outputSchema, ["status", "backend_acceptance", "ai_name", "model_id", "variant", "operation_id",
    "profile_id", "profile_schema_hash", "catalog_version", "request_fingerprint", "parameters", "requested_resolution",
    "workflow_policy", "reference_count", "input_images", "expected_output_geometry", "actual_image", "geometry_verified", "artifact"], []);
  assertStrictObject(list.outputSchema, ["recoveries", "confidence_scope"], []);
  assertStrictObject(recoveryItem, ["recovery_id", "created_at", "model_id", "operation_id", "status", "diagnostic"], []);
  if (!sameStringArray(uploadProperties.variant?.enum, VARIANTS) ||
      !sameStringArray(generateProperties.variant?.enum, VARIANTS) ||
      !sameStringArray(uploadProperties.mime_type?.enum, INPUT_MIME_TYPES) ||
      !sameStringArray(uploadOutput.mime_type?.enum, CANONICAL_MIME_TYPES) ||
      !sameStringArray(uploadOutput.original_mime_type?.enum, INPUT_MIME_TYPES) ||
      !sameStringArray(uploadOutput.variant?.enum, VARIANTS) ||
      uploadOutput.reference_handle?.pattern !== "^kontext_image_[0-9a-f-]{36}$" ||
      uploadProperties.content_base64?.minLength !== 4 ||
      uploadProperties.content_base64?.maxLength !== MAX_BASE64_CHARS ||
      uploadProperties.content_base64?.pattern !== BASE64_PATTERN ||
      !hasLiteral(generateProperties.workflow_policy, "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA") ||
      generateProperties.prompt?.type !== "string" ||
      !String(generateProperties.prompt.description ?? "").includes("Required, nonblank prompt") ||
      !String(generateProperties.prompt.description ?? "").includes("local, not a provider limit") ||
      !String(generate.description ?? "").includes("ordered opaque reference handles") ||
      !String(generate.description ?? "").includes("0–1 for Pro/Max, 1–4 for Multi") ||
      !String(uploadProperties.filename?.description ?? "").includes("255-byte")) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");

  if (!sameStringArray(parameters.resolution?.enum, RESOLUTIONS) ||
      !isNumberRange(parameters.cfg, 1, 4) || !isNumberRange(parameters.steps, 10, 28) ||
      !isNumberRange(parameters.image_strength, 0, 1)) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  assertStrictObject(generateOutput.parameters, PARAMETER_NAMES, []);
  const outputParameters = generateOutput.parameters.properties;
  if (!sameStringArray(generateOutput.model_id?.enum, VARIANTS) || !sameStringArray(generateOutput.variant?.enum, VARIANTS) ||
      !sameStringArray(generateOutput.requested_resolution?.enum, RESOLUTIONS) ||
      !hasLiteral(generateOutput.workflow_policy, "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA") ||
      !sameStringArray(outputParameters.resolution?.enum, RESOLUTIONS) ||
      !isNumberRange(outputParameters.cfg, 1, 4) || !isNumberRange(outputParameters.steps, 10, 28) ||
      !isNumberRange(outputParameters.image_strength, 0, 1)) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");

  const inputReferenceArray = generateProperties.reference_handles;
  if (inputReferenceArray?.type !== "array" || inputReferenceArray.maxItems !== 4 ||
      inputReferenceArray.items?.type !== "string" ||
      inputReferenceArray.items.pattern !== "^kontext_image_[0-9a-f-]{36}$") fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  assertNoForbiddenInputFields(upload.inputSchema, ["url", "file_url", "file_urls", "path", "chat_uuid", "chat_id", "model_id", "model_type", "n"]);
  assertNoForbiddenInputFields(generate.inputSchema, ["url", "file_url", "file_urls", "path", "chat_uuid", "chat_id", "model_id", "model_type", "n"]);

  const expiry = uploadOutput.expires_in_seconds;
  if (expiry?.type !== "integer" || expiry.minimum !== 1 || expiry.maximum !== 900 ||
      Object.hasOwn(expiry, "const") || Object.hasOwn(expiry, "enum")) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  const images = generateOutput.input_images;
  if (images?.type !== "array" || images.maxItems !== 4 || !isRecord(images.items) ||
      !sameStringArray(Object.keys(images.items.properties ?? {}).sort(), [...INPUT_IMAGE_METADATA_NAMES].sort()) ||
      !sameStringArray(stringList(images.items.required).slice().sort(), [...INPUT_IMAGE_METADATA_NAMES].sort()) ||
      !sameStringArray(images.items.properties.mime_type?.enum, CANONICAL_MIME_TYPES) ||
      !hasLiteral(images.items.properties.metadata_confidence, "CONTAINER_METADATA_ONLY") ||
      !isPositiveDimension(images.items.properties.width) || !isPositiveDimension(images.items.properties.height) ||
      (images.items.properties.size?.maximum !== MAX_IMAGE_BYTES) ||
      (images.items.properties.sha256?.pattern !== "^sha256:[a-f0-9]{64}$")) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  if (["url", "file_url", "file_urls", "filename", "reference_handle", "provider_file_id", "principal"]
    .some((name) => Object.hasOwn(images.items.properties, name))) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  if (generateOutput.reference_count?.type !== "integer" || generateOutput.reference_count.minimum !== 0 ||
      generateOutput.reference_count.maximum !== 4 || generateOutput.expected_output_geometry?.type !== "null" ||
      generateOutput.actual_image?.properties?.mime_type?.pattern !== "^image\\/[a-z0-9.+-]{1,64}$" ||
      generateOutput.actual_image?.properties?.width?.type !== "null" ||
      generateOutput.actual_image?.properties?.height?.type !== "null" ||
      generateOutput.geometry_verified?.const !== false ||
      !hasLiteral(generateOutput.artifact?.properties?.mime_source, "URL_EXTENSION") ||
      generateOutput.artifact?.properties?.url?.format !== "uri") fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  if (!String(reconcile.description ?? "").includes("GET-only") ||
      !String(reconcile.description ?? "").includes("process-local") ||
      !String(list.description ?? "").includes("process-local") ||
      !String(list.description ?? "").includes("No provider request") ||
      list.inputSchema.properties.limit?.minimum !== 1 || list.inputSchema.properties.limit?.maximum !== 20 ||
      list.inputSchema.properties.limit?.default !== 20 ||
      recoveryArray?.type !== "array" || recoveryArray.maxItems !== 20 ||
      recoveryItem.properties.recovery_id?.pattern !== "^kontext_recovery_[0-9a-f-]{36}$" ||
      !sameStringArray(recoveryItem.properties.model_id?.enum, VARIANTS) ||
      !hasLiteral(recoveryItem.properties.status, "OUTCOME_UNKNOWN") ||
      !isRecord(diagnostic) || diagnostic.additionalProperties !== false ||
      !Array.isArray(diagnostic.properties.phase?.enum) || diagnostic.properties.phase.enum.length === 0 ||
      !sameStringArray(diagnostic.properties.history_binding?.enum, ["NONE", "PENDING", "READY", "INVALID"]) ||
      listOutput.confidence_scope?.const !== "process_local_get_only_recovery") fail("INSTALLED_KONTEXT_SCHEMA_INVALID");

  for (let index = 0; index < OWNER_KONTEXT_TOOL_NAMES.length; index += 1) {
    if (!sameRecord(byName.get(OWNER_KONTEXT_TOOL_NAMES[index]).annotations, EXPECTED_ANNOTATIONS[index])) {
      fail("INSTALLED_KONTEXT_ANNOTATIONS_INVALID");
    }
  }
  return Object.freeze({ kontext_tool_count: names.length });
}

export async function assertInstalledKontextOwnerStdioSurface(installedPackagePath, consumerPath) {
  const defaultClient = await connectInstalledOwnerStdio(installedPackagePath, consumerPath, {}, "default");
  let defaultResult;
  try {
    const listed = await withinDeadline(defaultClient.client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_KONTEXT_TOOLS_LIST_TIMEOUT");
    defaultResult = assertKontextOwnerToolSurface(listed.tools, false);
  } finally { await defaultClient.closeAndVerify(); }

  const optedInClient = await connectInstalledOwnerStdio(installedPackagePath, consumerPath,
    { SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES: "1" }, "opt-in");
  let optedInResult;
  try {
    const listed = await withinDeadline(optedInClient.client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }),
      5_500, "INSTALLED_KONTEXT_TOOLS_LIST_TIMEOUT");
    optedInResult = assertKontextOwnerToolSurface(listed.tools, true);
  } finally { await optedInClient.closeAndVerify(); }
  return Object.freeze({ default_tools: defaultResult.kontext_tool_count, opt_in_tools: optedInResult.kontext_tool_count,
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), provider_calls: 0, auth_calls: 0 });
}

async function connectInstalledOwnerStdio(installedPackagePath, consumerPath, env, label) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const client = new Client({ name: `syntx-installed-kontext-${label}`, version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport(createInstalledKontextStdioOptions(installedPackagePath, consumerPath, env));
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => { try { previousOnClose?.(); } finally { resolveClosed(true); } };
  try {
    await withinDeadline(client.connect(transport), 5_500, "INSTALLED_KONTEXT_STDIO_INITIALIZE_TIMEOUT");
  } catch {
    await withinDeadline(transport.close().catch(() => undefined), 2_000, "INSTALLED_KONTEXT_STDIO_CLOSE_FAILED").catch(() => undefined);
    fail("INSTALLED_KONTEXT_STDIO_START_FAILED");
  }
  const initialPid = transport.pid;
  if (!Number.isSafeInteger(initialPid) || initialPid <= 0) {
    await client.close().catch(() => undefined);
    fail("INSTALLED_KONTEXT_STDIO_PID_INVALID");
  }
  return Object.freeze({ client, async closeAndVerify() {
    let closeError;
    try { await withinDeadline(client.close(), 2_000, "INSTALLED_KONTEXT_STDIO_CLOSE_FAILED"); } catch { closeError = true; }
    let closedInTime = false;
    try { closedInTime = await withinDeadline(closed, 2_000, "INSTALLED_KONTEXT_STDIO_CLOSE_FAILED"); } catch { closedInTime = false; }
    if (closeError || closedInTime !== true || transport.pid !== null) fail("INSTALLED_KONTEXT_STDIO_CLOSE_FAILED");
  } });
}

function withinDeadline(promise, milliseconds, code) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OwnerKontextPackageSmokeError(code)), milliseconds);
  })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

function assertStrictObject(schema, requiredProperties, optionalProperties) {
  const properties = schemaProperties(schema);
  const expectedNames = [...requiredProperties, ...optionalProperties].sort();
  const required = stringList(schema.required);
  if (schema.type !== "object" || schema.additionalProperties !== false ||
      !sameStringArray(Object.keys(properties).sort(), expectedNames) ||
      !sameStringArray([...required].sort(), [...requiredProperties].sort())) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
}

function assertStrictOutput(schema) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
}

function assertAllObjectsStrict(value) {
  if (Array.isArray(value)) { for (const item of value) assertAllObjectsStrict(item); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  for (const child of Object.values(value)) assertAllObjectsStrict(child);
}

function assertNoForbiddenInputFields(schema, forbiddenNames) {
  if (Array.isArray(schema)) { for (const item of schema) assertNoForbiddenInputFields(item, forbiddenNames); return; }
  if (!isRecord(schema)) return;
  if (isRecord(schema.properties) && Object.keys(schema.properties).some((name) => forbiddenNames.includes(name))) {
    fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  }
  for (const value of Object.values(schema)) assertNoForbiddenInputFields(value, forbiddenNames);
}

function schemaProperties(schema) {
  if (!isRecord(schema) || !isRecord(schema.properties)) fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  return schema.properties;
}

function stringList(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    fail("INSTALLED_KONTEXT_SCHEMA_INVALID");
  }
  return value;
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasLiteral(schema, expected) {
  return isRecord(schema) && (schema.const === expected || sameStringArray(schema.enum, [expected]));
}

function isNumberRange(schema, minimum, maximum) {
  return isRecord(schema) && schema.type === "number" && schema.minimum === minimum && schema.maximum === maximum &&
    !Object.hasOwn(schema, "multipleOf");
}

function isPositiveDimension(schema) {
  return isRecord(schema) && schema.type === "integer" && schema.exclusiveMinimum === 0 && schema.maximum === 0xffff_ffff;
}

function sameRecord(actual, expected) {
  return isRecord(actual) && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.keys(expected).every((key) => actual[key] === expected[key]);
}

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function fail(code) { throw new OwnerKontextPackageSmokeError(code); }
