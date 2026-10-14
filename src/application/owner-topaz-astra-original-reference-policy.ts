import { createHash } from "node:crypto";
import { types } from "node:util";
import { getOwnerTopazAstraSourceProfile, type OwnerTopazAstraModelId } from "./owner-topaz-astra-source-profile.js";

export const OWNER_TOPAZ_ASTRA_ORIGINAL_LOCAL_PARSER_BOUND = Object.freeze({
  max_bytes: 52_428_800,
  policy: "SOURCE_UI_BOUND_LOCAL_RESOURCE_LIMIT_NOT_PROVIDER_LIMIT"
} as const);

export interface OwnerTopazAstraOriginalInput {
  readonly model_id: OwnerTopazAstraModelId;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly bytes: Uint8Array;
  /** Caller-reported metadata only; this helper does not parse/decode the media stream. */
  readonly reported_duration_seconds: number;
  readonly reported_frame_count: number;
}

export interface OwnerTopazAstraValidatedOriginal {
  readonly model_id: OwnerTopazAstraModelId;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly reported_duration_seconds: number;
  readonly reported_frame_count: number;
  readonly container_check: "ISO_BMFF_FTYP_HEADER_ONLY";
  readonly metadata_confidence: "CALLER_REPORTED_NOT_PROBED";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerTopazAstraOriginalReferencePolicyError extends Error {
  constructor(readonly code: "INVALID_ORIGINAL" | "ORIGINAL_LOCAL_LIMIT_EXCEEDED") {
    super("Topaz Astra original video did not satisfy the local input policy.");
    this.name = "OwnerTopazAstraOriginalReferencePolicyError";
  }
}

/** Applies pinned source UI bounds and a shallow ISO-BMFF signature check; no upload or owner binding occurs. */
export function validateOwnerTopazAstraOriginalInput(input: unknown): Readonly<OwnerTopazAstraValidatedOriginal> {
  let owned: Uint8Array | undefined;
  try {
    const value = exactInput(input);
    const profile = getOwnerTopazAstraSourceProfile(value.model_id);
    if (!profile || typeof value.filename !== "string" || !isSafeFilename(value.filename) ||
        (value.mime_type !== "video/mp4" && value.mime_type !== "video/quicktime") ||
        !(profile.input.accepted_file_types as readonly string[]).includes(value.mime_type) ||
        !Number.isFinite(value.reported_duration_seconds) || value.reported_duration_seconds <= 0 ||
        value.reported_duration_seconds > profile.input.max_video_duration_seconds ||
        !Number.isSafeInteger(value.reported_frame_count) || value.reported_frame_count < 1 ||
        value.reported_frame_count > profile.input.max_frame_count ||
        types.isProxy(value.bytes) || !(value.bytes instanceof Uint8Array) ||
        (!Buffer.isBuffer(value.bytes) && Object.getPrototypeOf(value.bytes) !== Uint8Array.prototype)) invalid();
    if (value.bytes.byteLength < 16) invalid();
    if (value.bytes.byteLength > Math.min(profile.input.max_file_size_bytes, OWNER_TOPAZ_ASTRA_ORIGINAL_LOCAL_PARSER_BOUND.max_bytes)) limit();
    owned = new Uint8Array(value.bytes.byteLength);
    owned.set(value.bytes);
    const view = new DataView(owned.buffer, owned.byteOffset, owned.byteLength);
    const boxSize = view.getUint32(0, false);
    const boxType = String.fromCharCode(owned[4]!, owned[5]!, owned[6]!, owned[7]!);
    if (boxSize < 16 || boxSize > owned.byteLength || boxType !== "ftyp") invalid();
    const result: OwnerTopazAstraValidatedOriginal = Object.freeze({
      model_id: value.model_id, filename: value.filename, mime_type: value.mime_type,
      size: owned.byteLength, sha256: `sha256:${createHash("sha256").update(owned).digest("hex")}`,
      reported_duration_seconds: value.reported_duration_seconds, reported_frame_count: value.reported_frame_count,
      container_check: "ISO_BMFF_FTYP_HEADER_ONLY", metadata_confidence: "CALLER_REPORTED_NOT_PROBED",
      dispatch_allowed: false, runtime_usable: false, backend_acceptance: "UNPROVEN"
    });
    owned.fill(0); owned = undefined;
    return result;
  } catch (error) {
    owned?.fill(0);
    if (error instanceof OwnerTopazAstraOriginalReferencePolicyError) throw error;
    invalid();
  }
}

interface ExactInput {
  model_id: OwnerTopazAstraModelId; filename: string; mime_type: unknown; bytes: Uint8Array;
  reported_duration_seconds: number; reported_frame_count: number;
}
function exactInput(input: unknown): ExactInput {
  if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) invalid();
  const proto = Object.getPrototypeOf(input), descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  const required = ["model_id", "filename", "mime_type", "bytes", "reported_duration_seconds", "reported_frame_count"];
  if ((proto !== Object.prototype && proto !== null) || keys.length !== required.length || keys.some((key) =>
      typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  if (typeof result.model_id !== "string" || typeof result.filename !== "string" ||
      typeof result.reported_duration_seconds !== "number" || typeof result.reported_frame_count !== "number") invalid();
  return result as unknown as ExactInput;
}
function isSafeFilename(value: string): boolean {
  return value.length > 0 && value.length <= 255 && value === value.trim() && value !== "." && value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(value) && !/[. ]$/u.test(value);
}
function invalid(): never { throw new OwnerTopazAstraOriginalReferencePolicyError("INVALID_ORIGINAL"); }
function limit(): never { throw new OwnerTopazAstraOriginalReferencePolicyError("ORIGINAL_LOCAL_LIMIT_EXCEEDED"); }
