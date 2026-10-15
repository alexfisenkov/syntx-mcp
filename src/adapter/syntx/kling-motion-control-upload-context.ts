import type { OwnerKlingMotionControlImageMimeType } from "../../application/owner-kling-motion-control-image-policy.js";
import type { OwnerKlingMotionControlVideoMimeType } from "../../application/owner-kling-motion-control-video-probe.js";

interface OwnerKlingMotionControlUploadContextBase {
  readonly status: "uploaded";
  readonly model_id: "kling_motion_control";
  readonly destination: "uploaded";
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
  readonly input_acceptance: "UPLOAD_REFERENCE_RECEIVED_PROVIDER_ACCEPTANCE_UNVERIFIED";
}

export interface OwnerKlingMotionControlImageUploadContext extends OwnerKlingMotionControlUploadContextBase {
  readonly media_type: "image";
  readonly mime_type: OwnerKlingMotionControlImageMimeType;
  readonly width: number;
  readonly height: number;
}

export interface OwnerKlingMotionControlVideoUploadContext extends OwnerKlingMotionControlUploadContextBase {
  readonly media_type: "video";
  readonly mime_type: OwnerKlingMotionControlVideoMimeType;
  readonly duration_seconds: number;
  readonly source_sha256: string;
}

export type OwnerKlingMotionControlUploadContext =
  | OwnerKlingMotionControlImageUploadContext
  | OwnerKlingMotionControlVideoUploadContext;
