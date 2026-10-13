#!/usr/bin/env node
import { createHash } from "node:crypto";
import { types } from "node:util";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ModelAccessService } from "../dist/src/application/model-access.js";
import { createOwnerReviewedContractProbePolicy } from "../dist/src/application/owner-contract-probe-policy.js";
import { GenerationContractExecutorV2 } from "../dist/src/adapter/syntx/generation-contract-executor-v2.js";
import { observeOwnedImageArtifact } from "../dist/src/adapter/syntx/owned-image-artifact-observer.js";
import { isSyntxModelInfoCallerParameterKey } from "../dist/src/adapter/syntx/http-client.js";
import { loadGenerationContractRegistryV2 } from "../dist/src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../dist/src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../dist/src/mcp/server.js";
import { registerSyntxOwnerContractProbeTool } from "../dist/src/mcp/owner-contract-probe-tool.js";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";

export const REVIEWED_PROBE_REGISTRY_VERSION = "sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json";
export const REVIEWED_PROBE_OPERATOR_REGISTRY_VERSION = "sha256-650fe8e62c95298d81b8134d3f583b0acfbe55fe147ec2c828d95f941f7236ef.json";
const APPROVED_REVIEWED_PROBE_REGISTRY_VERSIONS = Object.freeze([
  REVIEWED_PROBE_REGISTRY_VERSION,
  REVIEWED_PROBE_OPERATOR_REGISTRY_VERSION
]);
export const REVIEWED_PROBE_TOOL_NAME = "syntx_owner_probe_reviewed_contract";
export const REVIEWED_PROBE_RECONCILE_TOOL_NAME = "syntx_owner_reconcile_reviewed_contract_probe";
const CONFIRM_FLAG = "--confirm-owner-reviewed-contract-probe";
const REAL_FLAG = "--real";
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const SAFE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_LOGIN_POLLS = 48;
const LOGIN_DEADLINE_MS = 180_000;
const LOGIN_POLL_INTERVAL_MS = 2_500;
const UNKNOWN_RECOVERY_WINDOW_MS = 15 * 60_000;
const FINISH_WAIT_MS = 15 * 60_000;
const MAX_SAFE_ERROR = /^[A-Z][A-Z0-9_]{0,79}$/u;
const FIXED_BENIGN_PROMPT = "A simple watercolor paper boat floating on a calm blue pond, centered composition, no text.";
const SAFE_ACTIONS = new Set(["reconcile", "finish"]);
const OPERATOR_PARAMETERS_FLAG = "--operator-parameters-json";
const OWNED_IMAGE_GEOMETRY_FLAG = "--observe-owned-image-geometry";
const IMAGE_FAMILY_CASE_FLAG = "--image-family-case";
const MAX_OPERATOR_PARAMETERS_JSON_BYTES = 4_096;
const MAX_OPERATOR_PARAMETERS_DEPTH = 8;
const MAX_OPERATOR_PARAMETERS_NODES = 128;
const MAX_OPERATOR_PARAMETERS_KEYS = 64;
const MAX_OPERATOR_PARAMETERS_ITEMS = 32;
const IDEOGRAM_LANDSCAPE_REGISTRY_VERSION = "sha256-a4d42d4b977836face88a757a5632cc6096997b37e3749b7a31a80cb24cdfa2e.json";
const IDEOGRAM_LANDSCAPE_PROMPT = "A quiet rolling green landscape at golden hour, distant blue hills beneath a wide open sky, simple watercolor illustration, no text.";
const IDEOGRAM_40_45_REGISTRY_VERSION = "sha256-23ed982e5bae93abec6128ce18568229c38c1569f87efbf036cb25c063b09476.json";
const SEEDREAM_FLASH_REGISTRY_VERSION = "sha256-7243f7184ce583f0841007eb5a9f1b118b7c613e8bbad57d3f35f326d8d75d9d.json";
const FLUX_NO_LORA_REGISTRY_VERSION = "sha256-99a0dbcee376ef2184329762ea26a27519a9457f07e8b7878bffbd7bd77c341d.json";
const OWNED_PARAMETER_KEYS = new Set([
  "prompt", "model_id", "operation_id", "variant_id", "catalog_version", "ai_name", "model_type",
  "schema_hash", "attempt_id", "link_attempt_id", "recovery_id"
]);
const validatedConfigs = new WeakSet();
const IMAGE_FAMILY_CASES = Object.freeze({
  "editorial-cover": Object.freeze({
    aiName: "sora-images", modelId: "gpt-image-1.5", operationId: "generate-image", variantId: "legacy-image-gpt-image-1.5-default",
    schemaHash: "sha256:227410b168b7c4ff2f469d813d594681da15344aafcc400408fa98c7960d601b",
    expectedSettings: Object.freeze({ model_type: "gpt-image-1.5" }), expectedMime: "image/png", requestedRatio: undefined,
    prompt: "Editorial cover for an article about calm focus: a blue-hour landscape with one warm desk lamp and generous negative space. Include the short headline Make Space to Think exactly once; no other text."
  }),
  "square-product-hero": Object.freeze({
    aiName: "grok_image", modelId: "grok_imagine_quality", operationId: "generate-image", variantId: "legacy-image-grok_imagine_quality-default",
    schemaHash: "sha256:eba0e8af0c7e6469706ba32b558b7f1357bab0f414fb9f5d09429d9a035cf07c",
    expectedSettings: Object.freeze({ aspect_ratio: "1:1", batch_size: 1, details_quality: "low", resolution: "1k", model_type: "grok_imagine_quality" }),
    expectedMime: "image/jpeg", requestedRatio: "1:1",
    prompt: "A single matte cobalt-blue ceramic water bottle standing upright on a seamless pale-sand studio background, softly lit, centered square product hero, no text or props."
  }),
  "typographic-card": Object.freeze({
    aiName: "ideogram", modelId: "ideogram", operationId: "generate-image", variantId: "legacy-image-ideogram-default",
    schemaHash: "sha256:32ef5459659b31d78c9faf6191313be83ceb5c73135bf7e06ee145dc3cbb455e",
    expectedSettings: Object.freeze({
      aspect_ratio: "1:1", color_palette_mode: "preset", detail: 90, image_weight: 50, magic_prompt: "AUTO", mode: "generate",
      negative_prompt: "", num_images: 1, rendering_speed: "TURBO", resemblance: 55, resolution: "", seed: null,
      style_preset: "", style_type: "GENERAL", model_type: "ideogram"
    }), expectedMime: "image/png", requestedRatio: "1:1",
    prompt: "A simple typographic card with the exact single word FOCUS centered in large clear letters on a warm ivory background; no other text or marks."
  }),
  "ideogram-landscape": Object.freeze({
    registryVersion: IDEOGRAM_LANDSCAPE_REGISTRY_VERSION,
    aiName: "ideogram", modelId: "ideogram", operationId: "generate-image",
    variantId: "ideogram-image-generate-aspect-ratio-source-reviewed",
    schemaHash: "sha256:31e1603ba0668f57860b1d688b7c74bd3b8c54da117180a779f67f4a6363320c",
    expectedSettings: Object.freeze({ aspect_ratio: "16:9", color_palette_mode: "preset", detail: 90, image_weight: 50,
      magic_prompt: "AUTO", mode: "generate", negative_prompt: "", num_images: 1, rendering_speed: "TURBO",
      resemblance: 55, resolution: "", seed: null, style_preset: "", style_type: "GENERAL", model_type: "ideogram" }),
    expectedMime: "image/png", requestedRatio: "16:9", fixedParameters: Object.freeze({ aspect_ratio: "16:9" }),
    prompt: IDEOGRAM_LANDSCAPE_PROMPT
  }),
  "ideogram-40-source-square": Object.freeze({
    registryVersion: IDEOGRAM_40_45_REGISTRY_VERSION, aiName: "ideogram", modelId: "ideogram_40",
    operationId: "generate-image", variantId: "ideogram-40-generate-source-reviewed",
    schemaHash: "sha256:746078931628029688e1685751e41b4837daa6d9071fc4dc342efd242510987a",
    expectedSettings: Object.freeze({ aspect_ratio: "1:1", file_urls: Object.freeze([]), magic_prompt: "AUTO",
      model_type: "ideogram_40", num_images: 1, rendering_speed: "TURBO", resolution: "1K", seed: null }),
    expectedMime: "image/png", requestedRatio: "1:1",
    fixedParameters: Object.freeze({ aspect_ratio: "1:1", resolution: "1K", rendering_speed: "TURBO", magic_prompt: "AUTO" }),
    prompt: "A handmade orange ceramic cup on a pale limestone table, soft morning window light, quiet square still life, no text."
  }),
  "ideogram-45-source-square": Object.freeze({
    registryVersion: IDEOGRAM_40_45_REGISTRY_VERSION, aiName: "ideogram", modelId: "ideogram_45",
    operationId: "generate-image", variantId: "ideogram-45-generate-source-reviewed",
    schemaHash: "sha256:b0bba92b9482519db0290246d942f2555b628ed0a1ba9a7bdfbadd36ec636b05",
    expectedSettings: Object.freeze({ aspect_ratio: "1:1", file_urls: Object.freeze([]), magic_prompt: "AUTO",
      model_type: "ideogram_45", num_images: 1, rendering_speed: "TURBO", resolution: "1K", seed: null }),
    expectedMime: "image/png", requestedRatio: "1:1",
    fixedParameters: Object.freeze({ aspect_ratio: "1:1", resolution: "1K", rendering_speed: "TURBO", magic_prompt: "AUTO" }),
    prompt: "A folded deep-blue linen cloth on a warm ivory bench, gentle side light and visible woven texture, quiet square still life, no text."
  }),
  "seedream-flash-source-jpeg-square": Object.freeze({
    registryVersion: SEEDREAM_FLASH_REGISTRY_VERSION, aiName: "seedream", modelId: "seedream-5.0-flash",
    operationId: "generate-image", variantId: "seedream-5-0-flash-generate-source-reviewed",
    schemaHash: "sha256:a2aaf9647b6213111fec3e5f8c4f7370e4b8619969fe76b68678e1713d20c921",
    expectedSettings: Object.freeze({ aspect_ratio: "1:1", background: "opaque", file_urls: Object.freeze([]),
      model_type: "seedream-5.0-flash", n: 1, output_format: "jpeg", resolution: "1K", stream: false }),
    expectedMime: "image/jpeg", allowedOutputMimes: Object.freeze(["image/jpeg", "image/png"]), requestedRatio: "1:1",
    fixedParameters: Object.freeze({ aspect_ratio: "1:1", resolution: "1K", output_format: "jpeg" }),
    prompt: "A weathered brass compass on pale stone beside a sprig of rosemary, soft cool daylight, minimal square still life, no words or lettering."
  }),
  "flux-pro-no-lora-landscape": Object.freeze({
    registryVersion: FLUX_NO_LORA_REGISTRY_VERSION, aiName: "flux", modelId: "flux-pro-1.1",
    operationId: "generate-image", variantId: "flux-pro-1-1-explicit-no-lora-reviewed",
    schemaHash: "sha256:6cf96aad7eac9c1430bcda1b0907c1ed0b7b3965bfe1cb1c7ad6937251b98935",
    expectedSettings: Object.freeze({ civitai_loras: Object.freeze([]), file_urls: Object.freeze([]), n: 1,
      cfg: 3.5, image_strength: 0.5, steps: 28, workflow_type: "default", resolution: "1152x896", model_type: "flux-pro-1.1" }),
    allowedOutputMimes: Object.freeze(["image/jpeg", "image/png"]), requestedRatio: undefined, requestedResolution: "1152x896",
    fixedParameters: Object.freeze({ resolution: "1152x896", cfg: 3.5, steps: 28, image_strength: 0.5, workflow_type: "default" }),
    prompt: "An amber glass vase holding one white anemone on a rough slate ledge, soft overcast daylight and generous negative space, no text."
  }),
  "flux-pro-ultra-no-lora-square": Object.freeze({
    registryVersion: FLUX_NO_LORA_REGISTRY_VERSION, aiName: "flux", modelId: "flux-pro-1.1-ultra",
    operationId: "generate-image", variantId: "flux-pro-1-1-ultra-explicit-no-lora-reviewed",
    schemaHash: "sha256:1f08f74c6110fa9a087a54c1249b52ba719bb9e9f0d51520bf5308ef76d12fbf",
    expectedSettings: Object.freeze({ civitai_loras: Object.freeze([]), file_urls: Object.freeze([]), n: 1, raw: false,
      cfg: 3.5, image_strength: 0.5, steps: 28, workflow_type: "default", resolution: "2048x2048", model_type: "flux-pro-1.1-ultra" }),
    allowedOutputMimes: Object.freeze(["image/jpeg", "image/png"]), requestedRatio: undefined, requestedResolution: "2048x2048",
    fixedParameters: Object.freeze({ resolution: "2048x2048", cfg: 3.5, steps: 28, image_strength: 0.5, workflow_type: "default" }),
    prompt: "A quiet stack of indigo ceramic bowls on a pale travertine pedestal, long soft shadows, minimal studio image, no text."
  })
});

