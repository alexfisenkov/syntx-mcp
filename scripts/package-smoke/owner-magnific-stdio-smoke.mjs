import { join } from "node:path";

export const OWNER_MAGNIFIC_TOOL_NAMES = Object.freeze([
  "syntx_upload_magnific_upscale_image",
  "syntx_owner_generate_magnific_upscale_image",
  "syntx_owner_reconcile_magnific_upscale_image",
  "syntx_owner_list_magnific_upscale_recoveries"
]);

export class OwnerMagnificPackageSmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = "OwnerMagnificPackageSmokeError";
    this.code = code;
  }
}

export function createInstalledMagnificStdioOptions(installedPackagePath, consumerPath, env) {
  return Object.freeze({
    command: process.execPath,
    args: Object.freeze([join(installedPackagePath, "dist/src/transports/stdio-owner.js")]),
    cwd: consumerPath,
    env: Object.freeze({ ...env }),
    stderr: "pipe"
  });
}

/** Checks only Magnific's opt-in subset within the installed stdio tools/list response. */
export function assertMagnificOwnerToolSurface(tools, enabled) {
  if (!Array.isArray(tools) || typeof enabled !== "boolean") {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_TOOLS_LIST_INVALID");
  }
  const names = tools.filter((tool) => OWNER_MAGNIFIC_TOOL_NAMES.includes(tool?.name)).map((tool) => tool.name);
  if (!enabled) {
    if (names.length !== 0) throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_DEFAULT_OFF_FAILED");
    return Object.freeze({ magnific_tool_count: 0 });
  }
  if (names.length !== OWNER_MAGNIFIC_TOOL_NAMES.length ||
      OWNER_MAGNIFIC_TOOL_NAMES.some((name) => names.filter((item) => item === name).length !== 1)) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_TOOL_SET_MISMATCH");
  }
  const byName = new Map(tools.filter((item) => OWNER_MAGNIFIC_TOOL_NAMES.includes(item?.name)).map((item) => [item.name, item]));
  const variants = ["creative", "precision_v1", "precision_v2"];
  const mimeTypes = ["image/jpeg", "image/png", "image/avif", "image/webp"];
  const parameterNames = ["scale_factor", "optimized_for", "engine", "creativity", "hdr", "resemblance", "fractality",
    "sharpen", "smart_grain", "ultra_detail", "flavor"];
  const parameterProperties = schemaProperties(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[1]).inputSchema.properties.parameters);
  assertStrictObject(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[0]).inputSchema,
    ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], []);
  assertStrictObject(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[1]).inputSchema,
    ["link_attempt_id", "variant", "image_handle", "parameters"], ["prompt"]);
  assertStrictObject(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[1]).inputSchema.properties.parameters, parameterNames, []);
  assertStrictObject(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[2]).inputSchema, ["link_attempt_id", "recovery_id"], []);
  assertStrictObject(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[3]).inputSchema, ["link_attempt_id"], ["limit"]);
  for (const name of OWNER_MAGNIFIC_TOOL_NAMES.slice(0, 2)) {
    const tool = byName.get(name);
    const variant = schemaProperties(tool.inputSchema).variant;
    if (!sameStringArray(variant?.enum, variants)) throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
    assertStrictOutput(tool.outputSchema);
  }
  const upload = byName.get(OWNER_MAGNIFIC_TOOL_NAMES[0]);
  const uploadProperties = schemaProperties(upload.inputSchema);
  if (!sameStringArray(uploadProperties.mime_type?.enum, mimeTypes) ||
      uploadProperties.content_base64?.maxLength !== Math.ceil((10 * 1024 * 1024) / 3) * 4) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
  if (!sameStringArray(parameterProperties.scale_factor?.enum, ["2x", "4x", "8x", "16x"])) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
  for (const name of OWNER_MAGNIFIC_TOOL_NAMES.slice(2)) {
    const tool = byName.get(name);
    assertStrictOutput(tool.outputSchema);
  }
  const generateProperties = schemaProperties(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[1]).inputSchema);
  if (Object.keys(generateProperties.parameters.properties).some((key) => /url|chat|model_type|^n$/iu.test(key)) ||
      ["url", "file_url", "file_urls", "chat_uuid", "model_id", "model_type", "n"].some((key) => key in generateProperties)) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
  const expectedAnnotations = [
    { title: "Upload a Magnific upscale input", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { title: "Upscale an owner image with Magnific", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { title: "Reconcile a Magnific upscale", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    { title: "List Magnific recovery handles", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  ];
  for (let index = 0; index < OWNER_MAGNIFIC_TOOL_NAMES.length; index += 1) {
    if (!sameRecord(byName.get(OWNER_MAGNIFIC_TOOL_NAMES[index]).annotations, expectedAnnotations[index])) {
      throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_ANNOTATIONS_INVALID");
    }
  }
  return Object.freeze({ magnific_tool_count: names.length });
}

export async function assertInstalledMagnificOwnerStdioSurface(installedPackagePath, consumerPath) {
  const defaultClient = await connectInstalledOwnerStdio(installedPackagePath, consumerPath, {}, "default");
  let defaultResult;
  try {
    const listed = await withinDeadline(defaultClient.client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500,
      "INSTALLED_MAGNIFIC_TOOLS_LIST_TIMEOUT");
    defaultResult = assertMagnificOwnerToolSurface(listed.tools, false);
  } finally {
    await defaultClient.closeAndVerify();
  }

  const optedInClient = await connectInstalledOwnerStdio(installedPackagePath, consumerPath,
    { SYNTX_OWNER_MAGNIFIC_UPSCALE: "1" }, "opt-in");
  let optedInResult;
  try {
    const listed = await withinDeadline(optedInClient.client.listTools({}, { timeout: 5_500, maxTotalTimeout: 5_500 }), 5_500,
      "INSTALLED_MAGNIFIC_TOOLS_LIST_TIMEOUT");
    optedInResult = assertMagnificOwnerToolSurface(listed.tools, true);
  } finally {
    await optedInClient.closeAndVerify();
  }
  return Object.freeze({ default_tools: defaultResult.magnific_tool_count, opt_in_tools: optedInResult.magnific_tool_count,
    sdk_operations: Object.freeze(["initialize", "tools/list", "close"]), provider_calls: 0, auth_calls: 0 });
}

async function connectInstalledOwnerStdio(installedPackagePath, consumerPath, env, label) {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js")
  ]);
  const client = new Client({ name: `syntx-installed-magnific-${label}`, version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport(createInstalledMagnificStdioOptions(installedPackagePath, consumerPath, env));
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const previousOnClose = transport.onclose;
  transport.onclose = () => { try { previousOnClose?.(); } finally { resolveClosed(true); } };
  try {
    await withinDeadline(client.connect(transport), 5_500, "INSTALLED_MAGNIFIC_STDIO_INITIALIZE_TIMEOUT");
  } catch {
    await withinDeadline(transport.close().catch(() => undefined), 2_000, "INSTALLED_MAGNIFIC_STDIO_CLOSE_FAILED").catch(() => undefined);
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_STDIO_START_FAILED");
  }
  const initialPid = transport.pid;
  if (!Number.isSafeInteger(initialPid) || initialPid <= 0) {
    await client.close().catch(() => undefined);
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_STDIO_PID_INVALID");
  }
  return Object.freeze({ client, async closeAndVerify() {
    let closeError;
    try { await withinDeadline(client.close(), 2_000, "INSTALLED_MAGNIFIC_STDIO_CLOSE_FAILED"); } catch { closeError = true; }
    let closedInTime = false;
    try { closedInTime = await withinDeadline(closed, 2_000, "INSTALLED_MAGNIFIC_STDIO_CLOSE_FAILED"); } catch { closedInTime = false; }
    if (closeError || closedInTime !== true || transport.pid !== null) {
      throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_STDIO_CLOSE_FAILED");
    }
  } });
}

function withinDeadline(promise, milliseconds, code) {
  let timer;
  return Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OwnerMagnificPackageSmokeError(code)), milliseconds);
  })]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}

