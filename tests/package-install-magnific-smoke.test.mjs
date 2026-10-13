import assert from "node:assert/strict";
import test from "node:test";

const smokeModule = await import("../scripts/package-smoke/owner-magnific-stdio-smoke.mjs").catch(() => undefined);

const VARIANTS = ["creative", "precision_v1", "precision_v2"];
const PARAMETERS = ["scale_factor", "optimized_for", "engine", "creativity", "hdr", "resemblance", "fractality",
  "sharpen", "smart_grain", "ultra_detail", "flavor"];
const MIME_TYPES = ["image/jpeg", "image/png", "image/avif", "image/webp"];
const tool = (name, inputSchema, title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint) => ({
  name,
  inputSchema,
  outputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint }
});
function validMagnificTools() {
  const parameterProperties = {
    scale_factor: { type: "string", enum: ["2x", "4x", "8x", "16x"] },
    optimized_for: { type: "string", enum: ["standard", "soft_portraits", "hard_portraits", "art_n_illustration", "videogame_assets", "nature_n_landscapes", "films_n_photography", "3d_renders", "science_fiction_n_horror"] },
    engine: { type: "string", enum: ["automatic", "magnific_illusio", "magnific_sharpy", "magnific_sparkle"] },
    creativity: { type: "integer" }, hdr: { type: "integer" }, resemblance: { type: "integer" }, fractality: { type: "integer" },
    sharpen: { type: "integer" }, smart_grain: { type: "integer" }, ultra_detail: { type: "integer" },
    flavor: { type: "string", enum: ["sublime", "photo", "photo_denoiser"] }
  };
  const parameters = { type: "object", properties: parameterProperties, required: PARAMETERS, additionalProperties: false };
  return [
    tool("syntx_upload_magnific_upscale_image", { type: "object", required: ["link_attempt_id", "variant", "content_base64", "filename", "mime_type"], additionalProperties: false,
      properties: { link_attempt_id: { type: "string" }, variant: { type: "string", enum: VARIANTS },
        content_base64: { type: "string", maxLength: Math.ceil((10 * 1024 * 1024) / 3) * 4 }, filename: { type: "string" }, mime_type: { type: "string", enum: MIME_TYPES } } },
    "Upload a Magnific upscale input", false, true, false, true),
    tool("syntx_owner_generate_magnific_upscale_image", { type: "object", required: ["link_attempt_id", "variant", "image_handle", "parameters"], additionalProperties: false,
      properties: { link_attempt_id: { type: "string" }, variant: { type: "string", enum: VARIANTS }, image_handle: { type: "string" }, prompt: { type: "string" }, parameters } },
    "Upscale an owner image with Magnific", false, true, false, true),
    tool("syntx_owner_reconcile_magnific_upscale_image", { type: "object", required: ["link_attempt_id", "recovery_id"], additionalProperties: false,
      properties: { link_attempt_id: { type: "string" }, recovery_id: { type: "string" } } },
    "Reconcile a Magnific upscale", true, false, true, true),
    tool("syntx_owner_list_magnific_upscale_recoveries", { type: "object", required: ["link_attempt_id"], additionalProperties: false,
      properties: { link_attempt_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
    "List Magnific recovery handles", true, false, true, false)
  ];
}

test("installed Magnific smoke validator accepts the default-off zero-tool contract", () => {
  assert.equal(typeof smokeModule?.assertMagnificOwnerToolSurface, "function");
  assert.deepEqual(smokeModule.assertMagnificOwnerToolSurface([], false), { magnific_tool_count: 0 });
});

test("installed stdio options target the exact extracted package under the isolated consumer", () => {
  assert.equal(typeof smokeModule?.createInstalledMagnificStdioOptions, "function");
  assert.deepEqual(smokeModule.createInstalledMagnificStdioOptions("/tmp/consumer/node_modules/syntx-mcp", "/tmp/consumer",
    { SYNTX_OWNER_MAGNIFIC_UPSCALE: "1" }), {
    command: process.execPath,
    args: ["/tmp/consumer/node_modules/syntx-mcp/dist/src/transports/stdio-owner.js"],
    cwd: "/tmp/consumer",
    env: { SYNTX_OWNER_MAGNIFIC_UPSCALE: "1" },
    stderr: "pipe"
  });
});

test("installed Magnific smoke rejects an incomplete closed variant enum", () => {
  const tools = validMagnificTools();
  tools[1].inputSchema.properties.variant.enum = ["creative", "precision_v1"];
  assert.throws(() => smokeModule.assertMagnificOwnerToolSurface(tools, true),
    (error) => error?.code === "INSTALLED_MAGNIFIC_SCHEMA_INVALID");
});

test("installed Magnific smoke accepts the exact four-tool schema and annotations", () => {
  assert.deepEqual(smokeModule.assertMagnificOwnerToolSurface(validMagnificTools(), true), { magnific_tool_count: 4 });
});

test("installed Magnific smoke keeps opt-in off and rejects nested open output schemas", () => {
  assert.throws(() => smokeModule.assertMagnificOwnerToolSurface([
    { name: "syntx_owner_generate_magnific_upscale_image" }
  ], false), (error) => error?.code === "INSTALLED_MAGNIFIC_DEFAULT_OFF_FAILED");
  const tools = validMagnificTools();
  tools[1].outputSchema.properties = { artifact: { type: "object", properties: { url: { type: "string" } } } };
  assert.throws(() => smokeModule.assertMagnificOwnerToolSurface(tools, true),
    (error) => error?.code === "INSTALLED_MAGNIFIC_SCHEMA_INVALID");
});

test("installed Magnific smoke rejects upload URL fields and a widened Base64 cap", () => {
  const urlTools = validMagnificTools();
  urlTools[0].inputSchema.properties.file_url = { type: "string" };
  assert.throws(() => smokeModule.assertMagnificOwnerToolSurface(urlTools, true),
    (error) => error?.code === "INSTALLED_MAGNIFIC_SCHEMA_INVALID");
  const widenedTools = validMagnificTools();
  widenedTools[0].inputSchema.properties.content_base64.maxLength += 1;
  assert.throws(() => smokeModule.assertMagnificOwnerToolSurface(widenedTools, true),
    (error) => error?.code === "INSTALLED_MAGNIFIC_SCHEMA_INVALID");
});

test("installed Magnific smoke rejects a missing explicit parameter from the strict state", () => {
  const tools = validMagnificTools();
  delete tools[1].inputSchema.properties.parameters.properties.flavor;
  tools[1].inputSchema.properties.parameters.required = PARAMETERS.slice(0, -1);
  assert.throws(() => smokeModule.assertMagnificOwnerToolSurface(tools, true),
    (error) => error?.code === "INSTALLED_MAGNIFIC_SCHEMA_INVALID");
});
