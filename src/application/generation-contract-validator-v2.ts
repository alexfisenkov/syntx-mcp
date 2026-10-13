import { types } from "node:util";
import { canonicalJson } from "../domain/generation-contract.js";
import type {
  GenerationContractV2,
  GenerationContractV2JsonValue,
  GenerationContractV2ParameterNode
} from "../domain/generation-contract-v2.js";

const MAX_INPUT_NODES = 20_000;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_ARRAY_ITEMS = 256;

export type GenerationContractValidationErrorCodeV2 =
  | "PARAMETERS_INVALID"
  | "UNKNOWN_FIELD"
  | "FIELD_REQUIRED"
  | "FIELD_TYPE_INVALID"
  | "FIELD_VALUE_OUT_OF_RANGE"
  | "CONDITION_FAILED"
  | "INPUT_LIMIT_EXCEEDED";

export class GenerationContractValidationErrorV2 extends Error {
  constructor(readonly code: GenerationContractValidationErrorCodeV2) {
    super("Generation parameters do not satisfy the v2 generation contract.");
    this.name = "GenerationContractValidationErrorV2";
  }
}

/** Snapshot untrusted JSON, apply recursive defaults, then validate the normalized payload. */
export function validateGenerationParametersV2(
  contract: GenerationContractV2,
  input: unknown
): Readonly<Record<string, GenerationContractV2JsonValue>> {
  let copied: unknown;
  try {
    copied = snapshotInput(input, contract.limits.max_value_depth);
  } catch (error) {
    if (error instanceof GenerationContractValidationErrorV2) throw error;
    throw invalid("PARAMETERS_INVALID");
  }
  if (!isRecord(copied)) throw invalid("PARAMETERS_INVALID");
  const inputKeys = Object.keys(copied);
  if (inputKeys.length > contract.limits.max_parameters) throw invalid("INPUT_LIMIT_EXCEEDED");
  for (const key of inputKeys) {
    if (!Object.hasOwn(contract.parameters.properties, key)) throw invalid("UNKNOWN_FIELD");
  }

  const normalized: Record<string, GenerationContractV2JsonValue> = {};
  const budget: NormalizationBudget = {
    nodes: 0,
    serializedBytes: 0,
    maxNodes: contract.limits.max_normalized_nodes,
    maxSerializedBytes: contract.limits.max_serialized_bytes
  };
  const effectiveKeys = Object.entries(contract.parameters.properties)
    .filter(([key, node]) => Object.hasOwn(copied, key) || "default" in node)
    .map(([key]) => key);
  reserveContainer(budget, effectiveKeys);
  for (const [key, node] of Object.entries(contract.parameters.properties)) {
    const present = Object.hasOwn(copied, key);
    const hasDefault = "default" in node;
    if (!present && !hasDefault) continue;
    const raw = present ? copied[key] : getNodeDefault(node);
    const result = normalizeNode(node, raw, 0, contract.limits.max_value_depth, budget);
    if (!result.ok) throw invalid(result.code);
    Object.defineProperty(normalized, key, { value: result.value, enumerable: true, configurable: false, writable: false });
  }

  if (Object.keys(normalized).length > contract.limits.max_parameters ||
      Buffer.byteLength(canonicalJson(normalized), "utf8") > contract.limits.max_serialized_bytes) {
    throw invalid("INPUT_LIMIT_EXCEEDED");
  }
  for (const key of contract.parameters.required) {
    if (!Object.hasOwn(normalized, key)) throw invalid("FIELD_REQUIRED");
  }
  for (const condition of contract.parameters.conditions) {
    if (!Object.is(normalized[condition.when.field], condition.when.equals)) continue;
    if ((condition.require ?? []).some((field) => !Object.hasOwn(normalized, field)) ||
        (condition.forbid ?? []).some((field) => Object.hasOwn(normalized, field))) throw invalid("CONDITION_FAILED");
  }
  for (const rule of contract.parameters.conditional_enums) {
    const matching = rule.cases.filter((entry) => Object.is(normalized[entry.when.field], entry.when.equals));
    if (matching.length > 1) throw invalid("CONDITION_FAILED");
    if (matching.length === 0) throw invalid("CONDITION_FAILED");
    const value = normalized[rule.field];
    if (!Object.hasOwn(normalized, rule.field) || !matching[0]!.allowed_values.some((candidate) => Object.is(candidate, value))) {
      throw invalid("FIELD_VALUE_OUT_OF_RANGE");
    }
  }
  return Object.freeze(normalized);
}

