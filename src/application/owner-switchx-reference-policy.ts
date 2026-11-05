import { createHash } from "node:crypto";
import { types } from "node:util";
import { inspectBoundedOwnerImageBytesWithMax } from "./owner-image-reference-input-validator.js";
import { probeOwnerCurrentVideoMetadata } from "./owner-current-video-metadata.js";

export type OwnerSwitchxReferenceRole = "style_image" | "image_mask" | "video_mask";
export interface OwnerSwitchxValidatedReference {
  readonly role: OwnerSwitchxReferenceRole; readonly filename: string; readonly mime_type: string;
  readonly size: number; readonly sha256: string; readonly width: number; readonly height: number;
  readonly generation_permit: false;
}
const receipts = new WeakMap<object, { bytes: Buffer; descriptor: Readonly<OwnerSwitchxValidatedReference> }>();
export async function validateOwnerSwitchxReference(value: unknown, ffprobePath: string, signal?: AbortSignal): Promise<Readonly<OwnerSwitchxValidatedReference>> {
  let bytes: Buffer | undefined;
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid();
    const ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds), expected = ["role", "filename", "mime_type", "bytes"];
    if (keys.length !== 4 || keys.some(k => typeof k !== "string" || !expected.includes(k) || !Object.hasOwn(ds[k]!, "value") || !ds[k]!.enumerable)) invalid();
    const role = ds.role!.value, filename = ds.filename!.value, mime = ds.mime_type!.value, raw = ds.bytes!.value;
    if (!["style_image", "image_mask", "video_mask"].includes(role) || typeof filename !== "string" || !filename || filename === "." || filename === ".." ||
        filename !== filename.trim() || Buffer.byteLength(filename) > 255 || /[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(filename) ||
        typeof mime !== "string" || !raw || types.isProxy(raw) || !(raw instanceof Uint8Array) ||
        Object.getPrototypeOf(raw) !== Uint8Array.prototype && Object.getPrototypeOf(raw) !== Buffer.prototype ||
        ["buffer", "byteLength", "byteOffset", "length"].some(k => Object.hasOwn(raw, k))) invalid();
    const maximum = role === "video_mask" ? 100 * 1024 * 1024 : 27_525_120;
    if (raw.byteLength < 1 || raw.byteLength > maximum) invalid(); bytes = Buffer.from(raw);
    let width: number, height: number, canonicalMime = mime;
    if (role === "video_mask") {
      if (mime !== "video/mp4" && mime !== "video/quicktime") invalid();
      const measured = await probeOwnerCurrentVideoMetadata({ bytes, mime_type: mime }, { ffprobePath, maximumBytes: maximum }, signal);
      try { width = measured.width; height = measured.height;
        if (width * height < 100_000 || width * height > 2_770_000 || measured.duration_seconds <= 0 || measured.duration_seconds > 10 || ["ap4h", "ap4x"].includes(measured.codec_tag)) invalid();
      } finally { measured.bytes.fill(0); }
    } else {
      if (role === "image_mask" && mime !== "image/png" || role === "style_image" && !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mime)) invalid();
      const inspected = inspectBoundedOwnerImageBytesWithMax(bytes, maximum); width = inspected.width; height = inspected.height; canonicalMime = inspected.mime;
      if (inspected.mime !== mime && !(mime === "image/jpg" && inspected.mime === "image/jpeg") || width > 8400 || height > 8000 || width * height > 52_500_000) invalid();
    }
    const receipt: OwnerSwitchxValidatedReference = Object.freeze({ role, filename, mime_type: canonicalMime, size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), width, height, generation_permit: false });
    receipts.set(receipt, { bytes, descriptor: receipt }); bytes = undefined; return receipt;
  } catch { return invalid(); } finally { bytes?.fill(0); }
}
export function readValidatedOwnerSwitchxReference(value: unknown): (OwnerSwitchxValidatedReference & { readonly bytes: Uint8Array }) | null {
  if (!value || typeof value !== "object" || types.isProxy(value)) return null; const state = receipts.get(value);
  if (!state || !Object.isFrozen(value) || createHash("sha256").update(state.bytes).digest("hex") !== state.descriptor.sha256) return null;
  return Object.freeze({ ...state.descriptor, bytes: new Uint8Array(state.bytes) });
}
export function releaseValidatedOwnerSwitchxReference(value: unknown): boolean {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false; const state = receipts.get(value); if (!state) return false;
  state.bytes.fill(0); return receipts.delete(value);
}
function invalid(): never { throw new Error("INVALID_SWITCHX_REFERENCE"); }
