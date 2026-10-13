import { isProxy } from "node:util/types";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import type { GenerationJob, GenerationRequest, GenerationResult } from "../domain/types.js";
import type { OwnerDurableSessionManager } from "../runtime/owner-durable-session-manager.js";

export interface OwnerDurableLiveGenerationInput {
  readonly link_attempt_id: string;
  readonly model_id: string;
  readonly operation_id: string;
  readonly variant_id: string;
  readonly parameters: Record<string, unknown>;
  readonly idempotency_key: string;
}

export interface OwnerDurableLiveGenerationServicePort {
  start(input: OwnerDurableLiveGenerationInput): Promise<GenerationJob>;
  getJob(attemptId: string, jobId: string): Promise<GenerationJob>;
  getResult(attemptId: string, jobId: string): Promise<GenerationResult>;
}

/** Bridges the closed MCP request to the durable manager's exact V2 selection and journal. */
export class OwnerDurableLiveGenerationService implements OwnerDurableLiveGenerationServicePort {
  readonly #manager: OwnerDurableSessionManager;
  readonly #registry: GenerationContractRegistryV2 | null;
  readonly #catalogVersion: string | null;

  constructor(manager: OwnerDurableSessionManager, registry: GenerationContractRegistryV2 | null, catalogVersion: string | null) {
    this.#manager = manager;
    this.#registry = registry;
    this.#catalogVersion = catalogVersion;
  }

  async start(input: OwnerDurableLiveGenerationInput): Promise<GenerationJob> {
    if (this.#registry === null || this.#catalogVersion === null) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    const start = snapshotStartInput(input);
    const selection = Object.freeze({
      model_id: start.model_id,
      operation_id: start.operation_id,
      variant_id: start.variant_id
    });
    const contract = this.#registry.contracts.find((candidate) => candidate.model_id === selection.model_id &&
      candidate.operation_id === selection.operation_id && candidate.variant_id === selection.variant_id);
    if (contract?.status !== "live_verified" || this.#registry.catalog_version !== this.#catalogVersion) {
      throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    }
    const parameters = snapshotOwnerDurableLiveParameters(start.parameters, {
      maxParameters: contract.limits.max_parameters,
      maxValueDepth: contract.limits.max_value_depth,
      maxSerializedBytes: contract.limits.max_serialized_bytes
    });
    const request: GenerationRequest = Object.freeze({
      model_id: selection.model_id,
      operation_id: selection.operation_id,
      catalog_version: this.#catalogVersion,
      parameters
    });
    const context = await this.#manager.getContext(start.link_attempt_id, selection);
    if (context.mode !== "OWNER_LIVE" || typeof context.startGeneration !== "function") {
      throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    }
    return context.startGeneration(request, start.idempotency_key);
  }

  getJob(attemptId: string, jobId: string): Promise<GenerationJob> {
    return this.#manager.readJob(attemptId, jobId);
  }

  getResult(attemptId: string, jobId: string): Promise<GenerationResult> {
    return this.#manager.readResult(attemptId, jobId);
  }
}

export class OwnerDurableLiveServiceError extends Error {
  constructor(readonly code: "OWNER_LIVE_UNAVAILABLE") {
    super("The explicit live owner generation context is unavailable.");
    this.name = "OwnerDurableLiveServiceError";
  }
}

const startKeys = ["link_attempt_id", "model_id", "operation_id", "variant_id", "parameters", "idempotency_key"] as const;

function snapshotStartInput(input: unknown): OwnerDurableLiveGenerationInput {
  const fields = readClosedDataRecord(input, startKeys);
  for (const key of ["link_attempt_id", "model_id", "operation_id", "variant_id", "idempotency_key"] as const) {
    if (typeof fields[key] !== "string") throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  }
  const linkAttemptId = fields.link_attempt_id as string;
  const modelId = fields.model_id as string;
  const operationId = fields.operation_id as string;
  const variantId = fields.variant_id as string;
  const idempotencyKey = fields.idempotency_key as string;
  if (!/^link_[A-Za-z0-9_-]{20,120}$/u.test(linkAttemptId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(modelId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(operationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(variantId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(idempotencyKey)) {
    throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  }
  return Object.freeze({ link_attempt_id: linkAttemptId, model_id: modelId, operation_id: operationId,
    variant_id: variantId, parameters: fields.parameters as Record<string, unknown>, idempotency_key: idempotencyKey });
}

function readClosedDataRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key) ||
      !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) {
    throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  }
  return Object.fromEntries(expectedKeys.map((key) => [key, descriptors[key]!.value]));
}

export interface OwnerDurableLiveParameterLimits {
  readonly maxParameters: number;
  readonly maxValueDepth: number;
  readonly maxSerializedBytes: number;
}

/** Iteratively bounds untrusted JSON before a caller performs recursive schema validation. */
export function snapshotOwnerDurableLiveParameters(input: unknown, limits: OwnerDurableLiveParameterLimits = {
  maxParameters: 64, maxValueDepth: 8, maxSerializedBytes: 256 * 1024
}): Record<string, unknown> {
  const { maxParameters, maxDepth, maxBytes } = {
    maxParameters: limits.maxParameters,
    maxDepth: limits.maxValueDepth,
    maxBytes: limits.maxSerializedBytes
  };
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  let nodes = 0;
  let serializedBytes = 0;
  const reserveBytes = (bytes: number) => {
    serializedBytes += bytes;
    if (serializedBytes > maxBytes) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  };
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 20_000 || depth > maxDepth) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    if (value === null) { reserveBytes(4); continue; }
    if (typeof value === "boolean") { reserveBytes(value ? 4 : 5); continue; }
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > maxBytes) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
      reserveBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      reserveBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
      continue;
    }
    if (!value || typeof value !== "object" || isProxy(value) || seen.has(value)) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    seen.add(value);
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== (isArray ? Array.prototype : Object.prototype) && (isArray || prototype !== null)) {
      throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (isArray) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length > 256 || keys.length !== length + 1 ||
          keys.some((key) => typeof key !== "string" || (key !== "length" &&
            (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)) ||
            (key !== "length" && (!descriptors[key]!.enumerable || !("value" in descriptors[key]!)))) ||
          Array.from({ length }, (_, index) => Object.hasOwn(descriptors, String(index))).some((present) => !present)) {
        throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
      }
      reserveBytes(2 + Math.max(0, length - 1));
      for (let index = 0; index < length; index++) stack.push({ value: descriptors[String(index)]!.value, depth: depth + 1 });
      continue;
    }
    if (keys.length > 64 || keys.some((key) => typeof key !== "string" ||
        !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(key) || ["__proto__", "prototype", "constructor"].includes(key) ||
        !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) {
      throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
    }
    reserveBytes(2 + Math.max(0, keys.length - 1));
    for (const key of keys as string[]) reserveBytes(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
    for (const key of keys as string[]) stack.push({ value: descriptors[key]!.value, depth: depth + 1 });
  }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > maxParameters) {
    throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  }
  const copy = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return Object.freeze(Array.from({ length: value.length }, (_, index) => copy(Object.getOwnPropertyDescriptor(value, String(index))!.value)));
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(descriptors)) Object.defineProperty(result, key, {
      value: copy(descriptors[key]!.value), enumerable: true, configurable: false, writable: false
    });
    return Object.freeze(result);
  };
  const result = copy(input) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes) throw new OwnerDurableLiveServiceError("OWNER_LIVE_UNAVAILABLE");
  return result;
}