type NodeResult = { readonly ok: true; readonly value: GenerationContractV2JsonValue } |
  { readonly ok: false; readonly code: GenerationContractValidationErrorCodeV2 };

interface NormalizationBudget {
  nodes: number;
  serializedBytes: number;
  readonly maxNodes: number;
  readonly maxSerializedBytes: number;
}

function normalizeNode(
  node: GenerationContractV2ParameterNode,
  value: unknown,
  depth: number,
  maxDepth: number,
  budget: NormalizationBudget
): NodeResult {
  if (depth > maxDepth) return failure("INPUT_LIMIT_EXCEEDED");
  budget.nodes += 1;
  if (budget.nodes > budget.maxNodes) return failure("INPUT_LIMIT_EXCEEDED");
  if (value === null) {
    if (node.type === "media_reference" || !("nullable" in node && node.nullable === true)) return failure("FIELD_TYPE_INVALID");
    if ((node.type === "string" || node.type === "number" || node.type === "integer" || node.type === "boolean") &&
        node.enum && !node.enum.some((candidate) => Object.is(candidate, null))) return failure("FIELD_VALUE_OUT_OF_RANGE");
    if (!reserveBytes(budget, Buffer.byteLength(canonicalJson(null), "utf8"))) return failure("INPUT_LIMIT_EXCEEDED");
    return success(null);
  }
  if (node.type === "media_reference") {
    if (!isOpaqueUploadId(value)) return failure("FIELD_TYPE_INVALID");
    if (!reserveBytes(budget, Buffer.byteLength(canonicalJson(value), "utf8"))) return failure("INPUT_LIMIT_EXCEEDED");
    return success(value);
  }
  if (node.type === "string" || node.type === "number" || node.type === "integer" || node.type === "boolean") {
    if (!matchesScalarType(node.type, value)) return failure("FIELD_TYPE_INVALID");
    if (node.enum && !node.enum.some((candidate) => Object.is(candidate, value))) return failure("FIELD_VALUE_OUT_OF_RANGE");
    if (typeof value === "string") {
      const length = Array.from(value).length;
      if ((node.min_length !== undefined && length < node.min_length) || (node.max_length !== undefined && length > node.max_length)) {
        return failure("FIELD_VALUE_OUT_OF_RANGE");
      }
    }
    if (typeof value === "number") {
      if ((node.minimum !== undefined && value < node.minimum) || (node.maximum !== undefined && value > node.maximum) ||
          (node.step !== undefined && !isOnStep(value, node.minimum ?? 0, node.step))) return failure("FIELD_VALUE_OUT_OF_RANGE");
    }
    if (!reserveBytes(budget, Buffer.byteLength(canonicalJson(value), "utf8"))) return failure("INPUT_LIMIT_EXCEEDED");
    return success(value);
  }
  if (node.type === "array") {
    if (!Array.isArray(value)) return failure("FIELD_TYPE_INVALID");
    if (value.length > MAX_ARRAY_ITEMS || value.length < (node.min_items ?? 0) || value.length > (node.max_items ?? MAX_ARRAY_ITEMS)) {
      return failure("FIELD_VALUE_OUT_OF_RANGE");
    }
    if (!reserveBytes(budget, 2 + Math.max(0, value.length - 1))) return failure("INPUT_LIMIT_EXCEEDED");
    const normalized: GenerationContractV2JsonValue[] = [];
    for (const item of value) {
      const result = normalizeNode(node.items, item, depth + 1, maxDepth, budget);
      if (!result.ok) return result;
      normalized.push(result.value);
    }
    return success(Object.freeze(normalized));
  }
  if (node.type !== "object" || !isRecord(value)) return failure("FIELD_TYPE_INVALID");
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!Object.hasOwn(node.properties, key)) return failure("UNKNOWN_FIELD");
  }
  const effectiveKeys = Object.entries(node.properties)
    .filter(([key, childNode]) => Object.hasOwn(value, key) || "default" in childNode)
    .map(([key]) => key);
  if (!reserveContainer(budget, effectiveKeys)) return failure("INPUT_LIMIT_EXCEEDED");
  const normalized: Record<string, GenerationContractV2JsonValue> = {};
  for (const [key, childNode] of Object.entries(node.properties)) {
    const present = Object.hasOwn(value, key);
    if (!present && !Object.hasOwn(childNode, "default")) continue;
    const result = normalizeNode(childNode, present ? value[key] : getNodeDefault(childNode), depth + 1, maxDepth, budget);
    if (!result.ok) return result;
    Object.defineProperty(normalized, key, { value: result.value, enumerable: true, configurable: false, writable: false });
  }
  for (const key of node.required) {
    if (!Object.hasOwn(normalized, key)) return failure("FIELD_REQUIRED");
  }
  return success(Object.freeze(normalized));
}

