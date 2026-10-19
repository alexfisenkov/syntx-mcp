import type { OwnerWan27I2vUploadDestination } from "../application/owner-wan27-i2v-reference-service.js";
export function readOwnerWan27I2vFlag(value:unknown):boolean{
  if(value===undefined||value===""||value==="0")return false;
  if(value==="1")return true;
  throw new Error("Invalid SYNTX_OWNER_WAN27_I2V configuration.");
}
export function readOwnerWan27I2vOperatorConfiguration(enabled:boolean,destination:unknown):
  Readonly<{uploadDestination:OwnerWan27I2vUploadDestination}>|undefined{
  if(!enabled)return undefined;
  if(destination!=="uploaded"&&destination!=="hidden")throw new Error("Invalid SYNTX_OWNER_WAN27_I2V_UPLOAD_DESTINATION configuration.");
  return Object.freeze({uploadDestination:destination});
}
