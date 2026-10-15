import {
  readOwnerWan27R2vUploadReferenceForClient as readOwnerWan27R2vUploadReferenceForClientInternal
} from "./chat-http-client.js";

/** Safe metadata for one WAN 2.7 R2V image upload; its private R2 URL stays in a WeakMap. */
export interface OwnerWan27R2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: "wan_27_r2v";
  readonly media_type: "image";
  readonly mime_type: "image/jpeg" | "image/png" | "image/bmp" | "image/webp";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

/** Metadata for one already cropped video; source SHA remains provenance, not upload or dispatch authority. */
export interface OwnerWan27R2vSelectedVideoUploadContext {
  readonly status: "uploaded";
  readonly model_id: "wan_27_r2v";
  readonly media_type: "selected_video";
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  /** Frame-derived selected segment duration; distinct from the measured container duration. */
  readonly selected_duration_seconds: number;
  readonly video_duration_seconds: number;
  readonly source_sha256: string;
}

export type OwnerWan27R2vUploadContext = OwnerWan27R2vImageUploadContext | OwnerWan27R2vSelectedVideoUploadContext;

/** Exposes a private R2 URL only to a consumer holding this exact context and its minting client. */
export function readOwnerWan27R2vUploadReferenceForClient(
  client: unknown,
  context: unknown
): Readonly<{ readonly url: string }> | null {
  return readOwnerWan27R2vUploadReferenceForClientInternal(client, context);
}
