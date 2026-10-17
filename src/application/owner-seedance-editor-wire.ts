import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerSeedanceEditorSourceProfile,
  normalizeOwnerSeedanceEditorParameters,
  type OwnerSeedanceEditorNormalizedParameters
} from "./owner-seedance-editor-parameters.js";

const MODEL_ID = "seedance-2.5-editor" as const;
const MODEL_TYPE = "seedance-2.5" as const;
const AI_NAME = "seedance" as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const MIN_VIDEO_SECONDS = 4;

export interface OwnerSeedanceEditorCapturedSource {
  readonly url: string;
  readonly sha256: string;
  readonly duration_seconds: number;
}

export interface OwnerSeedanceEditorWireInput {
  readonly ai_name: typeof AI_NAME;
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly n: 1;
    readonly model_type: typeof MODEL_TYPE;
    readonly mode: "edit";
    readonly aspect_ratio: "adaptive";
    readonly resolution: OwnerSeedanceEditorNormalizedParameters["intent"]["resolution"];
    readonly video_duration: 0;
    readonly generate_audio: false;
    readonly file_urls: readonly Readonly<{ readonly type: "video"; readonly url: string }>[];
  }>;
}

export interface OwnerSeedanceEditorWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly profile_sha256: string;
  readonly wire: Readonly<OwnerSeedanceEditorWireInput>;
  readonly source_input_duration_context: Readonly<{
    readonly seconds: number;
    readonly authority: "CAPTURED_SOURCE_METADATA_NOT_PROVIDER_RECEIPT";
  }>;
  readonly cost_projection: "UNKNOWN";
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "ONE_CAPTURED_VIDEO_NO_FRAME_REFERENCES";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerSeedanceEditorWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") {
    super("The owner Seedance Editor wire candidate is invalid.");
    this.name = "OwnerSeedanceEditorWireError";
  }
}

/** Builds a frozen internal candidate from explicit controls and one captured video row. */
export function buildOwnerSeedanceEditorWire(input: unknown, sourceInput: unknown): Readonly<OwnerSeedanceEditorWireCandidate> {
  const source = exactSource(sourceInput);
  if (!isSafeUploadReferenceUrl(source.url) || !SHA256.test(source.sha256) ||
      !Number.isFinite(source.duration_seconds) || source.duration_seconds < MIN_VIDEO_SECONDS) invalidWire();

  let normalized: Readonly<OwnerSeedanceEditorNormalizedParameters>;
  try { normalized = normalizeOwnerSeedanceEditorParameters(input); } catch { return invalidWire(); }
  const settings = Object.freeze({
    n: 1 as const,
    model_type: MODEL_TYPE,
    mode: "edit" as const,
    aspect_ratio: "adaptive" as const,
    resolution: normalized.intent.resolution,
    video_duration: 0 as const,
    generate_audio: false as const,
    file_urls: Object.freeze([Object.freeze({ type: "video" as const, url: source.url })])
  });
  const wire: Readonly<OwnerSeedanceEditorWireInput> = Object.freeze({
    ai_name: AI_NAME,
    prompt: normalized.intent.prompt,
    settings
  });
  const profileSha256 = getOwnerSeedanceEditorSourceProfile().source_sha256;
  const semanticIntent = Object.freeze({
    model_id: MODEL_ID,
    prompt: normalized.intent.prompt,
    resolution: normalized.intent.resolution,
    source_sha256: source.sha256,
    source_duration_seconds: source.duration_seconds
  });
  return Object.freeze({
    status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const,
    model_id: MODEL_ID,
    profile_sha256: profileSha256,
    wire,
    source_input_duration_context: Object.freeze({
      seconds: source.duration_seconds,
      authority: "CAPTURED_SOURCE_METADATA_NOT_PROVIDER_RECEIPT" as const
    }),
    cost_projection: "UNKNOWN" as const,
    intent_fingerprint: schemaHash(semanticIntent),
    wire_fingerprint: schemaHash(wire),
    reference_binding: "ONE_CAPTURED_VIDEO_NO_FRAME_REFERENCES" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactSource(value: unknown): OwnerSeedanceEditorCapturedSource {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidWire();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const required = ["url", "sha256", "duration_seconds"] as const;
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key as typeof required[number]) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidWire();
    const source = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) source[key] = descriptors[key]!.value;
    if (typeof source.url !== "string" || typeof source.sha256 !== "string" || typeof source.duration_seconds !== "number") invalidWire();
    return Object.freeze({ url: source.url, sha256: source.sha256, duration_seconds: source.duration_seconds });
  } catch { return invalidWire(); }
}

function invalidWire(): never {
  throw new OwnerSeedanceEditorWireError("INVALID_WIRE_CANDIDATE");
}
