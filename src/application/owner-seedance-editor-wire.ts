import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerSeedanceEditorCurrentUiObservation,
  getOwnerSeedanceEditorCurrentSource,
  getOwnerSeedanceEditorFrameSource,
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
    readonly model_type: typeof MODEL_TYPE;
    readonly mode: "edit";
    readonly aspect_ratio: "adaptive";
    readonly resolution: OwnerSeedanceEditorNormalizedParameters["intent"]["resolution"];
    readonly video_duration: 0;
    readonly generate_audio: true;
    readonly file_urls: readonly Readonly<{ readonly type: "video" | "image"; readonly url: string }>[];
  }>;
}

export interface OwnerSeedanceEditorWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: typeof MODEL_ID;
  readonly profile_sha256: string;
  readonly current_ui_observation_sha256: string;
  readonly current_source_sha256: string;
  readonly frame_source_sha256?: string;
  readonly wire: Readonly<OwnerSeedanceEditorWireInput>;
  readonly source_input_duration_context: Readonly<{
    readonly seconds: number;
    readonly authority: "CAPTURED_SOURCE_METADATA_NOT_PROVIDER_RECEIPT";
  }>;
  readonly cost_projection: "UNKNOWN";
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "ONE_CAPTURED_VIDEO_NO_FRAME_REFERENCES" | "ONE_CAPTURED_VIDEO_WITH_FRAME_REFERENCES";
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
export function buildOwnerSeedanceEditorWire(input: unknown, sourceInput: unknown, framesInput: readonly Readonly<{url: string; sha256: string; time_seconds: number}>[] = []): Readonly<OwnerSeedanceEditorWireCandidate> {
  const source = exactSource(sourceInput);
  if (!isSafeUploadReferenceUrl(source.url) || !SHA256.test(source.sha256) ||
      !Number.isFinite(source.duration_seconds) || source.duration_seconds < MIN_VIDEO_SECONDS) invalidWire();

  let normalized: Readonly<OwnerSeedanceEditorNormalizedParameters>;
  try { normalized = normalizeOwnerSeedanceEditorParameters(input); } catch { return invalidWire(); }
  if (!Array.isArray(framesInput) || types.isProxy(framesInput) || framesInput.length > 30) invalidWire();
  const seen = new Set<string>([source.url]);
  const frames = framesInput.map(frame => {
    const f = exactFrame(frame);
    if (!isSafeUploadReferenceUrl(f.url) || /[|<>\u0000-\u001f\u007f]/u.test(f.url) || seen.has(f.url) || !SHA256.test(f.sha256) || !Number.isFinite(f.time_seconds) ||
        f.time_seconds < 0 || f.time_seconds > source.duration_seconds) invalidWire();
    seen.add(f.url); return f;
  });
  const prompt = normalized.intent.prompt + frames.map(f => ` <<<${f.url}|${frameTimecode(f.time_seconds)}>>>`).join("");
  // The history reader accepts at most 20,000 UTF-16 units; fail before quote or dispatch.
  if (prompt.length > 20_000) invalidWire();
  const settings = Object.freeze({
    model_type: MODEL_TYPE,
    mode: "edit" as const,
    aspect_ratio: "adaptive" as const,
    resolution: normalized.intent.resolution,
    video_duration: 0 as const,
    generate_audio: true as const,
    file_urls: Object.freeze([Object.freeze({ type: "video" as const, url: source.url }),
      ...frames.map(f => Object.freeze({ type: "image" as const, url: f.url }))])
  });
  const wire: Readonly<OwnerSeedanceEditorWireInput> = Object.freeze({
    ai_name: AI_NAME,
    prompt,
    settings
  });
  const profileSha256 = getOwnerSeedanceEditorSourceProfile().source_sha256;
  const currentUiObservation = getOwnerSeedanceEditorCurrentUiObservation();
  const semanticIntent = Object.freeze({
    model_id: MODEL_ID,
    prompt: normalized.intent.prompt,
    resolution: normalized.intent.resolution,
    source_sha256: source.sha256,
    source_duration_seconds: source.duration_seconds,
    ...(frames.length ? { frames: frames.map(f => ({ sha256: f.sha256, time_seconds: f.time_seconds })) } : {})
  });
  return Object.freeze({
    status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const,
    model_id: MODEL_ID,
    profile_sha256: profileSha256,
    current_ui_observation_sha256: currentUiObservation.observation_sha256,
    current_source_sha256: getOwnerSeedanceEditorCurrentSource().source_sha256,
    ...(frames.length ? { frame_source_sha256: getOwnerSeedanceEditorFrameSource().source_sha256 } : {}),
    wire,
    source_input_duration_context: Object.freeze({
      seconds: source.duration_seconds,
      authority: "CAPTURED_SOURCE_METADATA_NOT_PROVIDER_RECEIPT" as const
    }),
    cost_projection: "UNKNOWN" as const,
    intent_fingerprint: schemaHash(semanticIntent),
    wire_fingerprint: schemaHash(wire),
    reference_binding: frames.length ? "ONE_CAPTURED_VIDEO_WITH_FRAME_REFERENCES" as const : "ONE_CAPTURED_VIDEO_NO_FRAME_REFERENCES" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

/** Native dispatch guard: candidate identity and the current static submit and historical UI audio flag must agree. */
export function isOwnerSeedanceEditorWireCurrentUiAligned(value: unknown): value is OwnerSeedanceEditorWireCandidate {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try {
    const candidate = value as OwnerSeedanceEditorWireCandidate;
    const wire = candidate.wire;
    const settings = wire?.settings;
    const observation = getOwnerSeedanceEditorCurrentUiObservation();
    return candidate.status === "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" &&
      candidate.model_id === MODEL_ID && candidate.profile_sha256 === getOwnerSeedanceEditorSourceProfile().source_sha256 &&
      candidate.current_ui_observation_sha256 === observation.observation_sha256 &&
      candidate.current_source_sha256 === getOwnerSeedanceEditorCurrentSource().source_sha256 &&
      candidate.wire_fingerprint === schemaHash(wire) && wire.ai_name === AI_NAME &&
      typeof wire.prompt === "string" && !Reflect.has(settings, "n") && settings.model_type === MODEL_TYPE &&
      settings.mode === "edit" && settings.aspect_ratio === "adaptive" && isResolution(settings.resolution) &&
      settings.video_duration === 0 && settings.generate_audio === true && Array.isArray(settings.file_urls) &&
      settings.file_urls.length >= 1 && settings.file_urls.length <= 31 && settings.file_urls[0]?.type === "video" &&
      settings.file_urls.every((item, index) => item.type === (index === 0 ? "video" : "image") && isSafeUploadReferenceUrl(item.url)) &&
      new Set(settings.file_urls.map(item => item.url)).size === settings.file_urls.length &&
      (settings.file_urls.length === 1 ? candidate.frame_source_sha256 === undefined : candidate.frame_source_sha256 === getOwnerSeedanceEditorFrameSource().source_sha256) &&
      candidate.reference_binding === (settings.file_urls.length === 1 ? "ONE_CAPTURED_VIDEO_NO_FRAME_REFERENCES" : "ONE_CAPTURED_VIDEO_WITH_FRAME_REFERENCES");
  } catch { return false; }
}

function exactFrame(value: unknown): Readonly<{url: string; sha256: string; time_seconds: number}> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidWire();
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== 3 ||
      keys.some(k => typeof k !== "string" || !["url", "sha256", "time_seconds"].includes(k) || !("value" in d[k]!) || !d[k]!.enumerable) ||
      typeof d.url?.value !== "string" || typeof d.sha256?.value !== "string" || typeof d.time_seconds?.value !== "number") invalidWire();
  return Object.freeze({url: d.url.value, sha256: d.sha256.value, time_seconds: d.time_seconds.value});
}

function frameTimecode(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
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

function isResolution(value: unknown): value is OwnerSeedanceEditorNormalizedParameters["intent"]["resolution"] {
  return value === "480p" || value === "720p" || value === "1080p";
}
