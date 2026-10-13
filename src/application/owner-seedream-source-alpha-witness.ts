import { isProxy } from "node:util/types";
import {
  inspectOwnerPngSourceCanvasAlpha,
  type OwnerPngSourceCanvasAlphaProjection
} from "./owner-png-alpha-inspector.js";

declare const ownerSeedreamSourceAlphaWitnessBrand: unique symbol;

export type OwnerSeedreamSourceAlphaWitness = Readonly<{
  readonly [ownerSeedreamSourceAlphaWitnessBrand]: true;
}>;

export interface OwnerSeedreamSourceAlphaMetadata {
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export type OwnerSeedreamSourceAlphaWitnessSnapshot = Readonly<OwnerPngSourceCanvasAlphaProjection>;

export class OwnerSeedreamSourceAlphaWitnessError extends Error {
  constructor(readonly code: "INVALID_SOURCE_ALPHA_WITNESS" | "SOURCE_ALPHA_WITNESS_MISMATCH") {
    super("The Seedream source-alpha witness could not be verified.");
    this.name = "OwnerSeedreamSourceAlphaWitnessError";
  }
}

const witnessStates = new WeakMap<object, OwnerPngSourceCanvasAlphaProjection>();
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

/** Issues an opaque process-local token only after decoding the supplied PNG bytes. */
export function createOwnerSeedreamSourceAlphaWitness(bytes: Uint8Array): OwnerSeedreamSourceAlphaWitness {
  const projection = inspectOwnerPngSourceCanvasAlpha(bytes);
  const token = Object.freeze(Object.create(null)) as OwnerSeedreamSourceAlphaWitness;
  witnessStates.set(token, projection);
  return token;
}

/** Returns safe source metadata only when caller metadata exactly matches the issued PNG witness. */
export function snapshotOwnerSeedreamSourceAlphaWitness(
  witness: OwnerSeedreamSourceAlphaWitness,
  metadata: OwnerSeedreamSourceAlphaMetadata
): OwnerSeedreamSourceAlphaWitnessSnapshot {
  if (!isObject(witness) || isProxy(witness)) fail("INVALID_SOURCE_ALPHA_WITNESS");
  const projection = witnessStates.get(witness);
  if (!projection) fail("INVALID_SOURCE_ALPHA_WITNESS");
  const exactMetadata = readExactMetadata(metadata);
  if (exactMetadata.sha256 !== projection.sha256 || exactMetadata.width !== projection.width || exactMetadata.height !== projection.height) {
    fail("SOURCE_ALPHA_WITNESS_MISMATCH");
  }
  return Object.freeze({ ...projection });
}

function readExactMetadata(value: unknown): OwnerSeedreamSourceAlphaMetadata {
  if (!isObject(value) || isProxy(value)) fail("SOURCE_ALPHA_WITNESS_MISMATCH");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("SOURCE_ALPHA_WITNESS_MISMATCH");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || !keys.includes("sha256") || !keys.includes("width") || !keys.includes("height")) fail("SOURCE_ALPHA_WITNESS_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const sha256 = descriptors.sha256?.value;
  const width = descriptors.width?.value;
  const height = descriptors.height?.value;
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256) ||
      typeof width !== "number" || !Number.isSafeInteger(width) || width < 1 ||
      typeof height !== "number" || !Number.isSafeInteger(height) || height < 1 ||
      !descriptors.sha256 || !("value" in descriptors.sha256) ||
      !descriptors.width || !("value" in descriptors.width) ||
      !descriptors.height || !("value" in descriptors.height)) fail("SOURCE_ALPHA_WITNESS_MISMATCH");
  return { sha256, width, height };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function fail(code: OwnerSeedreamSourceAlphaWitnessError["code"]): never {
  throw new OwnerSeedreamSourceAlphaWitnessError(code);
}
