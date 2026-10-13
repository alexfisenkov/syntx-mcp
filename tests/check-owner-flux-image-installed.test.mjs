import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const compiledSourceRoot = process.env.SYNTX_FLUX_INSTALLED_TEST_COMPILED_ROOT
  ? pathToFileURL(`${resolve(process.env.SYNTX_FLUX_INSTALLED_TEST_COMPILED_ROOT)}/`)
  : new URL("../dist/src/", import.meta.url);
const compiled = (path) => import(new URL(path, compiledSourceRoot).href);

test("opted-in installed Flux checker rejects a tool list that omits the five native tools", async () => {
  const source = "../scripts/check-owner-flux-image-installed.mjs";
  const checker = await import(new URL(source, import.meta.url).href);
  assert.throws(() => checker.assertOwnerFluxImageToolNames([], true),
    (error) => error?.code === "INSTALLED_FLUX_IMAGE_TOOL_SET_MISMATCH");
});

test("Flux native tool names are absent by default and exact under opt-in", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const names = ["syntx_upload_flux_image_reference", "syntx_register_flux_public_lora", "syntx_owner_generate_flux_image",
    "syntx_owner_reconcile_flux_image", "syntx_owner_list_flux_image_recoveries"];
  assert.deepEqual(checker.assertOwnerFluxImageToolNames([], false), { flux_image_tool_count: 0 });
  assert.deepEqual(checker.assertOwnerFluxImageToolNames(names.map((name) => ({ name })), true), { flux_image_tool_count: 5 });
  assert.throws(() => checker.assertOwnerFluxImageToolNames([{ name: names[0] }], false),
    (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_DEFAULT_OFF_FAILED");
  assert.throws(() => checker.assertOwnerFluxImageToolNames([...names.map((name) => ({ name })), { name: names[0] }], true),
    (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_TOOL_SET_MISMATCH");
});

test("Flux SDK schema guard rejects an opted-in five-name surface with missing schemas", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const tools = ["syntx_upload_flux_image_reference", "syntx_register_flux_public_lora", "syntx_owner_generate_flux_image",
    "syntx_owner_reconcile_flux_image", "syntx_owner_list_flux_image_recoveries"].map((name) => ({ name, inputSchema: {}, outputSchema: {} }));
  assert.throws(() => checker.assertOwnerFluxImageToolSurface(tools, true),
    (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_SCHEMA_INVALID");
});

test("installed Flux barrel exposes only safe native service and DTO APIs, never private candidate state", async () => {
  const api = await compiled("index.js");
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  for (const name of ["OwnerFluxImageUploadService", "OwnerFluxImageAssetService", "OwnerFluxImageGenerationService",
    "OwnerFluxImageGenerationServiceError", "OWNER_FLUX_IMAGE_GENERATION_PHASES", "OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES",
    "OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS", "OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS", "registerSyntxOwnerFluxImageTools"]) {
    assert.ok(Object.hasOwn(api, name), `missing safe Flux export: ${name}`);
  }
  for (const name of ["getOwnerFluxImagePreparedCandidateState", "observeOwnerFluxImageCandidateClock"]) {
    assert.equal(Object.hasOwn(api, name), false, `private Flux candidate API leaked: ${name}`);
  }
  const declaration = await readFile(new URL("index.d.ts", compiledSourceRoot), "utf8");
  assert.deepEqual(checker.assertOwnerFluxImageDeclarations(declaration), {
    safe_flux_declarations_checked: 27, private_candidate_declarations_absent: true
  });
});

test("source-composed Flux MCP schema passes installed checker in default-off and five-tool opt-in modes", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createDefaultApplication } = await compiled("application/factory.js");
  const { createMcpServer } = await compiled("mcp/server.js");
  const generation = await compiled("application/owner-flux-image-generation-service.js");
  const composition = { uploadService: { async upload() { throw new Error("unused by tools/list"); } },
    assetService: { async registerPublicLora() { throw new Error("unused by tools/list"); } },
    generationService: { async generate() { throw new Error("unused by tools/list"); }, async reconcile() { throw new Error("unused by tools/list"); },
      async listRecoveries() { return []; } } };
  const diagnosticEnums = { phases: generation.OWNER_FLUX_IMAGE_GENERATION_PHASES, errorCodes: generation.OWNER_FLUX_IMAGE_GENERATION_ERROR_CODES,
    historyReasons: generation.OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS, resultReasons: generation.OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS };
  async function list(options) {
    const server = createMcpServer(createDefaultApplication(), options);
    const client = new Client({ name: "flux-installed-checker-source-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport); await client.connect(clientTransport);
    try { return await client.listTools(); } finally { await client.close(); await server.close(); }
  }
  const disabled = await list({});
  assert.deepEqual(checker.assertOwnerFluxImageToolSurface(disabled.tools, false, diagnosticEnums), { flux_image_tool_count: 0 });
  const enabled = await list({ ownerFluxImageReferences: composition });
  assert.deepEqual(checker.assertOwnerFluxImageToolSurface(enabled.tools, true, diagnosticEnums), { flux_image_tool_count: 5 });
});

test("Flux package gate requires JavaScript and declaration output for the full native service chain", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const paths = ["dist/src/index.js", "dist/src/index.d.ts", ...[
    "application/owner-flux-image-parameters", "application/owner-flux-image-source-profile",
    "application/owner-flux-image-request-preparer", "application/owner-flux-image-history-binding",
    "application/owner-flux-image-one-shot-policy", "application/owner-flux-image-upload-service",
    "application/owner-flux-image-asset-service", "application/owner-flux-image-generation-service",
    "application/owner-runway-flux-image-input-validator",
    "adapter/syntx/chat-http-client", "adapter/syntx/flux-image-result", "adapter/syntx/upload-reference-bridge",
    "adapter/civitai/public-model-file-client", "adapter/civitai/public-model-file-attestor", "adapter/civitai/pinned-https-download-transport",
    "mcp/owner-flux-image-tools", "mcp/server", "runtime/observed-owner-runtime", "transports/stdio-owner", "catalog/selected-discovery-catalog"
  ].flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])];
  assert.equal(checker.assertOwnerFluxImagePackagePaths(new Set(paths)), true);
  assert.throws(() => checker.assertOwnerFluxImagePackagePaths(new Set(paths.filter((path) =>
    path !== "dist/src/application/owner-flux-image-generation-service.d.ts"))),
  (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_PACKAGE_CONTENT_MISSING");
});

test("Flux loaded modules are keyed by package-relative path, not their order", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const paths = ["catalog/selected-discovery-catalog", "application/owner-flux-image-generation-service", "mcp/server"];
  const modules = [{ id: "catalog" }, { id: "generation" }, { id: "server" }];
  const bound = checker.mapOwnerFluxImageNativeModules(paths, modules);
  assert.equal(bound.get("mcp/server"), modules[2]);
  assert.throws(() => checker.mapOwnerFluxImageNativeModules(paths, modules.slice(1)),
    (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_MODULE_MAP_INVALID");
});

test("Flux consumer SDK path guard rejects project checkout resolution", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const consumer = "/private/var/folders/consumer";
  const sdk = `${consumer}/node_modules/@modelcontextprotocol/sdk`;
  const valid = { consumerPath: "/var/folders/consumer", resolvedConsumerPath: consumer,
    sdkPackagePath: "/var/folders/consumer/node_modules/@modelcontextprotocol/sdk", resolvedSdkPackagePath: sdk,
    clientModulePath: `${sdk}/dist/esm/client/index.js`, stdioModulePath: `${sdk}/dist/esm/client/stdio.js`,
    projectRoot: "/Users/AlexFisenkov/project" };
  assert.equal(checker.assertConsumerSdkResolution(valid), true);
  assert.throws(() => checker.assertConsumerSdkResolution({ ...valid, sdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk",
    resolvedSdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk" }),
  (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_SDK_NOT_FROM_CONSUMER");
});

test("Flux error diagnostics contain only an allowlisted phase and error class", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const code = checker.ownerFluxImageUnexpectedErrorCode("source-contract", new TypeError("presigned URL and token must not escape"));
  assert.equal(code, "INSTALLED_FLUX_IMAGE_UNEXPECTED_source-contract_TypeError");
  assert.equal(code.includes("presigned"), false); assert.equal(code.includes("token"), false);
  assert.throws(() => checker.ownerFluxImageUnexpectedErrorCode("unknown", new Error("unused")),
    (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code === "INSTALLED_FLUX_IMAGE_DIAGNOSTIC_PHASE_INVALID");
});

test("installed Flux source contract checks three pinned profiles, eighteen resolutions and all four LoRA counts", async () => {
  const checker = await import(new URL("../scripts/check-owner-flux-image-installed.mjs", import.meta.url).href);
  const parameters = await compiled("application/owner-flux-image-parameters.js");
  const profiles = await compiled("application/owner-flux-image-source-profile.js");
  const catalogModule = await compiled("catalog/selected-discovery-catalog.js");
  assert.equal(typeof checker.assertOwnerFluxImageSourceContract, "function");
  const version = catalogModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  const selected = catalogModule.loadSelectedDiscoveryCatalog(version);
  assert.deepEqual(checker.assertOwnerFluxImageSourceContract(parameters, profiles, selected.discoveryCatalog, version), {
    flux_models_checked: 3, flux_resolution_cases_checked: 18, flux_lora_counts_checked: 4,
    lora_pin_consistency: "MATCH", source_execution_claimed: false
  });
  const source = parameters.getOwnerFluxImageSourceParameters();
  const altered = { ...parameters, getOwnerFluxImageSourceParameters: () => ({ ...source,
    source_pins: { ...source.source_pins, form_sha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000" } }) };
  assert.throws(() => checker.assertOwnerFluxImageSourceContract(altered, profiles, selected.discoveryCatalog, version),
    (error) => error instanceof checker.OwnerFluxImageInstalledCheckError && error.code.startsWith("INSTALLED_FLUX_IMAGE_SOURCE_CONTRACT_INVALID_"));
});
