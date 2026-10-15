import {
  readOwnerWan26R2vVideoUploadReferenceForClient as readOwnerWan26R2vVideoUploadReferenceForClientInternal
} from "./chat-http-client.js";

/** Safe metadata only; the uploaded video URL remains in the exact native client's private WeakMap. */
export interface OwnerWan26R2vSelectedVideoUploadContext {
  readonly status: "uploaded";
  readonly model_id: "wan_26_r2v" | "wan_26_r2v_flash";
  readonly media_type: "selected_video";
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly source_sha256: string;
  readonly width: number;
  readonly height: number;
  readonly frame_count: number;
  readonly frame_rate: Readonly<{ readonly numerator: number; readonly denominator: number }>;
  readonly selected_duration_seconds: number;
  readonly video_duration_seconds: number;
}

/** Returns the opaque URL reference only to the same live native client that minted this context. */
export function readOwnerWan26R2vVideoUploadReferenceForClient(
  client: unknown,
  context: unknown
): Readonly<{ readonly url: string }> | null {
  return readOwnerWan26R2vVideoUploadReferenceForClientInternal(client, context);
}
