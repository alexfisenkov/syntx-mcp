import type {
  OwnerKlingKeyframesImageCanonicalMimeType,
  OwnerKlingKeyframesImageSourceMimeType
} from "../../application/owner-kling-keyframes-image-policy.js";

/** Safe upload metadata; the native R2 URL and provider file ID remain private. */
export interface OwnerKlingKeyframesUploadContext {
  readonly status: "uploaded";
  readonly model_id: "kling_keyframes";
  readonly destination: "uploaded";
  readonly filename: string;
  readonly source_mime_type: OwnerKlingKeyframesImageSourceMimeType;
  readonly mime_type: OwnerKlingKeyframesImageCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly input_acceptance: "UPLOAD_REFERENCE_RECEIVED_PROVIDER_ACCEPTANCE_UNVERIFIED";
}