export function parseOwnerReviewedContractProbeArgs(argv) {
  if (!Array.isArray(argv)) return null;
  const observeOwnedImageGeometry = argv.at(-1) === OWNED_IMAGE_GEOMETRY_FLAG;
  const args = observeOwnedImageGeometry ? argv.slice(0, -1) : argv;
  if ((args.length !== 10 && args.length !== 12) || args[0] !== CONFIRM_FLAG || args[1] !== REAL_FLAG ||
      args[2] !== "--registry-version" || args[4] !== "--model-id" || args[6] !== "--operation-id" || args[8] !== "--variant-id" ||
      (!APPROVED_REVIEWED_PROBE_REGISTRY_VERSIONS.includes(args[3]) &&
        !(args.length === 12 && args[10] === IMAGE_FAMILY_CASE_FLAG && typeof args[11] === "string" &&
          Object.hasOwn(IMAGE_FAMILY_CASES, args[11]) &&
          args[3] === (IMAGE_FAMILY_CASES[args[11]].registryVersion ?? REVIEWED_PROBE_OPERATOR_REGISTRY_VERSION))) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(args[5] ?? "") ||
      !["generate-image", "generate-video"].includes(args[7]) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(args[9] ?? "") ||
      (args.length === 12 && args[10] === OPERATOR_PARAMETERS_FLAG && (typeof args[11] !== "string" ||
        Buffer.byteLength(args[11], "utf8") > MAX_OPERATOR_PARAMETERS_JSON_BYTES)) ||
      (args.length === 12 && args[10] === IMAGE_FAMILY_CASE_FLAG && typeof args[11] !== "string") ||
      (args.length === 12 && args[10] !== OPERATOR_PARAMETERS_FLAG && args[10] !== IMAGE_FAMILY_CASE_FLAG)) return null;
  const imageFamilyCaseId = args.length === 12 && args[10] === IMAGE_FAMILY_CASE_FLAG ? args[11] : undefined;
  const imageFamilyCase = imageFamilyCaseId === undefined || !Object.hasOwn(IMAGE_FAMILY_CASES, imageFamilyCaseId)
    ? undefined : IMAGE_FAMILY_CASES[imageFamilyCaseId];
  if (imageFamilyCaseId !== undefined && (imageFamilyCase === undefined ||
      args[3] !== (imageFamilyCase.registryVersion ?? REVIEWED_PROBE_OPERATOR_REGISTRY_VERSION) ||
      args[5] !== imageFamilyCase.modelId || args[7] !== imageFamilyCase.operationId || args[9] !== imageFamilyCase.variantId || observeOwnedImageGeometry)) return null;
  const config = Object.freeze({
    registryVersion: args[3], modelId: args[5], operationId: args[7], variantId: args[9],
    ...(args.length === 12 && args[10] === OPERATOR_PARAMETERS_FLAG ? { operatorParametersJson: args[11] } : {}),
    ...(imageFamilyCaseId !== undefined ? { imageFamilyCaseId } : {}),
    ...(observeOwnedImageGeometry ? { observeOwnedImageGeometry: true } : {})
  });
  validatedConfigs.add(config);
  return config;
}

