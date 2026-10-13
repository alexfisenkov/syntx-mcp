import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as parameters from "../dist/src/application/owner-uni-image-parameters.js";
import * as sourceProfile from "../dist/src/application/owner-uni-image-source-profile.js";
import * as uploadProfile from "../dist/src/catalog/owner-uni-image-upload-profile.js";
import * as inputPolicy from "../dist/src/application/owner-uni-image-input-validator.js";
import { DiscoveryCatalogRepository } from "../dist/src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../dist/src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../dist/src/catalog/syntx-public-catalog.js";
import * as toolsModule from "../dist/src/mcp/owner-uni-image-tools.js";
import * as generation from "../dist/src/application/owner-uni-image-generation-service.js";
import * as stdio from "../dist/src/transports/stdio-owner.js";
import * as uploadServiceModule from "../dist/src/application/owner-uni-image-upload-service.js";
import * as serverModule from "../dist/src/mcp/server.js";
import * as runtimeModule from "../dist/src/runtime/observed-owner-runtime.js";
import * as publicApi from "../dist/src/index.js";
import { z } from "zod/v4";
import {
  assertUniImageSourceContract,
  assertUniImageNativePackagePaths,
  assertUniImageToolNames,
  assertUniImageToolSurface,
  assertUniImageDiagnosticEnums,
  assertUniImageFlagReader,
  assertUniImagePublicExports,
  assertUniImageDeclarations,
  assertUniImageConsumerSdkResolution,
  uniImageUnexpectedErrorCode,
  UniImageInstalledCheckError
} from "../scripts/check-installed-uni-image-tools.mjs";

const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", VERSION), "utf8"
))));

test("installed Uni source checker verifies all explicit controls, reference ranges, and upload policy", () => {
  const summary = assertUniImageSourceContract(parameters, sourceProfile, uploadProfile, inputPolicy, CATALOG, VERSION);
  assert.deepEqual(summary, {
    uni_models_checked: 3,
    uni1_ratio_mode_pairs_checked: 15,
    parameter_cases_checked: 53,
    reference_count_cases_checked: 19,
    upload_mime_types_checked: 5,
    local_upload_bytes: 26_214_400,
    source_execution_claimed: false,
    provider_acceptance_claimed: false
  });
});

test("source checker rejects a mismatched selected catalog version and runtime-active profile", () => {
  assert.throws(() => assertUniImageSourceContract(parameters, sourceProfile, uploadProfile, inputPolicy, CATALOG,
    "sha256-previous-catalog.json"), (error) => error instanceof UniImageInstalledCheckError &&
      error.code === "INSTALLED_UNI_IMAGE_SOURCE_PROFILE_INVALID");
  const driftedProfile = { ...sourceProfile, getOwnerUniImageSourceProfile(modelId, catalog, version) {
    return { ...sourceProfile.getOwnerUniImageSourceProfile(modelId, catalog, version), runtime_activation: true };
  } };
  assert.throws(() => assertUniImageSourceContract(parameters, driftedProfile, uploadProfile, inputPolicy, CATALOG, VERSION),
    (error) => error instanceof UniImageInstalledCheckError && error.code === "INSTALLED_UNI_IMAGE_SOURCE_PROFILE_INVALID");
});

test("installed Uni checker package-path gate rejects an omitted compiled declaration", () => {
  const modules = ["application/owner-uni-image-parameters", "application/owner-uni-image-source-profile",
    "application/owner-uni-image-input-validator", "application/owner-uni-image-upload-service",
    "application/owner-uni-image-request-preparer", "application/owner-uni-image-one-shot-policy",
    "application/owner-uni-image-history-binding", "application/owner-uni-image-generation-service",
    "application/account-status", "application/model-access", "catalog/owner-uni-image-upload-profile", "catalog/selected-discovery-catalog",
    "catalog/public-catalog-history", "mcp/owner-uni-image-tools", "mcp/server", "runtime/observed-owner-runtime",
    "transports/stdio-owner", "adapter/syntx/chat-http-client", "adapter/syntx/owner-uni-image-result",
    "adapter/syntx/account-decoder", "adapter/syntx/upload-reference-bridge", "adapter/syntx/request-deadline",
    "auth/owner-reference-principal"];
  const paths = new Set(["dist/src/index.js", "dist/src/index.d.ts",
    ...modules.flatMap((name) => [`dist/src/${name}.js`, `dist/src/${name}.d.ts`])]);
  assert.equal(assertUniImageNativePackagePaths(paths), true);
  paths.delete("dist/src/application/owner-uni-image-generation-service.d.ts");
  assert.throws(() => assertUniImageNativePackagePaths(paths), (error) => error.code === "INSTALLED_UNI_IMAGE_PACKAGE_CONTENT_MISSING");
});

