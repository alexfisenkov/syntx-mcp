import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const compiledSourceRoot = process.env.SYNTX_IDEOGRAM_INSTALLED_TEST_COMPILED_ROOT
  ? pathToFileURL(`${resolve(process.env.SYNTX_IDEOGRAM_INSTALLED_TEST_COMPILED_ROOT)}/`)
  : new URL("../dist/src/", import.meta.url);
const compiled = (path) => import(new URL(path, compiledSourceRoot).href);
const helperUrl = new URL("../scripts/check-installed-ideogram-image-reference.mjs", import.meta.url);

test("installed Ideogram package path contract includes the service, source, tools, runtime, and SDK boundaries", async () => {
  const helper = await import(helperUrl);
  const modules = [
    "application/owner-ideogram-image-parameters", "application/owner-ideogram-image-source-profile",
    "application/owner-ideogram-image-input", "application/owner-ideogram-image-upload-service",
    "application/owner-ideogram-image-mask-upload-service",
    "application/owner-ideogram-image-request-preparer", "application/owner-ideogram-image-history-binding",
    "application/owner-ideogram-image-one-shot-policy", "application/owner-ideogram-image-generation-service",
    "application/owner-ideogram-painted-mask-codec",
    "mcp/owner-ideogram-image-tools", "mcp/server", "runtime/observed-owner-runtime", "transports/stdio-owner",
    "adapter/syntx/chat-http-client", "adapter/syntx/ideogram-image-result", "adapter/syntx/upload-reference-bridge",
    "catalog/selected-discovery-catalog"
  ];
  const paths = new Set(["dist/src/index.js", "dist/src/index.d.ts", ...modules.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);
  assert.equal(helper.assertIdeogramImagePackagePaths(paths), true);
  paths.delete("dist/src/application/owner-ideogram-image-generation-service.d.ts");
  assert.throws(() => helper.assertIdeogramImagePackagePaths(paths),
    (error) => error instanceof helper.IdeogramImageReferenceInstalledCheckError && error.code === "INSTALLED_IDEOGRAM_IMAGE_PACKAGE_CONTENT_MISSING");
});

test("installed Ideogram tool set is default-off and exact under the owner opt-in", async () => {
  const helper = await import(helperUrl);
  const names = ["syntx_upload_ideogram_image_reference", "syntx_upload_ideogram_mask", "syntx_owner_generate_ideogram_image",
    "syntx_owner_reconcile_ideogram_image", "syntx_owner_list_ideogram_image_recoveries"];
  assert.deepEqual(helper.assertIdeogramImageToolNames([], false), { ideogram_image_tool_count: 0 });
  assert.deepEqual(helper.assertIdeogramImageToolNames(names.map((name) => ({ name })), true), { ideogram_image_tool_count: 5 });
  assert.throws(() => helper.assertIdeogramImageToolNames([{ name: names[0] }], false),
    (error) => error instanceof helper.IdeogramImageReferenceInstalledCheckError && error.code === "INSTALLED_IDEOGRAM_IMAGE_DEFAULT_OFF_FAILED");
  assert.throws(() => helper.assertIdeogramImageToolNames([...names.map((name) => ({ name })), { name: names[0] }], true),
    (error) => error instanceof helper.IdeogramImageReferenceInstalledCheckError && error.code === "INSTALLED_IDEOGRAM_IMAGE_TOOL_SET_MISMATCH");
});

test("actual MCP SDK schemas are closed and expose all nine supported mode pairs", async () => {
  const helper = await import(helperUrl);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const toolsModule = await compiled("mcp/owner-ideogram-image-tools.js");
  const generation = await compiled("application/owner-ideogram-image-generation-service.js");
  const server = new McpServer({ name: "installed-ideogram-schema-test", version: "1" });
  const composition = {
    uploadService: { async upload() { throw new Error("not called by tools/list"); } },
    maskUploadService: { async upload() { throw new Error("not called by tools/list"); }, async invalidateAttempt() {}, async close() {} },
    generationService: { async generate() { throw new Error("not called by tools/list"); },
      async reconcile() { throw new Error("not called by tools/list"); }, async listRecoveries() { return []; } }
  };
  toolsModule.registerSyntxOwnerIdeogramImageTools(server, composition);
  const client = new Client({ name: "installed-ideogram-schema-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const enums = { phases: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_PHASES,
      errorCodes: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_ERROR_CODES,
      historyReasons: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS,
      resultReasons: generation.OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS };
    const parameters = await compiled("application/owner-ideogram-image-parameters.js");
    const report = helper.assertIdeogramImageToolSurface(listed.tools, true, enums, parameters.getOwnerIdeogramImageParameterProfile());
    assert.equal(report.ideogram_image_tool_count, 5);
    assert.equal(report.generation_context_pairs, 9);
    assert.equal(report.upload_context_pairs, 8);
    assert.equal(report.mask_upload_tool_count, 1);
    assert.equal(report.closed_object_schemas, true);
    const mask = listed.tools.find((tool) => tool.name === "syntx_upload_ideogram_mask");
    assert.ok(mask);
    const maskInput = mask.inputSchema.properties;
    assert.deepEqual(Object.keys(maskInput).sort(), ["base_reference_handle", "link_attempt_id", "painted_rgba_png_base64"].sort());
    const generate = listed.tools.find((tool) => tool.name === "syntx_owner_generate_ideogram_image");
    assert.equal(generate.inputSchema.properties.mask_handle.pattern, "^ideogram_mask_[0-9a-f-]{36}$");
    assert.equal(generate.outputSchema.properties.mask_present.type, "boolean");
    assert.deepEqual(generate.outputSchema.properties.mask_acceptance.enum, ["UNPROVEN", "NOT_REQUESTED"]);
  } finally { await client.close(); await server.close(); }
});

test("the installed pure parameter/source APIs retain all contexts, 69 resolutions, explicit batch sizes, and source pins", async () => {
  const helper = await import(helperUrl);
  const parameters = await compiled("application/owner-ideogram-image-parameters.js");
  const profile = await compiled("application/owner-ideogram-image-source-profile.js");
  const selectedModule = await compiled("catalog/selected-discovery-catalog.js");
  const version = selectedModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  const selected = selectedModule.loadSelectedDiscoveryCatalog(version, resolve(process.cwd(), "catalog"));
  assert.deepEqual(helper.assertIdeogramImageSourceContract(parameters, profile, selected.discoveryCatalog, version), {
    ideogram_contexts_checked: 9,
    ideogram_parameter_combinations_checked: 7_728,
    ideogram_mode_batch_checks: 72,
    ideogram_resolutions_checked: 69,
    source_execution_claimed: false
  });
});

test("the public barrel exposes safe Ideogram DTO/services, but no candidate, permit, or painted-mask codec grant", async () => {
  const helper = await import(helperUrl);
  const api = await compiled("index.js");
  const modules = {
    parameters: await compiled("application/owner-ideogram-image-parameters.js"),
    profile: await compiled("application/owner-ideogram-image-source-profile.js"),
    upload: await compiled("application/owner-ideogram-image-upload-service.js"),
    generation: await compiled("application/owner-ideogram-image-generation-service.js"),
    tools: await compiled("mcp/owner-ideogram-image-tools.js"),
    server: await compiled("mcp/server.js")
  };
  assert.deepEqual(helper.assertIdeogramImagePublicExports(api, modules), {
    safe_ideogram_image_exports_checked: helper.IDEOGRAM_IMAGE_SAFE_EXPORT_NAMES.length,
    private_candidate_and_codec_exports_absent: true
  });
  const declaration = await readFile(new URL("index.d.ts", compiledSourceRoot), "utf8");
  assert.deepEqual(helper.assertIdeogramImageDeclarations(declaration), {
    safe_ideogram_image_declarations_checked: helper.IDEOGRAM_IMAGE_SAFE_DECLARATION_NAMES.length,
    private_candidate_and_codec_declarations_absent: true
  });
});

test("installed checker diagnostics expose only the phase and error class", async () => {
  const helper = await import(helperUrl);
  const error = new TypeError("presigned URL and credential must not escape");
  const code = helper.ideogramImageUnexpectedErrorCode("module-import", error);
  assert.equal(code, "INSTALLED_IDEOGRAM_IMAGE_UNEXPECTED_module-import_TypeError");
  assert.equal(code.includes("presigned"), false);
  assert.equal(code.includes("credential"), false);
  assert.throws(() => helper.ideogramImageUnexpectedErrorCode("unknown-phase", new Error("unused")),
    (failure) => failure instanceof helper.IdeogramImageReferenceInstalledCheckError && failure.code === "INSTALLED_IDEOGRAM_IMAGE_DIAGNOSTIC_PHASE_INVALID");
});
