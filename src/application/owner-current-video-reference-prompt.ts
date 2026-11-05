import type { OwnerCurrentVideoReferenceMetadata, OwnerCurrentVideoReferenceModelId } from "./owner-current-video-reference-types.js";
/** Pure preflight for the same closed source aliases later rendered from owned native references. */
export function validateOwnerCurrentVideoPromptAliases(prompt:string,_model:OwnerCurrentVideoReferenceModelId,
 mode:"DISABLED_LITERAL"|"ENABLED_ALIASES",_metadata:readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]):void {
 if(typeof prompt!=="string"||prompt.length>50_000||/<<<https?:\/\//iu.test(prompt)||!(mode==="DISABLED_LITERAL"||mode==="ENABLED_ALIASES"))invalid();
}
function invalid():never{throw new Error("OWNER_CURRENT_VIDEO_PROMPT_INVALID");}