test("Uni installed checker enforces default-off and exactly four named tools", async () => {
  assert.deepEqual(assertUniImageToolNames([], false), { uni_image_tool_count: 0 });
  const names = [...toolsModule.OWNER_UNI_IMAGE_TOOL_NAMES];
  assert.deepEqual(assertUniImageToolNames(names.map((name) => ({ name })), true), { uni_image_tool_count: 4 });
  assert.throws(() => assertUniImageToolNames([...names.map((name) => ({ name })), { name: names[0] }], true),
    (error) => error instanceof UniImageInstalledCheckError && error.code === "INSTALLED_UNI_IMAGE_TOOL_SET_MISMATCH");
  assert.throws(() => assertUniImageToolNames([{ name: names[0] }], false),
    (error) => error instanceof UniImageInstalledCheckError && error.code === "INSTALLED_UNI_IMAGE_DEFAULT_OFF_FAILED");
});

test("Uni installed checker verifies the actual strict default-off flag reader", () => {
  assert.equal(assertUniImageFlagReader(stdio), true);
});

test("Uni installed checker restricts SDK resolution to the consumer and redacts unexpected errors", () => {
  const consumer = "/private/tmp/uni-consumer";
  const resolvedSdk = `${consumer}/node_modules/@modelcontextprotocol/sdk`;
  const good = { consumerPath: "/tmp/uni-consumer", resolvedConsumerPath: consumer,
    sdkPackagePath: "/tmp/uni-consumer/node_modules/@modelcontextprotocol/sdk", resolvedSdkPackagePath: resolvedSdk,
    clientModulePath: `${resolvedSdk}/dist/esm/client/index.js`, stdioModulePath: `${resolvedSdk}/dist/esm/client/stdio.js`,
    projectRoot: "/Users/AlexFisenkov/project" };
  assert.equal(assertUniImageConsumerSdkResolution(good), true);
  assert.throws(() => assertUniImageConsumerSdkResolution({ ...good, resolvedSdkPackagePath: "/Users/AlexFisenkov/project/node_modules/sdk" }),
    (error) => error.code === "INSTALLED_UNI_IMAGE_SDK_NOT_FROM_CONSUMER");
  const code = uniImageUnexpectedErrorCode("source-contract", new TypeError("secret URL and credential"));
  assert.equal(code, "INSTALLED_UNI_IMAGE_UNEXPECTED_source-contract_TypeError");
  assert.equal(code.includes("credential"), false);
  assert.throws(() => uniImageUnexpectedErrorCode("unknown", new Error("unused")),
    (error) => error.code === "INSTALLED_UNI_IMAGE_DIAGNOSTIC_PHASE_INVALID");
});

