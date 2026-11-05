/** Opaque metadata-only receipt; native client owns the private URL and authority. */
export type OwnerSwitchxReferenceRole = "style_image" | "image_mask" | "video_mask";
export interface OwnerSwitchxReferenceContext {
  readonly status: "uploaded"; readonly model_id: "switchx"; readonly attempt_id: string;
  readonly role: OwnerSwitchxReferenceRole; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly generation_permit: false; readonly provider_acceptance: "UNPROVEN";
}
export { readOwnerSwitchxReferenceContext } from "./chat-http-client.js";
