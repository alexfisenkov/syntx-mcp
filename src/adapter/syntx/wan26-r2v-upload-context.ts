import {
  readOwnerWan26R2vUploadReferenceForClient as readOwnerWan26R2vUploadReferenceForClientInternal
} from "./chat-http-client.js";
import {
  OWNER_WAN26_R2V_IMAGE_POLICY,
  type OwnerWan26R2vImageCanonicalMimeType,
  type OwnerWan26R2vModelId
} from "../../application/owner-wan26-r2v-image-policy.js";

/** Safe metadata for one uploaded WAN26 R2V image; its URL remains in a private client-bound WeakMap. */
export interface OwnerWan26R2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: OwnerWan26R2vModelId;
  readonly media_type: "image";
  readonly filename: string;
  readonly mime_type: OwnerWan26R2vImageCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly source_policy_id: typeof OWNER_WAN26_R2V_IMAGE_POLICY.policy_id;
  readonly dispatch_allowed: false;
  readonly generation_permit: false;
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

/** Exposes a private upload URL only to the genuine context's exact minting client. */
export function readOwnerWan26R2vUploadReferenceForClient(
  client: unknown,
  context: unknown
): Readonly<{ readonly url: string }> | null {
  return readOwnerWan26R2vUploadReferenceForClientInternal(client, context);
}

export function isOwnerWan26R2vImageUploadContextForClient(client: unknown, context: unknown): boolean {
  return readOwnerWan26R2vUploadReferenceForClient(client, context) !== null;
}