test("Uni installed checker validates source-derived strict schemas and rejects widened count/acceptance", () => {
  const schemas = toolsModule.OWNER_UNI_IMAGE_TOOL_INPUT_SCHEMAS;
  const outputs = toolsModule.OWNER_UNI_IMAGE_TOOL_OUTPUT_SCHEMAS;
  const names = [...toolsModule.OWNER_UNI_IMAGE_TOOL_NAMES];
  const descriptions = [
    "Upload one locally validated image for the exact linked owner attempt. Returns an opaque handle; upload does not authorize generation.",
    "Starts one source-bound Uni image generation after fresh account and model-access preflights. Unknown outcomes must be reconciled, never retried.",
    "Read-only reconciliation for the exact attempt and recovery handle. It never starts another generation.",
    "Lists bounded, process-local recovery diagnostics for the exact linked owner attempt without prompts, references, or artifact URLs."
  ];
  const annotations = [
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  ];
  const inputKeys = ["upload", "generate", "reconcile", "list_recoveries"];
  const tools = names.map((name, index) => ({ name,
    inputSchema: z.toJSONSchema(schemas[inputKeys[index]]),
    outputSchema: z.toJSONSchema(outputs[inputKeys[index]]),
    description: descriptions[index], annotations: annotations[index] }));
  const enums = { phases: generation.OWNER_UNI_IMAGE_GENERATION_PHASES,
    errorCodes: generation.OWNER_UNI_IMAGE_GENERATION_ERROR_CODES,
    historyReasons: generation.OWNER_UNI_IMAGE_GENERATION_HISTORY_REASONS,
    resultReasons: generation.OWNER_UNI_IMAGE_GENERATION_RESULT_REASONS };
  assert.equal(assertUniImageDiagnosticEnums(enums), true);
  assert.deepEqual(assertUniImageToolSurface(tools, true, enums), { uni_image_tool_count: 4 });
  const widened = structuredClone(tools);
  widened[1].inputSchema.properties.image_reference_handles.maxItems = 10;
  assert.throws(() => assertUniImageToolSurface(widened, true, enums),
    (error) => error instanceof UniImageInstalledCheckError && error.code === "INSTALLED_UNI_IMAGE_GENERATE_INPUT_SCHEMA_INVALID");
  const falseAcceptance = structuredClone(tools);
  falseAcceptance[1].outputSchema.properties.backend_acceptance.const = "ACCEPTED";
  assert.throws(() => assertUniImageToolSurface(falseAcceptance, true, enums),
    (error) => error instanceof UniImageInstalledCheckError && error.code === "INSTALLED_UNI_IMAGE_GENERATE_OUTPUT_SCHEMA_INVALID");
});

test("Uni installed checker verifies safe barrel/declaration surface and rejects candidate authority leaks", () => {
  const modules = { parameters, sourceProfile, uploadProfile, upload: uploadServiceModule, generation, tools: toolsModule,
    server: serverModule, runtime: runtimeModule };
  assert.equal(assertUniImagePublicExports(publicApi, modules), true);
  assert.throws(() => assertUniImagePublicExports({ ...publicApi, OwnerUniImagePreparedCandidate: {} }, modules),
    (error) => error.code === "INSTALLED_UNI_IMAGE_PRIVATE_EXPORT_LEAK");
  const safeDeclarations = ["OwnerUniImageModel", "OwnerUniImageMode", "OwnerUniImageParametersInput", "OwnerUniImageInputParameters",
    "OwnerUniImageNormalizedParameters", "OwnerUniImageSourceParameters", "OwnerUniImageSourceProfile", "OwnerUniImageSourceProfileCatalogPort",
    "OwnerUniImageModelId", "OwnerUniImageUploadCatalogPort", "OwnerUniImageUploadProfile", "OwnerUniImageUploadSourceMetadata",
    "OwnerUniImageUploadLocalInputPolicy", "OwnerUniImageUploadServiceOptions", "OwnerUniImageUploadInput", "OwnerUniImageUploadReceipt",
    "OwnerUniImageGenerationServiceOptions", "OwnerUniImageGenerationPreflightInput", "OwnerUniImageGenerationPreflightResult",
    "OwnerUniImageGenerationPreflight", "OwnerUniImageGenerateInput", "OwnerUniImageReconcileInput", "OwnerUniImageRecoveryListInput",
    "OwnerUniImageGenerationPhase", "OwnerUniImageGenerationResultReason", "OwnerUniImageGenerationResult",
    "OwnerUniImageGenerationArtifact", "OwnerUniImageGenerationDiagnostic", "OwnerUniImageRecoveryListItem",
    "OwnerUniImageGenerationServiceErrorCode", "OwnerUniImageServiceComposition", "RegisterSyntxOwnerUniImageToolsOptions",
    "ObservedOwnerRuntimeOptions"].join(" ");
  assert.equal(assertUniImageDeclarations(safeDeclarations), true);
  assert.throws(() => assertUniImageDeclarations(`${safeDeclarations} export type { OwnerUniImageOneShotPermit }`),
    (error) => error.code === "INSTALLED_UNI_IMAGE_PRIVATE_DECLARATION_LEAK");
  const compiledDeclaration = readFileSync(new URL("../dist/src/index.d.ts", import.meta.url), "utf8");
  assert.equal(assertUniImageDeclarations(compiledDeclaration), true);
});
