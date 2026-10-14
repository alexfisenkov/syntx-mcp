import {
  readOwnerHailuo02I2vUploadReferenceForClient as readOwnerHailuo02I2vUploadReferenceForClientInternal
} from "./chat-http-client.js";

/** Safe upload metadata; the R2 URL and upload receipt stay in a private WeakMap. */
export interface OwnerHailuo02I2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: "hailuo-02";
  readonly mime_type: "image/jpeg" | "image/png" | "image/webp";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

/** Returns a private URL only when the context was minted by this exact native client. */
export function readOwnerHailuo02I2vUploadReferenceForClient(
  client: unknown,
  context: unknown
): Readonly<{ readonly url: string }> | null {
  return readOwnerHailuo02I2vUploadReferenceForClientInternal(client, context);
}

/** Guard for consumers that need to establish client ownership without retaining the URL. */
export function isOwnerHailuo02I2vUploadContextForClient(client: unknown, context: unknown): boolean {
  return readOwnerHailuo02I2vUploadReferenceForClient(client, context) !== null;
}

