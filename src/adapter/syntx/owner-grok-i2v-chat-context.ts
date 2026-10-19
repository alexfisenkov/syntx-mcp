/** Native owner-bound context minted only by the fixed Grok I2V video-chat constructor. */
export interface OwnerGrokI2vChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "grok_i2v" | "grok_15_i2v";
  readonly scope: "video";
  readonly generation_permit: false;
}
