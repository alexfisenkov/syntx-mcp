import { types } from "node:util";
import { canonicalJson, type GenerationContract, type GenerationParameterProperty } from "../domain/generation-contract.js";

const MAX_INPUT_BYTES = 256 * 1024;

export type GenerationContractValidationErrorCode =
  | "PARAMETERS_INVALID"
  | "UNKNOWN_FIELD"
  | "FIELD_REQUIRED"
  | "FIELD_TYPE_INVALID"
  | "FIELD_VALUE_OUT_OF_RANGE"
  | "CONDITION_FAILED"
  | "INPUT_LIMIT_EXCEEDED";

export class GenerationContractValidationError extends Error {
  constructor(readonly code: GenerationContractValidationErrorCode) {
    super("Generation parameters do not satisfy the reviewed generation contract.");
    this.name = "GenerationContractValidationError";
  }
}

/** Apply reviewed defaults and validate a bounded JSON object without invoking accessors. */
export function validateGenerationParameters(
  contract: GenerationContract,
  input: unknown
): Readonly<Record<string, unknown>> {
  const limits = contract.limits;
  const copied = snapshotInput(input, limits.max_value_depth);
  if (!isRecord(copied)) throw invalid("PARAMETERS_INVALID");
  const keys = Object.keys(copied);
  if (keys.length > limits.max_parameters) throw invalid("INPUT_LIMIT_EXCEEDED");
  for (const key of keys) {
    if (!Object.hasOwn(contract.parameters.properties, key)) throw invalid("UNKNOWN_FIELD");
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(contract.parameters.properties)) {
    let value = copied[key];
    if (!Object.hasOwn(copied, key) && Object.hasOwn(property, "default")) {
      value = cloneJson(property.default);
    }
    if (!Object.hasOwn(copied, key) && !Object.hasOwn(property, "default")) continue;
    if (!validateProperty(property, value)) {
      const code = !matchesPropertyType(property, value) ? "FIELD_TYPE_INVALID" : "FIELD_VALUE_OUT_OF_RANGE";
      throw invalid(code);
    }
    normalized[key] = value;
  }
  if (Object.keys(normalized).length > limits.max_parameters) throw invalid("INPUT_LIMIT_EXCEEDED");
  if (Buffer.byteLength(canonicalJson(normalized), "utf8") > limits.max_serialized_bytes) throw invalid("INPUT_LIMIT_EXCEEDED");

  for (const key of contract.parameters.required) {
    if (!Object.hasOwn(normalized, key)) throw invalid("FIELD_REQUIRED");
  }
  for (const condition of contract.parameters.conditions) {
    if (!Object.is(normalized[condition.when.field], condition.when.equals)) continue;
    if ((condition.require ?? []).some((field) => !Object.hasOwn(normalized, field)) ||
        (condition.forbid ?? []).some((field) => Object.hasOwn(normalized, field))) {
      throw invalid("CONDITION_FAILED");
    }
  }
  return Object.freeze(normalized);
}

function validateProperty(property: GenerationParameterProperty, value: unknown): boolean {
  if (property.type === "array") {
    if (!Array.isArray(value) || value.length < (property.min_items ?? 0) || value.length > (property.max_items ?? 256)) return false;
    return value.every((item) => validateScalar(property.items, item));
  }
  return validateScalar(property, value);
}

function validateScalar(
  property: { type: string; enum?: readonly unknown[] | undefined; minimum?: number | undefined; maximum?: number | undefined; min_length?: number | undefined; max_length?: number | undefined },
  value: unknown
): boolean {
  if (!matchesPropertyType(property, value)) return false;
  if (property.enum && !property.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (typeof value === "number" &&
      ((property.minimum !== undefined && value < property.minimum) || (property.maximum !== undefined && value > property.maximum))) return false;
  if (typeof value === "string" &&
      ((property.min_length !== undefined && Array.from(value).length < property.min_length) || (property.max_length !== undefined && Array.from(value).length > property.max_length))) return false;
  return true;
}

function matchesPropertyType(property: { type: string }, value: unknown): boolean {
  switch (property.type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value);
    default: return false;
  }
}

function snapshotInput(input: unknown, maxDepth: number): unknown {
  let bytes = 0;
  let nodes = 0;
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 2_000 || depth > maxDepth) throw invalid("INPUT_LIMIT_EXCEEDED");
    if (value === null || typeof value === "boolean") bytes += 5;
    else if (typeof value === "string") bytes += Buffer.byteLength(value, "utf8") + 2;
    else if (typeof value === "number" && Number.isFinite(value)) bytes += 32;
    else if (typeof value !== "object" || value === null || types.isProxy(value) || active.has(value)) throw invalid("PARAMETERS_INVALID");
    else {
      const array = Array.isArray(value);
      if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) &&
          (array || Object.getPrototypeOf(value) !== null)) throw invalid("PARAMETERS_INVALID");
      const ownKeys = Reflect.ownKeys(value);
      const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value as number : 0;
      if ((array && (length > 256 || ownKeys.length !== length + 1)) || (!array && ownKeys.length > 65)) {
        throw invalid("INPUT_LIMIT_EXCEEDED");
      }
      active.add(value);
      const result: Record<string, unknown> | unknown[] = array ? [] : {};
      for (const key of ownKeys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || key === "__proto__" || key === "constructor" || key === "prototype" ||
            (array && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) throw invalid("PARAMETERS_INVALID");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalid("PARAMETERS_INVALID");
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

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJson));
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) Object.defineProperty(copy, key, { value: cloneJson(nested), enumerable: true });
    return Object.freeze(copy);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(code: GenerationContractValidationErrorCode): GenerationContractValidationError {
  return new GenerationContractValidationError(code);
}
