import { createHash } from "node:crypto";
import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerVeoOmniReferenceProfile,
  normalizeOwnerVeoOmniReferenceGenerationInput,
  type OwnerVeoOmniReferenceGenerationInput,
  type OwnerVeoOmniReferenceInputType
} from "./owner-veo-omni-reference-profile.js";

const REFERENCE_KEYS = Object.freeze(["reference_handle", "kind", "url"] as const);
const MAX_PROMPT_LENGTH = 50_000;
const MIN_PROMPT_LENGTH = 8;
const RAW_WHITESPACE_CONTROL = /[\p{White_Space}\p{Cc}]/u;

export interface OwnerVeoOmniReferenceWireFile {
  readonly type: "image" | "video";
  readonly url: string;
}

export interface OwnerVeoOmniReferenceWireCandidate {
  readonly status: "SOURCE_BOUND_REFERENCE_WIRE_CANDIDATE";
  readonly profile_sha256: string;
  readonly ai_name: "veo3";
  readonly prompt: string;
  readonly settings: Readonly<{
    model_type: "veo_omni";
    type: OwnerVeoOmniReferenceInputType;
    upscale: 0 | 1 | 2 | 3;
    aspect_ratio: "16:9" | "9:16";
    video_duration: 4 | 6 | 8 | 10;
    file_urls: readonly OwnerVeoOmniReferenceWireFile[];
  }>;
  readonly cost_parameters: Readonly<{
    upscale: 0 | 1 | 2 | 3;
    video_duration: 4 | 6 | 8 | 10;
    mode?: "video_ref";
  }>;
  readonly input_reference_count: number;
  readonly wire_reference_count: number;
  readonly wire_fingerprint: string;
  readonly generation_permit: false;
}

interface OwnedReferenceRecord {
  readonly reference_handle: string;
  readonly kind: "image" | "video";
  readonly url: string;
}

/**
 * Builds a private source-shaped candidate from a Task 2 request and future
 * internal store records. This validates shape and URL safety only; it is not
 * evidence of reference ownership, native authority, or a generation permit.
 */
export function buildOwnerVeoOmniReferenceWire(input: unknown, references: unknown): OwnerVeoOmniReferenceWireCandidate {
  const normalized = normalizeOwnerVeoOmniReferenceGenerationInput(input);
  const records = snapshotReferences(references);
  if (records.length !== normalized.reference_handles.length ||
      records.some((record, index) => record.reference_handle !== normalized.reference_handles[index])) invalidReferenceWire();
  validateModeKinds(normalized.input_type, records);

  const expandedPrompt = renderOwnedMentions(normalized, records);
  if (!isWellFormedUnicode(expandedPrompt) || hasControl(expandedPrompt) ||
      [...expandedPrompt.trim()].length < MIN_PROMPT_LENGTH || [...expandedPrompt].length > MAX_PROMPT_LENGTH) invalidReferenceWire();

  const fileUrls = firstWinsFileUrls(records);
  const settings = deepFreeze({
    model_type: "veo_omni" as const,
    type: normalized.input_type,
    upscale: normalized.upscale,
    aspect_ratio: normalized.aspect_ratio,
    video_duration: normalized.video_duration,
    file_urls: fileUrls
  });
  const hasVideoReference = records.some((record) => record.kind === "video");
  const costParameters = deepFreeze({
    upscale: normalized.upscale,
    video_duration: normalized.video_duration,
    ...(normalized.input_type === "references" && hasVideoReference ? { mode: "video_ref" as const } : {})
  });
  const aiName = getOwnerVeoOmniReferenceProfile().identity.ai_name;
  const profileSha256 = getOwnerVeoOmniReferenceProfile().profile_sha256;
  const fingerprintLayout = [
    "owner-veo-omni-reference-wire-v1",
    profileSha256,
    { ai_name: aiName, prompt: expandedPrompt, settings },
    costParameters
  ];
  const wireFingerprint = `sha256:${createHash("sha256").update(JSON.stringify(fingerprintLayout), "utf8").digest("hex")}`;

  return deepFreeze({
    status: "SOURCE_BOUND_REFERENCE_WIRE_CANDIDATE" as const,
    profile_sha256: profileSha256,
    ai_name: aiName,
    prompt: expandedPrompt,
    settings,
    cost_parameters: costParameters,
    input_reference_count: records.length,
    wire_reference_count: fileUrls.length,
    wire_fingerprint: wireFingerprint,
    generation_permit: false as const
  });
}

function snapshotReferences(value: unknown): readonly OwnedReferenceRecord[] {
  if (!Array.isArray(value) || types.isProxy(value)) invalidReferenceWire();
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalidReferenceWire();
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 1 || lengthDescriptor.value > 7 || Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1) invalidReferenceWire();
    const records: OwnedReferenceRecord[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) invalidReferenceWire();
      records.push(snapshotReferenceRecord(descriptor.value));
    }
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
        !isWellFormedUnicode(fields.url) || RAW_WHITESPACE_CONTROL.test(fields.url) || /[<>]/u.test(fields.url) ||
        !isSafeUploadReferenceUrl(fields.url)) invalidReferenceWire();
    return Object.freeze({
      reference_handle: fields.reference_handle,
      kind: fields.kind,
      url: fields.url
    });
  } catch {
    invalidReferenceWire();
  }
}

function validateModeKinds(inputType: OwnerVeoOmniReferenceInputType, records: readonly OwnedReferenceRecord[]): void {
  const imageCount = records.reduce((count, record) => count + Number(record.kind === "image"), 0);
  const videoCount = records.length - imageCount;
  if (inputType === "image") {
    if (imageCount < 1 || imageCount > 2 || videoCount !== 0) invalidReferenceWire();
    return;
  }
  const imagesOnly = videoCount === 0 && imageCount >= 1 && imageCount <= 7;
  const oneVideo = videoCount === 1 && imageCount >= 0 && imageCount <= 5;
  if (!imagesOnly && !oneVideo) invalidReferenceWire();
}

function renderOwnedMentions(
  input: OwnerVeoOmniReferenceGenerationInput,
  records: readonly OwnedReferenceRecord[]
): string {
  if (input.reference_mentions.length === 0) return input.prompt;
  let rendered = "";
  let cursor = 0;
  for (const mention of input.reference_mentions) {
    const record = records[mention.index - 1];
    if (!record || mention.start_utf16 < cursor || mention.end_utf16 <= mention.start_utf16) invalidReferenceWire();
    rendered += input.prompt.slice(cursor, mention.start_utf16);
    rendered += `<<<${record.url}>>>`;
    cursor = mention.end_utf16;
  }
  rendered += input.prompt.slice(cursor);
  return rendered;
}

function firstWinsFileUrls(records: readonly OwnedReferenceRecord[]): readonly OwnerVeoOmniReferenceWireFile[] {
  const seen = new Set<string>();
  const fileUrls: OwnerVeoOmniReferenceWireFile[] = [];
  for (const record of records) {
    const key = JSON.stringify([record.kind, record.url]);
    if (seen.has(key)) continue;
    seen.add(key);
    fileUrls.push(Object.freeze({ type: record.kind, url: record.url }));
  }
  return Object.freeze(fileUrls);
}

function hasControl(value: string): boolean {
  // Match the closed input profile: preserve LF/CR/TAB in ordinary prompts.
  // URL validation above remains deliberately stricter (no whitespace at all).
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
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
