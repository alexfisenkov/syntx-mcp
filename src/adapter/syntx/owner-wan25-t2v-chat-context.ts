import type { OWNER_WAN25_T2V_MODEL_ID } from "../../application/owner-wan25-t2v-parameters.js";

/** Nominal context for one newly created, text-only owner Wan 2.5 T2V chat. */
export interface OwnerWan25T2vChatContext {
  readonly status: "created";
  readonly attempt_id: string;
  readonly chat_uuid: string;
  readonly model_id: typeof OWNER_WAN25_T2V_MODEL_ID;
  readonly scope: "video";
  readonly generation_permit: false;
}