export class OperatorParametersError extends Error {
  constructor(code) { super("Operator parameters are invalid for the selected reviewed contract."); this.name = "OperatorParametersError"; this.code = code; }
}

export function parseOperatorParametersJson(jsonText, contract, fixedParameters = Object.create(null)) {
  let value;
  if (jsonText === undefined) value = Object.create(null);
  else {
    if (typeof jsonText !== "string") throw new OperatorParametersError("INVALID_JSON");
    if (Buffer.byteLength(jsonText, "utf8") > MAX_OPERATOR_PARAMETERS_JSON_BYTES) throw new OperatorParametersError("JSON_TOO_LARGE");
    value = parseStrictJsonObject(jsonText);
  }
  return validateOperatorParametersObject(value, contract, fixedParameters);
}

export function validateOperatorParametersObject(value, contract, fixedParameters = Object.create(null)) {
  if (!isPlainDataObject(value)) throw new OperatorParametersError("PLAIN_DATA_OBJECT_REQUIRED");
  const schema = contract?.parameters;
  if (!isPlainRecord(schema) || schema.type !== "object" || schema.additional_properties !== false || !isPlainRecord(schema.properties) ||
      !Array.isArray(schema.required)) throw new OperatorParametersError("CONTRACT_PARAMETER_SCHEMA_INVALID");
  const allowed = new Map(Object.entries(schema.properties).filter(([key]) => !OWNED_PARAMETER_KEYS.has(key)));
  const selected = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new OperatorParametersError("PARAMETER_KEY_INVALID");
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new OperatorParametersError("PROTOTYPE_KEY_FORBIDDEN");
    if (OWNED_PARAMETER_KEYS.has(key)) throw new OperatorParametersError("OWNED_PARAMETER_FORBIDDEN");
    const property = allowed.get(key);
    if (property === undefined) throw new OperatorParametersError("UNKNOWN_PARAMETER");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) {
      throw new OperatorParametersError("ACCESSOR_NOT_ALLOWED");
    }
    if (/(?:url|uri|reference|ref|file|media)/iu.test(key)) throw new OperatorParametersError("REFERENCE_PARAMETER_FORBIDDEN");
    validateOperatorParameterValue(key, descriptor.value, property);
    Object.defineProperty(selected, key, { value: descriptor.value, enumerable: true, configurable: false, writable: false });
  }
  for (const key of schema.required) {
    if (key === "prompt" || OWNED_PARAMETER_KEYS.has(key) || Object.hasOwn(fixedParameters, key)) continue;
    if (!Object.hasOwn(selected, key)) throw new OperatorParametersError("REQUIRED_PARAMETER_MISSING");
  }
  return Object.freeze(selected);
}

function validateOperatorParameterValue(key, value, schema) {
  if (!isPlainRecord(schema) || !["string", "number", "integer", "boolean"].includes(schema.type)) {
    throw new OperatorParametersError("SCALAR_PARAMETER_REQUIRED");
  }
  if (value === null) {
    if (schema.nullable !== true) throw new OperatorParametersError("PARAMETER_TYPE_INVALID");
  } else if (schema.type === "string") {
    if (typeof value !== "string") throw new OperatorParametersError("PARAMETER_TYPE_INVALID");
    if (/[\u0000-\u001f\u007f]/u.test(value) || /(?:https?:\/\/|ftp:\/\/|www\.|data:|tg:\/\/|file:\/\/|(?:^|\s)(?:ref|reference|url|uri)[:=])/iu.test(value)) {
      throw new OperatorParametersError("REFERENCE_VALUE_FORBIDDEN");
    }
    if ((schema.min_length !== undefined && value.length < schema.min_length) ||
        (schema.max_length !== undefined && value.length > schema.max_length)) throw new OperatorParametersError("PARAMETER_VALUE_OUT_OF_RANGE");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value)) ||
        (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) {
      throw new OperatorParametersError("PARAMETER_VALUE_OUT_OF_RANGE");
    }
  } else if (typeof value !== "boolean") throw new OperatorParametersError("PARAMETER_TYPE_INVALID");
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new OperatorParametersError("PARAMETER_ENUM_INVALID");
  }
}

function parseStrictJsonObject(text) {
  let index = 0;
  let nodeCount = 0;
  const fail = (code) => { throw new OperatorParametersError(code); };
  const skipWhitespace = () => { while (index < text.length && /[\u0020\u0009\u000a\u000d]/u.test(text[index])) index += 1; };
  const parseString = () => {
    if (text[index] !== "\"") fail("INVALID_JSON");
    const start = index++;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") { index += 2; continue; }
      if (char === "\"") {
        index += 1;
        try { return JSON.parse(text.slice(start, index)); } catch { fail("INVALID_JSON"); }
      }
      if (char.charCodeAt(0) < 0x20) fail("INVALID_JSON");
      index += 1;
    }
    return fail("INVALID_JSON");
  };
  const parseValue = (depth) => {
    skipWhitespace();
    nodeCount += 1;
    if (nodeCount > MAX_OPERATOR_PARAMETERS_NODES) fail("JSON_NODE_LIMIT");
    if (depth > MAX_OPERATOR_PARAMETERS_DEPTH) fail("JSON_TOO_DEEP");
    const char = text[index];
    if (char === "\"") return parseString();
    if (char === "{") {
      index += 1;
      skipWhitespace();
      const object = Object.create(null);
      const keys = new Set();
      if (text[index] === "}") { index += 1; return object; }
      while (index < text.length) {
        skipWhitespace();
        const key = parseString();
        if (["__proto__", "prototype", "constructor"].includes(key)) fail("PROTOTYPE_KEY_FORBIDDEN");
        if (keys.has(key)) fail("JSON_DUPLICATE_KEY");
        if (keys.size >= MAX_OPERATOR_PARAMETERS_KEYS) fail("JSON_OBJECT_KEY_LIMIT");
        keys.add(key);
        skipWhitespace();
        if (text[index++] !== ":") fail("INVALID_JSON");
        const child = parseValue(depth + 1);
        Object.defineProperty(object, key, { value: child, enumerable: true, configurable: false, writable: false });
        skipWhitespace();
        if (text[index] === "}") { index += 1; return object; }
        if (text[index++] !== ",") fail("INVALID_JSON");
      }
      return fail("INVALID_JSON");
    }
    if (char === "[") {
      index += 1;
      skipWhitespace();
      const array = [];
      if (text[index] === "]") { index += 1; return array; }
      while (index < text.length) {
        if (array.length >= MAX_OPERATOR_PARAMETERS_ITEMS) fail("JSON_ARRAY_ITEM_LIMIT");
        array.push(parseValue(depth + 1));
        skipWhitespace();
        if (text[index] === "]") { index += 1; return array; }
        if (text[index++] !== ",") fail("INVALID_JSON");
      }
      return fail("INVALID_JSON");
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(literal, index)) { index += literal.length; return value; }
    }
    const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(text);
    if (match !== null) {
      index = numberPattern.lastIndex;
      const number = Number(match[0]);
      if (!Number.isFinite(number)) fail("JSON_NUMBER_INVALID");
      return number;
    }
    return fail("INVALID_JSON");
  };
  skipWhitespace();
  const root = parseValue(0);
  skipWhitespace();
  if (index !== text.length) fail("INVALID_JSON");
  if (!isPlainDataObject(root)) fail("JSON_ROOT_OBJECT_REQUIRED");
  return root;
}

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && (() => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value");
  })());
}

