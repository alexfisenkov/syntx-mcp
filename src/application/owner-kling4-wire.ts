import { createHash } from "node:crypto";
import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerKling4SourceProfile,
  normalizeOwnerKling4Parameters,
  type NormalizedOwnerKling4Parameters,
  type OwnerKling4AspectRatio,
  type OwnerKling4Mode,
  type OwnerKling4ParametersModelId
} from "./owner-kling4-parameters.js";

const REFERENCE_KEYS = Object.freeze(["reference_handle", "kind", "url", "sha256", "duration_seconds"] as const);
const MAX_REFERENCE_COUNT = 15;
const MAX_PROMPT_UTF16_UNITS = 24_000;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const RAW_WHITESPACE_CONTROL = /[\p{White_Space}\p{Cc}]/u;

export interface OwnerKling4WireFile {
  readonly type: "image" | "video";
  readonly url: string;
}

export interface OwnerKling4KeyframesCostParameters {
  readonly mode: OwnerKling4Mode;
  readonly version: "4.0";
  readonly video_duration: number;
}

export interface OwnerKling4OmniCostParameters extends OwnerKling4KeyframesCostParameters {
  readonly duration: 0 | string;
}

export type OwnerKling4CostParameters = OwnerKling4KeyframesCostParameters | OwnerKling4OmniCostParameters;

export interface OwnerKling4WireCandidate {
  readonly status: "SOURCE_ONLY_KLING4_WIRE_CANDIDATE";
  readonly profile_sha256: string;
  readonly ai_name: "kling";
  readonly prompt: string;
  readonly settings: Readonly<{
    model_type: OwnerKling4ParametersModelId;
    version: "4.0";
    mode: OwnerKling4Mode;
    aspect_ratio: OwnerKling4AspectRatio;
    video_duration: number;
    native_audio: boolean;
    file_urls: readonly OwnerKling4WireFile[];
  }>;
  readonly cost_parameters: OwnerKling4CostParameters;
  readonly input_reference_count: number;
  readonly wire_reference_count: number;
  readonly wire_fingerprint: string;
  readonly intent_fingerprint: string;
  readonly runtime_usable: false;
  readonly dispatch_allowed: false;
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
}

interface OwnedReferenceRecord {
  readonly reference_handle: string;
  readonly kind: "image" | "video";
  readonly url: string;
  readonly sha256: string;
  readonly duration_seconds: number | null;
}

/**
 * Builds a private, source-only K4 wire candidate from normalized controls
 * and ordered owned-reference records. Video duration must already be the
 * selected cost duration from fresh owner-side track analysis; this pure
 * composer validates its range but cannot establish freshness or ownership.
 */
export function buildOwnerKling4Wire(input: unknown, references: unknown): Readonly<OwnerKling4WireCandidate> {
  const normalized = normalizeOwnerKling4Parameters(input);
  const records = snapshotReferences(references, normalized);
  validateReferenceProfile(normalized, records);

  const expandedPrompt = renderOwnedMentions(normalized, records);
  if (expandedPrompt.length > MAX_PROMPT_UTF16_UNITS || !isWellFormedUnicode(expandedPrompt) || hasControl(expandedPrompt)) {
    invalidReferenceWire();
  }

  const fileUrls = firstWinsFileUrls(records);
  const settings = deepFreeze({
    model_type: normalized.model_id,
    version: normalized.version,
    mode: normalized.mode,
    aspect_ratio: normalized.aspect_ratio,
    video_duration: normalized.video_duration,
    native_audio: normalized.native_audio,
    file_urls: fileUrls
  });
  const costParameters = buildCostParameters(normalized, records);
  const profileSha256 = getOwnerKling4SourceProfile(normalized.model_id).source_sha256;
  const wireFingerprint = fingerprint([
    "owner-kling4-reference-wire-v1",
    profileSha256,
    { ai_name: "kling", prompt: expandedPrompt, settings },
    costParameters
  ]);
  const intentFingerprint = fingerprint([
    "owner-kling4-semantic-intent-v1",
    profileSha256,
    {
      model_id: normalized.model_id,
      version: normalized.version,
      mode: normalized.mode,
      aspect_ratio: normalized.aspect_ratio,
      video_duration: normalized.video_duration,
      native_audio: normalized.native_audio,
      prompt: normalized.prompt,
      references: records.map((record) => ({ kind: record.kind, sha256: record.sha256 }))
    }
  ]);

  return deepFreeze({
    status: "SOURCE_ONLY_KLING4_WIRE_CANDIDATE" as const,
    profile_sha256: profileSha256,
    ai_name: "kling" as const,
    prompt: expandedPrompt,
    settings,
    cost_parameters: costParameters,
    input_reference_count: records.length,
    wire_reference_count: fileUrls.length,
    wire_fingerprint: wireFingerprint,
    intent_fingerprint: intentFingerprint,
    runtime_usable: false as const,
    dispatch_allowed: false as const,
    provider_acceptance: "UNPROVEN" as const,
    generation_permit: false as const
  });
}

