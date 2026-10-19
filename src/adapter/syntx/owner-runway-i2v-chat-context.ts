/** Native context returned only by the fixed Runway I2V video-chat constructor. */
export interface OwnerRunwayI2vChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "4genfirstframeimage" | "turbo4genfirstframeimage";
  readonly scope: "video";
  readonly generation_permit: false;
}