/** Filters exact fixed tuple scalars through the current model-info allowlist. */
export function filterReviewedProbeCostParameters(fixedSettings, getCostParams) {
  if (!isPlainRecord(fixedSettings) || !Array.isArray(getCostParams)) return Object.freeze({});
  const allowed = new Set(getCostParams.filter((key) => typeof key === "string" && isSyntxModelInfoCallerParameterKey(key)));
  const output = {};
  for (const [key, value] of Object.entries(fixedSettings)) {
    if (allowed.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
        (typeof value !== "number" || Number.isFinite(value))) output[key] = value;
  }
  return Object.freeze(output);
}

export function summarizeReviewedProbeResult(result, binding) {
  const output = result?.structuredContent;
  if (result?.isError === true || output?.status !== "reviewed" || output?.confidence_scope !== "exact_result_only" ||
      output?.model_id !== binding.model_id || output?.operation_id !== binding.operation_id || output?.variant_id !== binding.variant_id ||
      !Array.isArray(output?.artifacts) || output.artifacts.length === 0 ||
      output.artifacts.some((artifact) => typeof artifact?.mime_type !== "string" || !binding.mime_types.includes(artifact.mime_type))) return null;
  if (binding.image_family_case_id !== undefined && (output.artifacts.length !== 1 ||
      (binding.expected_image_mime !== undefined
        ? output.artifacts[0]?.mime_type !== binding.expected_image_mime
        : !Array.isArray(binding.allowed_image_mimes) || !binding.allowed_image_mimes.includes(output.artifacts[0]?.mime_type)))) return null;
  const artifacts = output.artifacts;
  const safeArtifacts = artifacts.map((artifact) => ({
    mime_type: typeof artifact?.mime_type === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(artifact.mime_type) ? artifact.mime_type : "application/octet-stream",
    ...(Number.isSafeInteger(artifact?.byte_size) && artifact.byte_size >= 0 ? { byte_size: artifact.byte_size } : {}),
    ...(Number.isSafeInteger(artifact?.width) && artifact.width > 0 ? { width: artifact.width } : {}),
    ...(Number.isSafeInteger(artifact?.height) && artifact.height > 0 ? { height: artifact.height } : {}),
    ...(Number.isFinite(artifact?.duration_seconds) && artifact.duration_seconds >= 0 ? { duration_seconds: artifact.duration_seconds } : {})
  }));
  const bytes = Buffer.from(canonicalJson(safeArtifacts), "utf8");
  return Object.freeze({
    status: "PASS_EXACT_RESULT_ONLY",
    contract_status: "reviewed",
    confidence_scope: "exact_result_only",
    model_id: binding.model_id,
    operation_id: binding.operation_id,
    variant_id: binding.variant_id,
    registry_version: binding.registry_version,
    schema_hash: binding.schema_hash,
    operator_parameter_keys: binding.operator_parameter_keys,
    normalized_request_fingerprint: binding.normalized_request_fingerprint,
    artifact_count: safeArtifacts.length,
    mime_types: Object.freeze([...new Set(safeArtifacts.map((artifact) => artifact.mime_type))].sort()),
    safe_artifact_summary_sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
  });
}

function isOwnedImageGeometrySelection(config, settings) {
  return config.registryVersion === REVIEWED_PROBE_OPERATOR_REGISTRY_VERSION && config.modelId === "banana-2.1" &&
    config.operationId === "generate-image" && config.variantId === "banana-ui-reviewed-banana-2.1" &&
    settings?.model_type === "banana-2.1" && settings?.aspect_ratio === "16:9" && settings?.image_size === "1K" &&
    settings?.thinking_level === "minimal" && settings?.n === 1 && Array.isArray(settings?.file_urls) && settings.file_urls.length === 0;
}

function redactGeometryObservation(value, requestedRatio, requestedResolution) {
  const requestedResolutionMetadata = typeof requestedResolution === "string" ? { requested_resolution: requestedResolution } : {};
  if (!isPlainRecord(value)) return { status: "UNKNOWN", reason: "OBSERVER_FAILED", ...requestedResolutionMetadata };
  if (value.status === "UNKNOWN") {
    return { status: "UNKNOWN", reason: typeof value.reason === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.reason) ? value.reason : "OBSERVER_FAILED",
      ...requestedResolutionMetadata };
  }
  if (value.status !== "OBSERVED" || !["image/jpeg", "image/png"].includes(value.mime) ||
      !Number.isSafeInteger(value.width) || value.width <= 0 || !Number.isSafeInteger(value.height) || value.height <= 0 ||
      !Number.isSafeInteger(value.byte_size) || value.byte_size <= 0 || typeof value.sha256 !== "string" || !SAFE_HASH_PATTERN.test(value.sha256)) {
    return { status: "UNKNOWN", reason: "OBSERVER_OUTPUT_INVALID", ...requestedResolutionMetadata };
  }
  if (requestedRatio === undefined) {
    if (value.ratio_status !== "NOT_REQUESTED" || Object.hasOwn(value, "requested_ratio") || Object.hasOwn(value, "ratio_match")) {
      return { status: "UNKNOWN", reason: "OBSERVER_OUTPUT_INVALID", ...requestedResolutionMetadata };
    }
  } else if (value.requested_ratio !== requestedRatio || typeof value.ratio_match !== "boolean") {
    return { status: "UNKNOWN", reason: "OBSERVER_OUTPUT_INVALID", ...requestedResolutionMetadata };
  }
  const sdk = isPlainRecord(value.sdk_metadata) ? value.sdk_metadata : Object.create(null);
  const isSafeMime = (mime) => typeof mime === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mime);
  return {
    status: "OBSERVED",
    ...requestedResolutionMetadata,
    mime: value.mime,
    ...(isSafeMime(value.declared_mime) ? { declared_mime: value.declared_mime } : {}),
    ...(isSafeMime(value.response_mime_type) || value.response_mime_type === null ? { response_mime_type: value.response_mime_type } : {}),
    byte_size: value.byte_size,
    width: value.width,
    height: value.height,
    sha256: value.sha256,
    ...(requestedRatio === undefined ? { ratio_status: "NOT_REQUESTED" } : {
      requested_ratio: value.requested_ratio,
      ratio_match: value.ratio_match
    }),
    sdk_metadata: {
      ...(isSafeMime(sdk.mime_type) ? { mime_type: sdk.mime_type } : {}),
      ...(Number.isSafeInteger(sdk.byte_size) && sdk.byte_size >= 0 ? { byte_size: sdk.byte_size } : {}),
      ...(Number.isSafeInteger(sdk.width) && sdk.width > 0 ? { width: sdk.width } : {}),
      ...(Number.isSafeInteger(sdk.height) && sdk.height > 0 ? { height: sdk.height } : {})
    }
  };
}

