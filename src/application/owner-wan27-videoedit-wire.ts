import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerWan27VideoEditSourceProfile,
  normalizeOwnerWan27VideoEditParameters,
  type OwnerWan27VideoEditAudioSetting,
  type OwnerWan27VideoEditAspectRatio,
  type OwnerWan27VideoEditDurationMode,
  type OwnerWan27VideoEditNativeSettings,
  type OwnerWan27VideoEditResolution
} from "./owner-wan27-videoedit-parameters.js";

const MODEL_ID = "wan_27_videoedit" as const;
const AI_NAME = "wan_video" as const;
const HANDLE = /^wan27_videoedit_reference_[0-9a-f-]{36}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_REFERENCES = 5;
const MAX_IMAGES = 4;

export interface OwnerWan27VideoEditWireInput {
  readonly model_id: typeof MODEL_ID;
  readonly prompt: string;
  readonly resolution: OwnerWan27VideoEditResolution;
  readonly aspect_ratio: OwnerWan27VideoEditAspectRatio;
  readonly audio_setting: OwnerWan27VideoEditAudioSetting;
  readonly prompt_extend: boolean;
  readonly seed: number | null;
  readonly duration_mode: OwnerWan27VideoEditDurationMode;
  readonly custom_video_duration?: number;
}

/** Non-nominal metadata rows projected only inside the trusted preparation pipeline. */
export interface OwnerWan27VideoEditWireReferenceRow {
  readonly reference_handle: string;
  readonly kind: "image" | "video";
  readonly url: string;
  readonly sha256: string;
  readonly duration_seconds: number | null;
}

export interface OwnerWan27VideoEditWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly profile_sha256: string;
  readonly wire: Readonly<{
    readonly ai_name: typeof AI_NAME;
    readonly prompt: string;
    readonly settings: Readonly<OwnerWan27VideoEditNativeSettings & {
      readonly file_urls: readonly Readonly<{ readonly type: "image" | "video"; readonly url: string }>[];
    }>;
  }>;
  readonly cost_parameters: Readonly<{
    readonly resolution: OwnerWan27VideoEditResolution;
    readonly video_duration: number;
    readonly duration: number;
  }>;
  readonly files_mention: false;
  readonly source_input_duration_context: Readonly<{
    readonly seconds: number;
    readonly authority: "CAPTURED_REFERENCE_ROW_NOT_NOMINAL_RECEIPT";
  }>;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "SOURCE_ROWS_ONLY_NOT_NOMINAL";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerWan27VideoEditWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") {
    super("The owner WAN 2.7 Video Edit wire candidate is invalid.");
    this.name = "OwnerWan27VideoEditWireError";
  }
}

/** Builds a frozen source-only candidate; captured metadata rows do not confer dispatch authority. */
export function buildOwnerWan27VideoEditWire(input: unknown, referencesInput: unknown): Readonly<OwnerWan27VideoEditWireCandidate> {
  const fields = exactRecord(input, ["model_id", "prompt", "resolution", "aspect_ratio", "audio_setting", "prompt_extend",
    "seed", "duration_mode"], ["custom_video_duration"]);
  const references = snapshotReferences(referencesInput);
  if (fields.model_id !== MODEL_ID) invalid();

  let videoDurationSeconds: number | undefined;
  let imageCount = 0;
  const handles = new Set<string>(), typedUrls = new Set<string>(), contentHashes = new Set<string>();
  for (const reference of references) {
    if (!HANDLE.test(reference.reference_handle) || !SHA256.test(reference.sha256) ||
        !isSafeUploadReferenceUrl(reference.url)) invalid();
    if (handles.has(reference.reference_handle)) invalid();
    handles.add(reference.reference_handle);
    const typedUrl = JSON.stringify([reference.kind, reference.url]);
    if (typedUrls.has(typedUrl)) invalid();
    typedUrls.add(typedUrl);
    if (contentHashes.has(reference.sha256)) invalid();
    contentHashes.add(reference.sha256);

    if (reference.kind === "image") {
      if (reference.duration_seconds !== null) invalid();
      imageCount += 1;
    } else {
      if (videoDurationSeconds !== undefined || typeof reference.duration_seconds !== "number" ||
          !Number.isFinite(reference.duration_seconds) || reference.duration_seconds < 2 || reference.duration_seconds > 10) invalid();
      videoDurationSeconds = reference.duration_seconds;
    }
  }
  if (videoDurationSeconds === undefined || imageCount > MAX_IMAGES || references.length > MAX_REFERENCES) invalid();

  let normalized: ReturnType<typeof normalizeOwnerWan27VideoEditParameters>;
  try {
    normalized = normalizeOwnerWan27VideoEditParameters({
      ...fields,
      source_input_duration_seconds: videoDurationSeconds
    });
  } catch { invalid(); }
  const settings = Object.freeze({
    ...normalized.intent.settings,
    file_urls: Object.freeze(references.map((reference) => Object.freeze({ type: reference.kind, url: reference.url })))
  });
  const wire = Object.freeze({ ai_name: AI_NAME, prompt: normalized.intent.prompt, settings });
  const costParameters = Object.freeze({ resolution: settings.resolution, video_duration: settings.video_duration, duration: settings.duration });
  const profileSha256 = getOwnerWan27VideoEditSourceProfile().source_sha256;
  const semanticReferences = Object.freeze(references.map((reference) => Object.freeze({ kind: reference.kind, sha256: reference.sha256 })));
  const intentFingerprint = schemaHash(Object.freeze({ model_id: MODEL_ID, prompt: normalized.intent.prompt,
    settings: normalized.intent.settings, references: semanticReferences }));
  const wireFingerprint = schemaHash(wire);
  return Object.freeze({
    status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const,
    model_id: MODEL_ID,
    profile_sha256: profileSha256,
    wire,
    cost_parameters: costParameters,
    files_mention: false as const,
    source_input_duration_context: Object.freeze({
      seconds: videoDurationSeconds,
      authority: "CAPTURED_REFERENCE_ROW_NOT_NOMINAL_RECEIPT" as const
    }),
    intent_fingerprint: intentFingerprint,
    wire_fingerprint: wireFingerprint,
    reference_binding: "SOURCE_ROWS_ONLY_NOT_NOMINAL" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

interface SnapshottedReference extends OwnerWan27VideoEditWireReferenceRow {}

function snapshotReferences(value: unknown): readonly SnapshottedReference[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap; } catch { return invalid(); }
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || lengthDescriptor.enumerable !== false ||
      !Number.isSafeInteger(length) || length < 1 || length > MAX_REFERENCES || Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  const rows: SnapshottedReference[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalid();
    const fields = exactRecord(descriptor.value, ["reference_handle", "kind", "url", "sha256", "duration_seconds"]);
    if (typeof fields.reference_handle !== "string" || (fields.kind !== "image" && fields.kind !== "video") ||
        typeof fields.url !== "string" || typeof fields.sha256 !== "string" ||
        !(fields.duration_seconds === null || typeof fields.duration_seconds === "number")) invalid();
    rows.push(Object.freeze({ reference_handle: fields.reference_handle, kind: fields.kind, url: fields.url,
      sha256: fields.sha256, duration_seconds: fields.duration_seconds }));
  }
  return Object.freeze(rows);
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const allowed = [...required, ...optional];
    if ((prototype !== Object.prototype && prototype !== null) || required.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.length < required.length || keys.length > allowed.length || keys.some((key) =>
          typeof key !== "string" || !allowed.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalid(); }
}

function invalid(): never { throw new OwnerWan27VideoEditWireError("INVALID_WIRE_CANDIDATE"); }
