import {
  readOwnerWan26I2vUploadReferenceForClient as readOwnerWan26I2vUploadReferenceForClientInternal
} from "./chat-http-client.js";

export interface OwnerWan26I2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: "wan_26_i2v" | "wan_26_i2v_flash";
  readonly media_type: "image";
  readonly mime_type: "image/jpeg" | "image/png" | "image/bmp" | "image/webp";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export interface OwnerWan26I2vAudioUploadContext {
  readonly status: "uploaded";
  readonly model_id: "wan_26_i2v" | "wan_26_i2v_flash";
  readonly media_type: "audio";
  readonly mime_type: "audio/mpeg" | "audio/wav";
  readonly size: number;
  readonly sha256: string;
  readonly measured_duration_seconds: number;
}

export type OwnerWan26I2vUploadContext = OwnerWan26I2vImageUploadContext | OwnerWan26I2vAudioUploadContext;

/** Exposes the private upload URL only to the exact client that minted this frozen context. */
export function readOwnerWan26I2vUploadReferenceForClient(
  client: unknown,
  context: unknown
): Readonly<{ readonly url: string }> | null {
  return readOwnerWan26I2vUploadReferenceForClientInternal(client, context);
}