/** Exact one-shot owner workflow. Every injectable seam is intended for local tests only. */
export async function runOwnerReviewedContractProbe(config, io = process, dependencies = {}) {
  if (config === null || typeof config !== "object" || !validatedConfigs.has(config)) {
    return safeSummary(config, "CLI_CONFIRMATION_REQUIRED");
  }
  const explicitPrivateIpc = dependencies.sendPrivateIpc ?? io.sendPrivateIpc;
  if (typeof explicitPrivateIpc !== "function" && !(io === process && typeof process.send === "function")) {
    return safeSummary(config, "PRIVATE_IPC_REQUIRED");
  }
  const sendPrivate = explicitPrivateIpc ?? defaultSendPrivateIpc;
  const emitPrivate = async (message, timeoutMs) => { try { return await sendPrivate(message, timeoutMs); } catch { return false; } };
  const waitForHandoffAck = dependencies.waitForHandoffAck ?? io.waitForHandoffAck ?? defaultWaitForHandoffAck;
  const waitForParentAction = dependencies.waitForParentAction ?? io.waitForParentAction ?? defaultWaitForParentAction;
  const observeGeometry = async (verifiedResult) => {
    if (config.observeOwnedImageGeometry !== true && config.imageFamilyCaseId === undefined) return undefined;
    const imageFamilyCase = config.imageFamilyCaseId === undefined ? undefined : IMAGE_FAMILY_CASES[config.imageFamilyCaseId];
    const requestedRatio = imageFamilyCase === undefined ? "16:9" : imageFamilyCase.requestedRatio;
    const observer = dependencies.observeOwnedImageArtifact ?? observeOwnedImageArtifact;
    try {
      return redactGeometryObservation(await observer({
        artifacts: verifiedResult.structuredContent.artifacts,
        ...(requestedRatio === undefined ? {} : { requestedRatio })
    }), requestedRatio, imageFamilyCase?.requestedResolution);
    } catch {
      return { status: "UNKNOWN", reason: "OBSERVER_FAILED",
        ...(typeof imageFamilyCase?.requestedResolution === "string" ? { requested_resolution: imageFamilyCase.requestedResolution } : {}) };
    }
  };
  if (typeof sendPrivate !== "function") return safeSummary(config, "PRIVATE_IPC_REQUIRED");

  let selection;
  try { selection = (dependencies.loadSelection ?? loadReviewedSelection)(config); }
  catch { return safeSummary(config, "REVIEWED_TUPLE_UNAVAILABLE"); }
  let operatorParameters;
  let parameters;
  try {
    const imageFamilyCase = config.imageFamilyCaseId === undefined ? undefined : IMAGE_FAMILY_CASES[config.imageFamilyCaseId];
    operatorParameters = parseOperatorParametersJson(config.operatorParametersJson, selection.contract, imageFamilyCase?.fixedParameters);
    parameters = Object.freeze({ prompt: imageFamilyCase?.prompt ?? FIXED_BENIGN_PROMPT,
      ...(imageFamilyCase?.fixedParameters ?? {}), ...operatorParameters });
    const executor = new GenerationContractExecutorV2(selection.registry, selection.catalog);
    const prepared = executor.prepare({
      model_id: config.modelId,
      operation_id: config.operationId,
      catalog_version: selection.registry.catalog_version,
      variant_id: config.variantId,
      parameters
    });
    const operatorParameterKeys = Object.freeze(Object.keys(operatorParameters).sort());
    const normalizedRequestFingerprint = `sha256:${createHash("sha256").update(canonicalJson({
      registry_version: config.registryVersion,
      model_id: config.modelId,
      operation_id: config.operationId,
      variant_id: config.variantId,
      schema_hash: selection.binding.schema_hash,
      operator_parameter_keys: operatorParameterKeys,
      normalized_settings: prepared.settings,
      ...(imageFamilyCase === undefined ? {} : {
        image_family_case_id: config.imageFamilyCaseId,
        fixed_prompt_sha256: `sha256:${createHash("sha256").update(imageFamilyCase.prompt, "utf8").digest("hex")}`
      })
    })).digest("hex")}`;
    selection = { ...selection, prepared, binding: Object.freeze({ ...selection.binding,
      operator_parameter_keys: operatorParameterKeys, normalized_request_fingerprint: normalizedRequestFingerprint,
      ...(imageFamilyCase === undefined ? {} : {
        image_family_case_id: config.imageFamilyCaseId,
        ...(imageFamilyCase.expectedMime === undefined ? {} : { expected_image_mime: imageFamilyCase.expectedMime }),
        ...(imageFamilyCase.allowedOutputMimes === undefined ? {} : { allowed_image_mimes: imageFamilyCase.allowedOutputMimes })
      }) }) };
    const expectedOutputMimes = imageFamilyCase?.allowedOutputMimes;
    const outputMimeBindingMatches = imageFamilyCase === undefined ? true : expectedOutputMimes === undefined
      ? selection.contract.output.mime_types.length === 1 && selection.contract.output.mime_types[0] === imageFamilyCase.expectedMime
      : expectedOutputMimes.length === selection.contract.output.mime_types.length &&
        expectedOutputMimes.every((mime) => selection.contract.output.mime_types.includes(mime)) &&
        (imageFamilyCase.expectedMime === undefined || expectedOutputMimes.includes(imageFamilyCase.expectedMime));
    if (config.imageFamilyCaseId !== undefined && (imageFamilyCase === undefined ||
        selection.binding.schema_hash !== imageFamilyCase.schemaHash ||
        selection.contract.ai_name !== imageFamilyCase.aiName ||
        selection.contract.status !== "reviewed" ||
        !outputMimeBindingMatches ||
        canonicalJson(prepared.settings) !== canonicalJson(imageFamilyCase.expectedSettings))) {
      return safeSummary(config, "IMAGE_FAMILY_CASE_BINDING_UNAVAILABLE", selection.binding);
    }
    if (config.observeOwnedImageGeometry === true && !isOwnedImageGeometrySelection(config, prepared.settings)) {
      return safeSummary(config, "GEOMETRY_OBSERVATION_TUPLE_UNAVAILABLE", selection.binding);
    }
    if (typeof dependencies.onPreparedRequest === "function") dependencies.onPreparedRequest(prepared, selection.binding);
  } catch (error) {
    const code = error instanceof OperatorParametersError ? "OPERATOR_PARAMETERS_INVALID" : "FIXED_REQUEST_PREPARATION_FAILED";
    return safeSummary(config, code, selection.binding);
  }

  let runtime;
  let server;
  let client;
  let attemptId = null;
  let recoveryId = null;
  let linked = false;
  let probeCallCount = 0;
  let summary = safeSummary(config, "NOT_STARTED", selection.binding);
  let finalActionPromise = null;
  const createRuntime = dependencies.createRuntime ?? createObservedOwnerRuntime;
  const openSession = dependencies.openSession ?? openInMemorySession;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? delay;
  const stopBeforeProbe = async (code, waitForOwnerFinish = true) => {
    summary = safeSummary(config, code, selection.binding);
    if (!ATTEMPT_PATTERN.test(attemptId ?? "") || client === undefined) return summary;
    const actionPromise = waitForOwnerFinish ? waitForParentAction(FINISH_WAIT_MS) : null;
    await emitPrivate({ event: "STOPPED", ...summary });
    if (!waitForOwnerFinish) return await finishLinkedSession(client, attemptId, summary, selection.binding);
    const action = await actionPromise;
    if (action?.action === "finish") return await finishLinkedSession(client, attemptId, summary, selection.binding);
    return { ...summary, status: "PRE_PROBE_CLEANUP_UNKNOWN", local_unlink_status: "NOT_CONFIRMED" };
  };

  try {
    runtime = createRuntime({
      accountStatusEnabled: true,
      ownerContractMediaEnabled: true,
      generationContractRegistry: selection.registry,
      requestTimeoutMs: 30_000
    });
    const ownerMedia = runtime.serverOptions.ownerContractMedia;
    if (ownerMedia === undefined || ownerMedia.service === undefined) throw new Error("OWNER_PROBE_SERVICE_UNAVAILABLE");
    const safeServerOptions = { ...runtime.serverOptions };
    delete safeServerOptions.ownerContractMedia;
    ({ server, client } = await openSession(runtime, safeServerOptions, dependencies));

    const initialTools = await client.listTools({}, { timeout: 5_000, maxTotalTimeout: 5_000 });
    const initialNames = new Set((initialTools.tools ?? []).map((tool) => tool.name));
    for (const required of ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status", "syntx_get_generation_schema", "syntx_validate_generation"]) {
      if (!initialNames.has(required)) throw new Error("REQUIRED_MCP_TOOL_MISSING");
    }
    if (initialNames.has(REVIEWED_PROBE_TOOL_NAME) || initialNames.has("syntx_owner_generate_media")) throw new Error("PROBE_SURFACE_NOT_ISOLATED");

    const schema = await client.callTool({ name: "syntx_get_generation_schema", arguments: {
      model_id: config.modelId, operation_id: config.operationId, variant_id: config.variantId
    } }, undefined, { timeout: 5_000, maxTotalTimeout: 5_000 });
    if (schema.isError === true || schema.structuredContent?.schema_status !== "reviewed" ||
        schema.structuredContent?.variant_id !== config.variantId || schema.structuredContent?.model_id !== config.modelId ||
        schema.structuredContent?.schema_hash !== selection.binding.schema_hash) throw new Error("SCHEMA_BINDING_MISMATCH");
    const validation = await client.callTool({ name: "syntx_validate_generation", arguments: {
      model_id: config.modelId, operation_id: config.operationId, variant_id: config.variantId, parameters
    } }, undefined, { timeout: 5_000, maxTotalTimeout: 5_000 });
    if (validation.isError === true || validation.structuredContent?.validation_status !== "VALID" ||
        validation.structuredContent?.schema_hash !== selection.binding.schema_hash ||
        validation.structuredContent?.variant_id !== config.variantId) throw new Error("FIXED_REQUEST_VALIDATION_FAILED");

    const begun = await client.callTool({ name: "syntx_begin_login", arguments: {} }, undefined, { timeout: 12_000, maxTotalTimeout: 12_000 });
    attemptId = begun?.structuredContent?.attempt_id;
    const handoff = begun?.content?.find((item) => item.type === "resource_link");
    if (begun?.isError === true || !ATTEMPT_PATTERN.test(attemptId ?? "") || handoff?.type !== "resource_link" ||
        typeof handoff.uri !== "string" || !isSafeHandoffUri(handoff.uri)) {
      return await stopBeforeProbe("AUTH_HANDOFF_UNAVAILABLE");
    }
    const policy = (dependencies.createPolicy ?? createOwnerReviewedContractProbePolicy)({
      registryVersion: config.registryVersion,
      attemptId,
      modelId: config.modelId,
      operationId: config.operationId,
      variantId: config.variantId,
      schemaHash: selection.binding.schema_hash,
      parameters
    });
    const costParameters = filterReviewedProbeCostParameters(selection.prepared.settings, selection.model.settings?.get_cost_params ?? []);
    const resolveModelAccess = async (boundAttemptId, modelId, signal) => {
      if (boundAttemptId !== attemptId || modelId !== config.modelId) throw new Error("PROBE_MODEL_ACCESS_BINDING_MISMATCH");
      const access = new ModelAccessService(selection.catalog, runtime.createReadClient(boundAttemptId))
        .getModelAccess({ model_id: modelId, cost_parameters: costParameters }, signal);
      return access;
    };
    (dependencies.registerProbeTool ?? registerSyntxOwnerContractProbeTool)(server, {
      policy,
      service: ownerMedia.service,
      resolveSubscription: (boundAttemptId, signal) => runtime.createReadClient(boundAttemptId).getSubscription(signal),
      resolveModelAccess,
      resolveChatClient: (boundAttemptId) => runtime.createChatClient(boundAttemptId)
    });

    const beginMessage = { event: "BEGIN", attempt_id: attemptId, handoff_uri: handoff.uri };
    const ackController = new AbortController();
    const ackPromise = waitForHandoffAck(45_000, ackController.signal);
    if (!await emitPrivate(beginMessage, 45_000)) {
      ackController.abort();
      return await stopBeforeProbe("HANDOFF_IPC_UNKNOWN", false);
    }
    if (!await ackPromise) {
      return await stopBeforeProbe("HANDOFF_NOT_CONFIRMED", false);
    }

    const loginDeadline = now() + LOGIN_DEADLINE_MS;
    let linkedResult = null;
    let status = "HANDOFF_ISSUED";
    for (let poll = 0; poll < MAX_LOGIN_POLLS && now() < loginDeadline; poll += 1) {
      const checked = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } }, undefined,
        { timeout: 12_000, maxTotalTimeout: 12_000 });
      const value = checked?.structuredContent;
      if (checked?.isError === true || value?.attempt_id !== attemptId) {
        return await stopBeforeProbe("AUTH_STATUS_UNKNOWN");
      }
      status = value.status;
      if (status === "LINKED" && value.linked === true) { linkedResult = value; linked = true; break; }
      if (status !== "HANDOFF_ISSUED" && status !== "POLLING") {
        return await stopBeforeProbe(isUnknownStatus(status) ? "AUTH_OUTCOME_UNKNOWN" : "AUTH_NOT_LINKED");
      }
      await sleep(Math.min(LOGIN_POLL_INTERVAL_MS, Math.max(0, loginDeadline - now())));
    }
    if (!linked || linkedResult === null) {
      return await stopBeforeProbe("AUTH_OUTCOME_UNKNOWN");
    }

    const account = await client.callTool({ name: "syntx_get_account_status", arguments: { link_attempt_id: attemptId } }, undefined,
      { timeout: 15_000, maxTotalTimeout: 15_000 });
    if (account?.isError === true || account?.structuredContent?.subscription?.active !== true) {
      return await stopBeforeProbe("SUBSCRIPTION_REQUIRED_OR_UNVERIFIED");
    }

    const afterRegistration = await client.listTools({}, { timeout: 5_000, maxTotalTimeout: 5_000 });
    const toolNames = new Set((afterRegistration.tools ?? []).map((tool) => tool.name));
    if (!toolNames.has(REVIEWED_PROBE_TOOL_NAME) || !toolNames.has(REVIEWED_PROBE_RECONCILE_TOOL_NAME)) throw new Error("PROBE_TOOL_REGISTRATION_FAILED");

    probeCallCount = 1;
    let probeResult;
    try {
      probeResult = await client.callTool({ name: REVIEWED_PROBE_TOOL_NAME, arguments: { link_attempt_id: attemptId } }, undefined,
        { timeout: 10 * 60_000, maxTotalTimeout: 10 * 60_000 });
    } catch {
      recoveryId = findUniqueLocalRecoveryId(ownerMedia.service, attemptId, selection.binding);
      summary = { ...safeSummary(config, "OUTCOME_UNKNOWN", selection.binding), probe_call_count: probeCallCount, restart_safe: false };
      summary.recovery_available = recoveryId !== null;
      if (recoveryId === null) summary.recovery_handle_status = "HANDLE_UNAVAILABLE";
    }

    if (probeResult !== undefined && probeResult?.isError === true) {
      const error = parseToolError(probeResult);
      if (error.code === "OUTCOME_UNKNOWN") {
        recoveryId = error.recoveryId ?? findUniqueLocalRecoveryId(ownerMedia.service, attemptId, selection.binding);
        summary = { ...safeSummary(config, "OUTCOME_UNKNOWN", selection.binding), probe_call_count: probeCallCount,
          recovery_available: recoveryId !== null, restart_safe: false };
        if (recoveryId === null) summary.recovery_handle_status = "HANDLE_UNAVAILABLE";
      } else {
        summary = { ...safeSummary(config, safeErrorCode(error.code), selection.binding), probe_call_count: probeCallCount };
      }
    } else if (probeResult !== undefined) {
      const completed = summarizeReviewedProbeResult(probeResult, selection.binding);
      if (completed === null) {
        summary = { ...safeSummary(config, "OUTCOME_UNKNOWN", selection.binding), probe_call_count: probeCallCount,
          recovery_available: false, restart_safe: false, safe_error_code: "RESULT_BINDING_UNVERIFIED" };
      } else {
        summary = { ...completed, probe_call_count: probeCallCount };
        const imageGeometry = await observeGeometry(probeResult);
        if (imageGeometry !== undefined) summary.image_geometry_observation = imageGeometry;
      }
    }

    if (summary.status === "OUTCOME_UNKNOWN") {
      return await reconcileUnknownOutcome({ client, attemptId, recoveryId, summary, binding: selection.binding,
        now, waitForParentAction, emitPrivate, observeGeometry });
    } else {
      finalActionPromise = waitForParentAction(FINISH_WAIT_MS);
      await emitPrivate({ event: "TERMINAL_RESULT", ...summary });
    }

    const finishAction = await finalActionPromise;
    if (finishAction?.action === "finish") {
      summary = await finishLinkedSession(client, attemptId, summary, selection.binding);
    } else {
      summary = { ...summary, local_unlink_status: "NOT_CONFIRMED", finish_action: "NOT_RECEIVED" };
    }
    return summary;
  } catch {
    if (ATTEMPT_PATTERN.test(attemptId ?? "") && probeCallCount === 0) return await stopBeforeProbe("PROBE_UNAVAILABLE");
    if (probeCallCount > 0 && ["NOT_STARTED", "PROBE_UNAVAILABLE"].includes(summary.status)) {
      const ownerMedia = runtime?.serverOptions?.ownerContractMedia;
      recoveryId = recoveryId ?? findUniqueLocalRecoveryId(ownerMedia?.service, attemptId, selection.binding);
      summary = { ...safeSummary(config, "OUTCOME_UNKNOWN", selection.binding), probe_call_count: probeCallCount,
        recovery_available: recoveryId !== null, restart_safe: false,
        ...(recoveryId === null ? { recovery_handle_status: "HANDLE_UNAVAILABLE" } : {}) };
      return await reconcileUnknownOutcome({ client, attemptId, recoveryId, summary, binding: selection.binding,
        now, waitForParentAction, emitPrivate, observeGeometry });
    }
    summary = { ...summary, status: summary.status === "NOT_STARTED" ? "PROBE_UNAVAILABLE" : summary.status,
      safe_error_code: "PROBE_UNAVAILABLE", ...(probeCallCount > 0 ? { probe_call_count: probeCallCount } : {}) };
    return summary;
  } finally {
    await closeSession(client, server);
    try { runtime?.authStore?.close?.(); } catch { /* Safe teardown; no sensitive error is emitted. */ }
  }
}

