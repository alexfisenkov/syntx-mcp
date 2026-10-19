import type { OwnerRunwayI2vModelId } from "../../application/owner-runway-i2v-parameters.js";

/** Native context returned only by the fixed Runway I2V video-chat constructor. */
export interface OwnerRunwayI2vChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: OwnerRunwayI2vModelId;
  readonly scope: "video";
  readonly generation_permit: false;
}
