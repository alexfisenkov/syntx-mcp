import { types } from "node:util";
import { isTrustedOwnerWan26R2vOriginalProbeResult, type OwnerWan26R2vOriginalProbeResult } from "./owner-wan26-r2v-original-probe.js";

const MODELS = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
export const OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY = Object.freeze({
  policy_id: "OWNER_WAN26_R2V_SELECTED_VIDEO_FRAME_POLICY_V1",
  aggregate_selected_seconds: 5,
  rounding: "LOCAL_CFR_FRAME_NEAREST_HALF_UP_NOT_UI_PROOF",
  kind: "LOCAL_SELECTION_METADATA_ONLY_NOT_PROVIDER_OR_GENERATION_PROOF"
} as const);

export interface OwnerWan26R2vVideoSelectionInput {
  readonly original: Readonly<OwnerWan26R2vOriginalProbeResult>;
  readonly start_seconds: number;
  readonly end_seconds: number;
  readonly total_reference_count: number;
}
export interface OwnerWan26R2vVideoSelectionMetadata {
  readonly model_id: typeof MODELS[number]; readonly source_sha256: string; readonly source_policy_id: string;
  readonly selection_policy_id: typeof OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.policy_id;
  readonly frame_rate: Readonly<{ numerator: number; denominator: number }>;
  readonly requested_start_seconds: number; readonly requested_end_seconds: number;
  readonly effective_start_frame: number; readonly effective_end_frame: number;
  readonly effective_start_seconds: number; readonly effective_end_seconds: number;
  readonly frame_count: number; readonly duration_seconds: number; readonly source_duration_seconds: number;
  readonly total_reference_count: number; readonly per_video_cap_seconds: number;
  readonly rounding_policy: typeof OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.rounding;
  readonly generation_permit: false; readonly owner_upload_binding: "NOT_ESTABLISHED";
}
export class OwnerWan26R2vVideoSelectionError extends Error {
  constructor() { super("WAN 2.6 R2V selected-video bounds are invalid."); this.name = "OwnerWan26R2vVideoSelectionError"; }
}
const live = new WeakMap<object, Readonly<{ original: object; metadata: Readonly<OwnerWan26R2vVideoSelectionMetadata> }>>();

/** Creates a local CFR frame selection tied to one still-live genuine original receipt. */
export function validateOwnerWan26R2vVideoSelection(input: unknown): Readonly<OwnerWan26R2vVideoSelectionMetadata> {
  const r = exactInput(input), { original, start_seconds, end_seconds, total_reference_count } = r;
  if (!isTrustedOwnerWan26R2vOriginalProbeResult(original) || !MODELS.includes(original.model_id) ||
      !Number.isSafeInteger(total_reference_count) || total_reference_count < 1 || total_reference_count > 5 ||
      !Number.isFinite(start_seconds) || !Number.isFinite(end_seconds) || start_seconds < 0 || end_seconds <= start_seconds) return invalid();
  const { duration_seconds: duration, frame_rate: rate, decoded_frame_count: decoded } = original.metadata;
  if (!Number.isFinite(duration) || duration < 1 || duration > 30 || !Number.isSafeInteger(decoded) || decoded < 1 ||
      !Number.isSafeInteger(rate.numerator) || !Number.isSafeInteger(rate.denominator) || rate.numerator < 1 || rate.denominator < 1) return invalid();
  const source = ratio(duration), start = ratio(start_seconds), end = ratio(end_seconds), n = BigInt(rate.numerator), d = BigInt(rate.denominator);
  if (compare(end, source) > 0 || start.numerator < 0n) return invalid();
  const first = rounded(start, n, d), after = rounded(end, n, d), count = after - first;
  if (first < 0n || count < 1n || after > BigInt(decoded) ||
      count * d * BigInt(total_reference_count) > BigInt(OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.aggregate_selected_seconds) * n ||
      after * d * source.denominator > source.numerator * n || after > BigInt(Number.MAX_SAFE_INTEGER)) return invalid();
  const metadata = Object.freeze({ model_id: original.model_id, source_sha256: original.source_sha256, source_policy_id: original.source_policy_id,
    selection_policy_id: OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.policy_id,
    frame_rate: Object.freeze({ numerator: rate.numerator, denominator: rate.denominator }),
    requested_start_seconds: start_seconds, requested_end_seconds: end_seconds,
    effective_start_frame: Number(first), effective_end_frame: Number(after),
    effective_start_seconds: Number(first * d) / rate.numerator, effective_end_seconds: Number(after * d) / rate.numerator,
    frame_count: Number(count), duration_seconds: Number(count * d) / rate.numerator, source_duration_seconds: duration,
    total_reference_count, per_video_cap_seconds: 5 / total_reference_count,
    rounding_policy: OWNER_WAN26_R2V_VIDEO_SELECTION_POLICY.rounding,
    generation_permit: false as const, owner_upload_binding: "NOT_ESTABLISHED" as const });
  live.set(metadata, Object.freeze({ original, metadata })); return metadata;
}
export function getOwnerWan26R2vVideoSelectionMetadata(original: unknown, selection: unknown): Readonly<OwnerWan26R2vVideoSelectionMetadata> | null {
  if (!isTrustedOwnerWan26R2vOriginalProbeResult(original) || !selection || typeof selection !== "object" || types.isProxy(selection)) return null;
  const entry = live.get(selection); return entry?.original === original && isTrustedOwnerWan26R2vOriginalProbeResult(original) ? entry.metadata : null;
}
function exactInput(value: unknown): OwnerWan26R2vVideoSelectionInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return invalid();
  try { const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d), req = ["original", "start_seconds", "end_seconds", "total_reference_count"];
    if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== 4 || keys.some((k) =>
      typeof k !== "string" || !req.includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) return invalid();
    return { original: d.original!.value, start_seconds: d.start_seconds!.value, end_seconds: d.end_seconds!.value, total_reference_count: d.total_reference_count!.value } as OwnerWan26R2vVideoSelectionInput;
  } catch { return invalid(); }
}
function ratio(x: number): { numerator: bigint; denominator: bigint } { const [m = "0", e] = x.toString().toLowerCase().split("e"), exp = Number(e ?? 0), p = m.indexOf("."), scale = (p < 0 ? 0 : m.length - p - 1) - exp, v = BigInt(m.replace(".", "")); return scale <= 0 ? { numerator: v * 10n ** BigInt(-scale), denominator: 1n } : { numerator: v, denominator: 10n ** BigInt(scale) }; }
function compare(a: { numerator: bigint; denominator: bigint }, b: { numerator: bigint; denominator: bigint }): number { const x = a.numerator * b.denominator - b.numerator * a.denominator; return x < 0n ? -1 : x > 0n ? 1 : 0; }
function rounded(s: { numerator: bigint; denominator: bigint }, n: bigint, d: bigint): bigint { const x = s.numerator * n, y = s.denominator * d; return (2n * x + y) / (2n * y); }
function invalid(): never { throw new OwnerWan26R2vVideoSelectionError(); }