function loadReviewedSelection(config) {
  const imageFamilyCase = config.imageFamilyCaseId === undefined ? undefined : IMAGE_FAMILY_CASES[config.imageFamilyCaseId];
  const isExactImageFamilyCase = imageFamilyCase !== undefined &&
    config.registryVersion === (imageFamilyCase.registryVersion ?? REVIEWED_PROBE_OPERATOR_REGISTRY_VERSION) &&
    config.modelId === imageFamilyCase.modelId && config.operationId === imageFamilyCase.operationId &&
    config.variantId === imageFamilyCase.variantId;
  if (!APPROVED_REVIEWED_PROBE_REGISTRY_VERSIONS.includes(config.registryVersion) && !isExactImageFamilyCase) {
    throw new Error("REGISTRY_VERSION_NOT_ALLOWED");
  }
  const registry = loadGenerationContractRegistryV2(config.registryVersion);
  const selected = loadSelectedDiscoveryCatalog();
  const catalog = selected.discoveryCatalog;
  const matches = registry.contracts.filter((contract) => contract.model_id === config.modelId &&
    contract.operation_id === config.operationId && contract.variant_id === config.variantId);
  if (matches.length !== 1 || matches[0].status !== "reviewed" || !SAFE_HASH_PATTERN.test(matches[0].schema_hash)) {
    throw new Error("EXACT_REVIEWED_CONTRACT_NOT_FOUND");
  }
  const contract = matches[0];
  const model = catalog.getModel(config.modelId);
  if (model.active !== true || !model.operations.some((operation) => operation.id === config.operationId) ||
      model.ai_name !== contract.ai_name || model.upstream_id !== contract.model_type) throw new Error("CURRENT_MODEL_BINDING_UNAVAILABLE");
  return {
    registry,
    catalog,
    model,
    contract,
    binding: Object.freeze({
      registry_version: config.registryVersion,
      model_id: contract.model_id,
      operation_id: contract.operation_id,
      variant_id: contract.variant_id,
      schema_hash: contract.schema_hash,
      mime_types: Object.freeze([...contract.output.mime_types]),
      operator_parameter_keys: Object.freeze([]),
      normalized_request_fingerprint: ""
    })
  };
}

