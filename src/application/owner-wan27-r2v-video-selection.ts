import { types } from "node:util";
import {
  isTrustedOwnerWan27R2vOriginalProbeResult,
  type OwnerWan27R2vOriginalProbeResult
} from "./owner-wan27-r2v-original-probe.js";

export const OWNER_WAN27_R2V_VIDEO_SELECTION_POLICY = Object.freeze({
  policy_id: "OWNER_WAN27_R2V_SELECTED_VIDEO_FRAME_POLICY_V1",
  max_video_references: 5,
  aggregate_selected_seconds: 5,
  kind: "LOCAL_SELECTION_METADATA_ONLY_NOT_PROVIDER_OR_GENERATION_PROOF"
} as const);

export interface OwnerWan27R2vVideoSelectionMetadata {
  readonly source_sha256: string;
  readonly source_policy_id: string;
  readonly frame_rate: Readonly<{ numerator: number; denominator: number }>;
  readonly requested_start_seconds: number;
  readonly requested_end_seconds: number;
  readonly effective_start_frame: number;
  readonly effective_end_frame: number;
  readonly effective_start_seconds: number;
  readonly effective_end_seconds: number;
  readonly frame_count: number;
  readonly duration_seconds: number;
  readonly video_reference_count: number;
  readonly per_video_cap_seconds: number;
  readonly generation_permit: false;
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly selection_crop: "NOT_PERFORMED";
}

export interface OwnerWan27R2vVideoSelectionInput {
  readonly original: Readonly<OwnerWan27R2vOriginalProbeResult>;
  readonly start_seconds: number;
  readonly end_seconds: number;
  readonly video_reference_count: number;
}

export class OwnerWan27R2vVideoSelectionError extends Error {
  constructor() { super("WAN 2.7 R2V selected-video bounds are invalid."); this.name = "OwnerWan27R2vVideoSelectionError"; }
}

const selections = new WeakMap<object, Readonly<{ original: object; metadata: Readonly<OwnerWan27R2vVideoSelectionMetadata> }>>();

/** Creates metadata bound to one live, genuine original-probe receipt; it does not crop or authorize media use. */
export function validateOwnerWan27R2vVideoSelection(input: unknown): Readonly<OwnerWan27R2vVideoSelectionMetadata> {
  const request = exactInput(input), { original, start_seconds, end_seconds, video_reference_count } = request;
  if (!isTrustedOwnerWan27R2vOriginalProbeResult(original) || !Number.isSafeInteger(video_reference_count) || video_reference_count < 1 || video_reference_count > 5 ||
      !Number.isFinite(start_seconds) || !Number.isFinite(end_seconds) || start_seconds < 0 || end_seconds <= start_seconds) return invalid();
  const { duration_seconds: sourceDuration, frame_rate: rate } = original.metadata;
  if (!Number.isFinite(sourceDuration) || sourceDuration < 1 || sourceDuration > 30 || !Number.isSafeInteger(rate.numerator) || !Number.isSafeInteger(rate.denominator) ||
      rate.numerator < 1 || rate.denominator < 1) return invalid();
  const source = ratio(sourceDuration), start = ratio(start_seconds), end = ratio(end_seconds), fpsN = BigInt(rate.numerator), fpsD = BigInt(rate.denominator);
  if (compare(end, source) > 0 || start.numerator < 0n) return invalid();
  const startFrameBig = roundedFrames(start, fpsN, fpsD), endFrameBig = roundedFrames(end, fpsN, fpsD), countBig = endFrameBig - startFrameBig;
  if (startFrameBig < 0n || countBig < 1n || startFrameBig > BigInt(Number.MAX_SAFE_INTEGER) || endFrameBig > BigInt(Number.MAX_SAFE_INTEGER) ||
      countBig * fpsD * BigInt(video_reference_count) > BigInt(OWNER_WAN27_R2V_VIDEO_SELECTION_POLICY.aggregate_selected_seconds) * fpsN ||
      endFrameBig > BigInt(original.metadata.decoded_frame_count) || endFrameBig * fpsD * source.denominator > source.numerator * fpsN) return invalid();
  const startFrame = Number(startFrameBig), endFrame = Number(endFrameBig), frameCount = Number(countBig);
  const metadata = Object.freeze({
    source_sha256: original.source_sha256, source_policy_id: original.source_policy_id,
    frame_rate: Object.freeze({ numerator: rate.numerator, denominator: rate.denominator }),
    requested_start_seconds: start_seconds, requested_end_seconds: end_seconds,
    effective_start_frame: startFrame, effective_end_frame: endFrame,
    effective_start_seconds: Number(startFrameBig * fpsD) / rate.numerator,
    effective_end_seconds: Number(endFrameBig * fpsD) / rate.numerator,
    frame_count: frameCount, duration_seconds: Number(countBig * fpsD) / rate.numerator,
    video_reference_count, per_video_cap_seconds: OWNER_WAN27_R2V_VIDEO_SELECTION_POLICY.aggregate_selected_seconds / video_reference_count,
    generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const, selection_crop: "NOT_PERFORMED" as const
  });
  selections.set(metadata, Object.freeze({ original, metadata }));
  return metadata;
}

/** A future crop/upload consumer must fetch this metadata against the same still-live receipt. */
export function getOwnerWan27R2vVideoSelectionMetadata(original: unknown, selection: unknown): Readonly<OwnerWan27R2vVideoSelectionMetadata> | null {
  if (!isTrustedOwnerWan27R2vOriginalProbeResult(original) || !selection || typeof selection !== "object" || types.isProxy(selection)) return null;
  const bound = selections.get(selection);
  return bound?.original === original ? bound.metadata : null;
}

function exactInput(input: unknown): OwnerWan27R2vVideoSelectionInput {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) return invalid();
  try {
    const d = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(d), required = ["original", "start_seconds", "end_seconds", "video_reference_count"];
    if ((Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) || keys.length !== 4 || keys.some((key) =>
      typeof key !== "string" || !required.includes(key) || !Object.hasOwn(d[key]!, "value") || d[key]!.enumerable !== true)) return invalid();
    return Object.freeze({ original: d.original!.value, start_seconds: d.start_seconds!.value,
      end_seconds: d.end_seconds!.value, video_reference_count: d.video_reference_count!.value }) as OwnerWan27R2vVideoSelectionInput;
  } catch { return invalid(); }
}

function ratio(value: number): Readonly<{ numerator: bigint; denominator: bigint }> {
  const [mantissa = "0", exponentText] = value.toString().toLowerCase().split("e"), exponent = Number(exponentText ?? 0);
  const point = mantissa.indexOf("."), fractionLength = point < 0 ? 0 : mantissa.length - point - 1;
  const digits = mantissa.replace(".", ""), scale = fractionLength - exponent, numerator = BigInt(digits);
  return scale <= 0 ? { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n } :
    { numerator, denominator: 10n ** BigInt(scale) };
}

function compare(a: Readonly<{ numerator: bigint; denominator: bigint }>, b: Readonly<{ numerator: bigint; denominator: bigint }>): number {
  const delta = a.numerator * b.denominator - b.numerator * a.denominator;
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}

function roundedFrames(seconds: Readonly<{ numerator: bigint; denominator: bigint }>, fpsN: bigint, fpsD: bigint): bigint {
  const numerator = seconds.numerator * fpsN, denominator = seconds.denominator * fpsD;
  return (2n * numerator + denominator) / (2n * denominator);
}

function invalid(): never { throw new OwnerWan27R2vVideoSelectionError(); }
