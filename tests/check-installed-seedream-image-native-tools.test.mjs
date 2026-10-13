import assert from "node:assert/strict";
import test from "node:test";

test("installed Seedream package path gate requires compiled native modules and declarations", async () => {
  const module = await import("../scripts/check-installed-seedream-image-native-tools.mjs");
  const paths = [
    "dist/src/index.js", "dist/src/index.d.ts",
    ...[
      "application/owner-seedream-image-parameters",
      "application/owner-seedream-image-source-profile",
      "application/owner-seedream-image-input-validator",
      "application/owner-seedream-extra-image-inspector",
      "application/owner-png-alpha-inspector",
      "application/owner-seedream-source-alpha-witness",
      "application/owner-seedream-image-upload-service",
      "application/owner-seedream-image-request-preparer",
      "application/owner-seedream-image-history-binding",
      "application/owner-seedream-image-one-shot-policy",
      "application/owner-seedream-image-generation-service",
      "mcp/owner-seedream-image-tools", "mcp/server", "runtime/observed-owner-runtime",
      "transports/stdio-owner", "adapter/syntx/chat-http-client", "adapter/syntx/seedream-image-result",
      "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"
    ].flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])
  ];
  assert.equal(module.assertSeedreamImageNativePackagePaths(new Set(paths)), true);
  assert.throws(() => module.assertSeedreamImageNativePackagePaths(new Set(paths.filter((path) => path !==
    "dist/src/application/owner-seedream-image-generation-service.d.ts"))),
  (error) => error instanceof module.SeedreamImageNativeToolsError && error.code === "INSTALLED_SEEDREAM_IMAGE_PACKAGE_CONTENT_MISSING");
});

test("installed Seedream module bindings follow package paths, not import-array positions", async () => {
  const module = await import("../scripts/check-installed-seedream-image-native-tools.mjs");
  const names = ["adapter/syntx/seedream-image-result", "adapter/syntx/upload-reference-bridge", "catalog/selected-discovery-catalog"];
  const loaded = [{ id: "seedream-result" }, { id: "upload-bridge" }, { id: "selected-catalog" }];
  const mapped = module.mapSeedreamImageNativeModules(names, loaded);
  assert.equal(mapped.get("catalog/selected-discovery-catalog"), loaded[2]);
  assert.equal(mapped.get("adapter/syntx/seedream-image-result"), loaded[0]);
  assert.throws(() => module.mapSeedreamImageNativeModules(names, loaded.slice(1)),
    (error) => error instanceof module.SeedreamImageNativeToolsError && error.code === "INSTALLED_SEEDREAM_IMAGE_MODULE_MAP_INVALID");
});

test("installed Seedream native surface is default-off and reports exactly four opted-in tools", async () => {
  const module = await import("../scripts/check-installed-seedream-image-native-tools.mjs");
  const names = ["syntx_upload_seedream_image_reference", "syntx_owner_generate_seedream_image",
    "syntx_owner_reconcile_seedream_image", "syntx_owner_list_seedream_image_recoveries"];
  assert.deepEqual(module.assertSeedreamImageToolNames([], false), { seedream_image_tool_count: 0 });
  const tools = names.map((name) => ({ name }));
  assert.deepEqual(module.assertSeedreamImageToolNames(tools, true), { seedream_image_tool_count: 4 });
  assert.throws(() => module.assertSeedreamImageToolNames([...tools, tools[0]], true),
    (error) => error instanceof module.SeedreamImageNativeToolsError && error.code === "INSTALLED_SEEDREAM_IMAGE_TOOL_SET_MISMATCH");
  assert.throws(() => module.assertSeedreamImageToolNames([{ name: names[0] }], false),
    (error) => error instanceof module.SeedreamImageNativeToolsError && error.code === "INSTALLED_SEEDREAM_IMAGE_DEFAULT_OFF_FAILED");
});

test("installed Seedream SDK must resolve from the direct consumer dependency and canonical child paths", async () => {
  const module = await import("../scripts/check-installed-seedream-image-native-tools.mjs");
  const valid = {
    consumerPath: "/var/folders/consumer", resolvedConsumerPath: "/private/var/folders/consumer",
    sdkPackagePath: "/var/folders/consumer/node_modules/@modelcontextprotocol/sdk",
    resolvedSdkPackagePath: "/private/var/folders/consumer/node_modules/@modelcontextprotocol/sdk",
    clientModulePath: "/private/var/folders/consumer/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
    stdioModulePath: "/private/var/folders/consumer/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js",
    projectRoot: "/Users/AlexFisenkov/project"
  };
  assert.equal(module.assertConsumerSdkResolution(valid), true);
  assert.throws(() => module.assertConsumerSdkResolution({ ...valid,
    sdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk",
    resolvedSdkPackagePath: "/Users/AlexFisenkov/project/node_modules/@modelcontextprotocol/sdk"
  }), (error) => error instanceof module.SeedreamImageNativeToolsError && error.code === "INSTALLED_SEEDREAM_IMAGE_SDK_NOT_FROM_CONSUMER");
  assert.throws(() => module.assertConsumerSdkResolution({ ...valid,
    stdioModulePath: "/private/var/other/sdk/dist/esm/client/stdio.js"
  }), (error) => error instanceof module.SeedreamImageNativeToolsError && error.code === "INSTALLED_SEEDREAM_IMAGE_SDK_NOT_FROM_CONSUMER");
});

test("installed Seedream diagnostics expose only an allowlisted phase and error class", async () => {
  const module = await import("../scripts/check-installed-seedream-image-native-tools.mjs");
  const error = new TypeError("private path and token must never be copied");
  const code = module.seedreamImageUnexpectedErrorCode("compiled-api", error);
  assert.equal(code, "INSTALLED_SEEDREAM_IMAGE_UNEXPECTED_compiled-api_TypeError");
  assert.equal(code.includes("private"), false);
  assert.equal(code.includes("token"), false);
  assert.throws(() => module.seedreamImageUnexpectedErrorCode("unknown-phase", new Error("unused")),
    (failure) => failure instanceof module.SeedreamImageNativeToolsError && failure.code === "INSTALLED_SEEDREAM_IMAGE_DIAGNOSTIC_PHASE_INVALID");
});

test("installed Seedream source API verifies five profiles, all 104 parameter pairs, and non-authoritative Flash declarations", async () => {
  const checker = await import("../scripts/check-installed-seedream-image-native-tools.mjs");
  const parameters = await import("../dist/src/application/owner-seedream-image-parameters.js");
  const profile = await import("../dist/src/application/owner-seedream-image-source-profile.js");
  const catalogModule = await import("../dist/src/catalog/selected-discovery-catalog.js");
  const version = catalogModule.DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
  const selected = catalogModule.loadSelectedDiscoveryCatalog(version);
  assert.deepEqual(checker.assertSeedreamImageSourceContract(parameters, profile, selected.discoveryCatalog, version), {
    seedream_variants_checked: 5,
    seedream_parameter_combinations_checked: 104,
    source_execution_claimed: false
  });
});

test("public Seedream barrel does not expose internal candidate clock or WeakMap state accessors", async () => {
  const api = await import("../dist/src/index.js");
  assert.equal(Object.hasOwn(api, "observeOwnerSeedreamImageCandidateClock"), false);
  assert.equal(Object.hasOwn(api, "getOwnerSeedreamImagePreparedCandidateState"), false);
});
