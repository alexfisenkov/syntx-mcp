/** Native context returned only by the fixed Seedance Editor chat constructor. */
export interface OwnerSeedanceEditorChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly model_id: "seedance-2.5-editor";
  readonly scope: "tool_video_inpaint";
  readonly generation_permit: false;
}