async function openInMemorySession(runtime, serverOptions, dependencies) {
  const server = (dependencies.createMcpServer ?? createMcpServer)(runtime.application, serverOptions);
  const client = new Client({ name: "syntx-owner-reviewed-probe-source-cli", version: "1.0.0" });
  const [clientTransport, serverTransport] = (dependencies.InMemoryTransport ?? InMemoryTransport).createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { server, client };
  } catch (error) {
    await closeSession(client, server);
    throw error;
  }
}

async function finishLinkedSession(client, attemptId, summary, binding) {
  if (!ATTEMPT_PATTERN.test(attemptId ?? "")) return { ...summary, local_unlink_status: "NOT_AVAILABLE" };
  try {
    const revoked = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: attemptId } }, undefined,
      { timeout: 12_000, maxTotalTimeout: 12_000 });
    if (revoked?.isError === true || revoked?.structuredContent?.status !== "REVOKED") {
      return cleanupUnknown(summary);
    }
    const readback = await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } }, undefined,
      { timeout: 12_000, maxTotalTimeout: 12_000 });
    if (readback?.isError === true || readback?.structuredContent?.attempt_id !== attemptId || readback?.structuredContent?.status !== "REVOKED" ||
        readback?.structuredContent?.linked !== false) return cleanupUnknown(summary);
    return { ...summary, local_unlink_status: "REVOKED_READBACK_CONFIRMED", cleanup_contract_status: binding === null ? "UNKNOWN" : "reviewed" };
  } catch { return cleanupUnknown(summary); }
}

function cleanupUnknown(summary) {
  return {
    ...summary,
    ...(summary.status === "PASS_EXACT_RESULT_ONLY" ? { status: "PROBE_TERMINAL_CLEANUP_UNKNOWN", probe_result_status: "PASS_EXACT_RESULT_ONLY" } : {}),
    local_unlink_status: "UNCONFIRMED"
  };
}