function reserveContainer(budget: NormalizationBudget, keys: readonly string[]): boolean {
  let bytes = 2 + Math.max(0, keys.length - 1);
  for (const key of keys) bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
  return reserveBytes(budget, bytes);
}

function reserveBytes(budget: NormalizationBudget, bytes: number): boolean {
  budget.serializedBytes += bytes;
  return budget.serializedBytes <= budget.maxSerializedBytes;
}

function snapshotInput(input: unknown, maxDepth: number): unknown {
  let bytes = 0;
  let nodes = 0;
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > MAX_INPUT_NODES || depth > maxDepth) throw invalid("INPUT_LIMIT_EXCEEDED");
    if (value === null || typeof value === "boolean") bytes += 5;
    else if (typeof value === "string") bytes += Buffer.byteLength(value, "utf8") + 2;
    else if (typeof value === "number" && Number.isFinite(value)) bytes += 32;
    else if (typeof value !== "object" || value === null || types.isProxy(value) || active.has(value)) throw invalid("PARAMETERS_INVALID");
    else {
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) throw invalid("PARAMETERS_INVALID");
      const ownKeys = Reflect.ownKeys(value);
      const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value as number : 0;
      if ((array && (length > MAX_ARRAY_ITEMS || ownKeys.length !== length + 1)) || (!array && ownKeys.length > 65)) {
        throw invalid("INPUT_LIMIT_EXCEEDED");
      }
      active.add(value);
      const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null) as Record<string, unknown>;
      for (const key of ownKeys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || key === "__proto__" || key === "constructor" || key === "prototype" ||
            (array && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) throw invalid("PARAMETERS_INVALID");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw invalid("PARAMETERS_INVALID");
        bytes += Buffer.byteLength(key, "utf8") + 4;
        const child = copy(descriptor.value, depth + 1);
        if (array) (result as unknown[]).push(child);
        else Object.defineProperty(result, key, { value: child, enumerable: true, configurable: false, writable: false });
      }
      active.delete(value);
      Object.freeze(result);
      if (bytes > MAX_INPUT_BYTES) throw invalid("INPUT_LIMIT_EXCEEDED");
      return result;
    }
    if (bytes > MAX_INPUT_BYTES) throw invalid("INPUT_LIMIT_EXCEEDED");
    return value;
  };
  return copy(input, 0);
}

function matchesScalarType(type: string, value: unknown): value is string | number | boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    default: return false;
  }
}

function isOnStep(value: number, origin: number, step: number): boolean {
  const units = (value - origin) / step;
  return Number.isFinite(units) && Math.abs(units - Math.round(units)) <= 1e-8;
}

function isOpaqueUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(value);
}

function getNodeDefault(node: GenerationContractV2ParameterNode): unknown {
  return "default" in node ? node.default : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function success(value: GenerationContractV2JsonValue): NodeResult { return { ok: true, value }; }
function failure(code: GenerationContractValidationErrorCodeV2): NodeResult { return { ok: false, code }; }
function invalid(code: GenerationContractValidationErrorCodeV2): GenerationContractValidationErrorV2 {
  return new GenerationContractValidationErrorV2(code);
}