function snapshotReferences(value: unknown, normalized: Readonly<NormalizedOwnerKling4Parameters>): readonly OwnedReferenceRecord[] {
  if (!Array.isArray(value) || types.isProxy(value)) invalidReferenceWire();
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalidReferenceWire();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_REFERENCE_COUNT ||
        Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1 ||
        lengthDescriptor.value !== normalized.reference_handles.length) invalidReferenceWire();

    const records: OwnedReferenceRecord[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalidReferenceWire();
      records.push(snapshotReferenceRecord(descriptor.value));
    }
    const handles = normalized.reference_handles;
    if (records.some((record, index) => record.reference_handle !== handles[index])) invalidReferenceWire();
    return Object.freeze(records);
  } catch {
    invalidReferenceWire();
  }
}

function snapshotReferenceRecord(value: unknown): OwnedReferenceRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidReferenceWire();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== REFERENCE_KEYS.length ||
        keys.some((key) => typeof key !== "string" || !REFERENCE_KEYS.includes(key as typeof REFERENCE_KEYS[number]) ||
          descriptors[key]?.enumerable !== true || !Object.hasOwn(descriptors[key]!, "value"))) invalidReferenceWire();

    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) fields[key] = descriptors[key]!.value;
    if (typeof fields.reference_handle !== "string" ||
        (fields.kind !== "image" && fields.kind !== "video") || typeof fields.url !== "string" ||
        typeof fields.sha256 !== "string" || !SHA256_HEX.test(fields.sha256) ||
        !isWellFormedUnicode(fields.url) || RAW_WHITESPACE_CONTROL.test(fields.url) || /[<>]/u.test(fields.url) ||
        !isSafeUploadReferenceUrl(fields.url)) invalidReferenceWire();

    if (fields.kind === "image") {
      if (fields.duration_seconds !== null) invalidReferenceWire();
    } else if (typeof fields.duration_seconds !== "number" || !Number.isFinite(fields.duration_seconds) ||
        fields.duration_seconds < 3 || fields.duration_seconds > 30) invalidReferenceWire();

    return Object.freeze({
      reference_handle: fields.reference_handle,
      kind: fields.kind,
      url: fields.url,
      sha256: fields.sha256,
      duration_seconds: fields.duration_seconds
    });
  } catch {
    invalidReferenceWire();
  }
}

function validateReferenceProfile(
  normalized: Readonly<NormalizedOwnerKling4Parameters>,
  records: readonly OwnedReferenceRecord[]
): void {
  const seenContent = new Set<string>();
  let imageCount = 0;
  let videoCount = 0;
  let totalVideoDuration = 0;
  for (const record of records) {
    const contentKey = JSON.stringify([record.kind, record.sha256]);
    if (seenContent.has(contentKey)) invalidReferenceWire();
    seenContent.add(contentKey);
    if (record.kind === "image") imageCount += 1;
    else {
      videoCount += 1;
      totalVideoDuration += record.duration_seconds!;
    }
  }

  if (normalized.model_id === "kling_4_keyframes") {
    if (videoCount !== 0 || imageCount !== records.length) invalidReferenceWire();
    return;
  }
  if (imageCount > 10 || videoCount > 5 || !Number.isFinite(totalVideoDuration) || totalVideoDuration > 30) {
    invalidReferenceWire();
  }
}

function renderOwnedMentions(
  input: Readonly<NormalizedOwnerKling4Parameters>,
  records: readonly OwnedReferenceRecord[]
): string {
  if (input.reference_mentions.length === 0) return input.prompt;
  let rendered = "";
  let cursor = 0;
  for (const mention of input.reference_mentions) {
    const record = records[mention.index - 1];
    if (!record || mention.start_utf16 < cursor || mention.end_utf16 <= mention.start_utf16 ||
        mention.end_utf16 > input.prompt.length) invalidReferenceWire();
    rendered += input.prompt.slice(cursor, mention.start_utf16);
    rendered += `<<<${record.url}>>>`;
    cursor = mention.end_utf16;
  }
  rendered += input.prompt.slice(cursor);
  return rendered;
}

function firstWinsFileUrls(records: readonly OwnedReferenceRecord[]): readonly OwnerKling4WireFile[] {
  const seen = new Set<string>();
  const fileUrls: OwnerKling4WireFile[] = [];
  for (const record of records) {
    const key = JSON.stringify([record.kind, record.url]);
    if (seen.has(key)) continue;
    seen.add(key);
    fileUrls.push(Object.freeze({ type: record.kind, url: record.url }));
  }
  return Object.freeze(fileUrls);
}

function buildCostParameters(
  normalized: Readonly<NormalizedOwnerKling4Parameters>,
  records: readonly OwnedReferenceRecord[]
): OwnerKling4CostParameters {
  const base = {
    mode: normalized.mode,
    version: normalized.version,
    video_duration: normalized.video_duration
  } as const;
  if (normalized.model_id === "kling_4_keyframes") return deepFreeze(base);
  const selectedVideoDuration = records.reduce((sum, record) =>
    record.kind === "video" ? sum + record.duration_seconds! : sum, 0);
  return deepFreeze({ duration: selectedVideoDuration === 0 ? 0 : selectedVideoDuration.toFixed(2), ...base });
}

function fingerprint(layout: readonly unknown[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(layout), "utf8").digest("hex")}`;
}

function hasControl(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) return false;
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function invalidReferenceWire(): never {
  throw new Error("INVALID_REFERENCE_WIRE");
}