async function defaultSendPrivateIpc(message, timeoutMs = 5_000) {
  if (typeof process.send !== "function") return false;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); resolve(ok); };
    try { process.send(message, (error) => finish(error == null)); } catch { finish(false); }
  });
}

function defaultWaitForHandoffAck(timeoutMs, signal) {
  return waitForProcessMessage(timeoutMs, (message) => message !== null && typeof message === "object" && !Array.isArray(message) &&
    Object.keys(message).length === 1 && message.action === "handoff_sent", undefined, signal);
}

function defaultWaitForParentAction(timeoutMs, signal) {
  return waitForProcessMessage(timeoutMs, (message) => message !== null && typeof message === "object" && !Array.isArray(message) &&
    Object.keys(message).length === 1 && SAFE_ACTIONS.has(message.action), (message) => message, signal);
}

function waitForProcessMessage(timeoutMs, isValid, pick = (message) => message, signal) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); process.off("message", onMessage); signal?.removeEventListener("abort", onAbort); resolve(value); };
    const onMessage = (message) => { if (isValid(message)) finish(pick(message)); };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    timer.unref?.();
    if (signal?.aborted) return finish(null);
    signal?.addEventListener("abort", onAbort, { once: true });
    process.on("message", onMessage);
  });
}

function parseToolError(result) {
  const text = result?.content?.find((item) => item.type === "text")?.text;
  try {
    const parsed = JSON.parse(text);
    const code = typeof parsed?.error?.code === "string" && MAX_SAFE_ERROR.test(parsed.error.code) ? parsed.error.code : "PROBE_UNAVAILABLE";
    const recoveryId = typeof parsed?.error?.recovery_id === "string" && RECOVERY_PATTERN.test(parsed.error.recovery_id) ? parsed.error.recovery_id : null;
    return { code, recoveryId };
  } catch { return { code: "PROBE_UNAVAILABLE", recoveryId: null }; }
}

function findUniqueLocalRecoveryId(service, attemptId, binding) {
  try {
    if (typeof service?.listRecoveries !== "function") return null;
    const matches = service.listRecoveries(attemptId, 20).filter((record) => record.model_id === binding.model_id &&
      record.operation_id === binding.operation_id && record.variant_id === binding.variant_id);
    if (matches.length !== 1 || typeof matches[0]?.recovery_id !== "string" || !RECOVERY_PATTERN.test(matches[0].recovery_id)) return null;
    return matches[0].recovery_id;
  } catch { return null; }
}

async function reconcileUnknownOutcome({ client, attemptId, recoveryId, summary, binding, now, waitForParentAction, emitPrivate, observeGeometry }) {
  const deadline = now() + UNKNOWN_RECOVERY_WINDOW_MS;
  let actionPromise = waitForParentAction(Math.max(0, deadline - now()));
  await emitPrivate({ event: "OUTCOME_UNKNOWN", ...summary });
  while (now() < deadline) {
    const action = await actionPromise;
    if (action === null) break;
    if (action.action === "finish") return await finishLinkedSession(client, attemptId, summary, binding);
    if (action.action !== "reconcile") continue;
    if (recoveryId === null) {
      summary = { ...summary, reconcile_status: "RECOVERY_HANDLE_UNAVAILABLE", recovery_available: false };
      actionPromise = waitForParentAction(Math.max(0, deadline - now()));
      await emitPrivate({ event: "OUTCOME_UNKNOWN", ...summary });
      continue;
    }
    let reconciled;
    try {
      reconciled = await client.callTool({ name: REVIEWED_PROBE_RECONCILE_TOOL_NAME, arguments: {
        link_attempt_id: attemptId, recovery_id: recoveryId
      } }, undefined, { timeout: 15_000, maxTotalTimeout: 15_000 });
    } catch { reconciled = { isError: true }; }
    if (reconciled?.isError === true) {
      const error = parseToolError(reconciled);
      summary = { ...summary, reconcile_status: error.recoveryId !== null && error.recoveryId !== recoveryId ? "HANDLE_MISMATCH" : "OUTCOME_UNKNOWN" };
      actionPromise = waitForParentAction(Math.max(0, deadline - now()));
      await emitPrivate({ event: "OUTCOME_UNKNOWN", ...summary });
      continue;
    }
    const completed = summarizeReviewedProbeResult(reconciled, binding);
    if (completed === null) {
      summary = { ...summary, reconcile_status: "RESULT_BINDING_UNVERIFIED" };
      actionPromise = waitForParentAction(Math.max(0, deadline - now()));
      await emitPrivate({ event: "OUTCOME_UNKNOWN", ...summary });
      continue;
    }
    summary = { ...completed, probe_call_count: summary.probe_call_count, recovery_call_count: (summary.recovery_call_count ?? 0) + 1 };
    const imageGeometry = await observeGeometry(reconciled);
    if (imageGeometry !== undefined) summary.image_geometry_observation = imageGeometry;
    const finishPromise = waitForParentAction(FINISH_WAIT_MS);
    await emitPrivate({ event: "TERMINAL_RESULT", ...summary });
    const finish = await finishPromise;
    return finish?.action === "finish"
      ? await finishLinkedSession(client, attemptId, summary, binding)
      : cleanupUnknown(summary);
  }
  if (now() >= deadline) return { ...summary, status: "OUTCOME_UNKNOWN", restart_safe: false, recovery_window: "EXPIRED", local_unlink_status: "NOT_CONFIRMED" };
  return { ...summary, status: "OUTCOME_UNKNOWN", restart_safe: false, recovery_window: "OPEN", local_unlink_status: "NOT_CONFIRMED" };
}

function safeErrorCode(code) {
  return typeof code === "string" && MAX_SAFE_ERROR.test(code) ? code : "PROBE_UNAVAILABLE";
}

function safeSummary(config, status, binding = null) {
  return Object.freeze({
    status,
    ...(binding === null ? {} : {
      confidence_scope: "exact_result_only",
      contract_status: "reviewed",
      model_id: binding.model_id,
      operation_id: binding.operation_id,
      variant_id: binding.variant_id,
      registry_version: binding.registry_version,
      schema_hash: binding.schema_hash,
      operator_parameter_keys: binding.operator_parameter_keys ?? Object.freeze([]),
      normalized_request_fingerprint: binding.normalized_request_fingerprint ?? ""
    })
  });
}

function isSafeHandoffUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "t.me" || url.hostname === "telegram.me") && url.username === "" && url.password === "";
  } catch { return false; }
}

function isUnknownStatus(status) {
  return typeof status === "string" && /(?:UNKNOWN|UNAVAILABLE|ERROR)/u.test(status);
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function closeSession(client, server) {
  try { await client?.close(); } catch { /* Safe teardown; errors are not emitted. */ }
  try { await server?.close(); } catch { /* Safe teardown; errors are not emitted. */ }
}

async function runCli(argv) {
  const config = parseOwnerReviewedContractProbeArgs(argv);
  if (config === null) {
    process.stderr.write("Refusing reviewed owner probe: exact confirmation, pinned registry, model, operation, and variant are required.\n");
    process.exitCode = 2;
    return;
  }
  const summary = await runOwnerReviewedContractProbe(config);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.status !== "PASS_EXACT_RESULT_ONLY" || summary.local_unlink_status !== "REVOKED_READBACK_CONFIRMED") process.exitCode = 1;
  if (typeof process.send === "function") await defaultSendPrivateIpc({ event: "FINAL", ...summary }, 2_000);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli(process.argv.slice(2)).catch(() => {
    process.stderr.write("Reviewed owner probe stopped without emitting private response data.\n");
    process.exitCode = 1;
  });
}