function assertStrictObject(schema, requiredProperties, optionalProperties) {
  const properties = schemaProperties(schema);
  const expectedNames = [...requiredProperties, ...optionalProperties].sort();
  const required = stringList(schema.required);
  if (schema.type !== "object" || schema.additionalProperties !== false ||
      !sameStringArray(Object.keys(properties).sort(), expectedNames) ||
      !sameStringArray([...required].sort(), [...requiredProperties].sort())) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
}

function schemaProperties(schema) {
  if (!isRecord(schema) || !isRecord(schema.properties)) throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  return schema.properties;
}

function assertStrictOutput(schema) {
  if (!isRecord(schema) || schema.type !== "object" || schema.additionalProperties !== false) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
  assertAllObjectSchemasStrict(schema);
}

function assertAllObjectSchemasStrict(value) {
  if (Array.isArray(value)) { for (const item of value) assertAllObjectSchemasStrict(item); return; }
  if (!isRecord(value)) return;
  if (value.type === "object" && value.additionalProperties !== false) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
  for (const child of Object.values(value)) assertAllObjectSchemasStrict(child);
}

function stringList(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string") || new Set(value).size !== value.length) {
    throw new OwnerMagnificPackageSmokeError("INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  }
  return value;
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameRecord(actual, expected) {
  return isRecord(actual) && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.keys(expected).every((key) => actual[key] === expected[key]);
}

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
