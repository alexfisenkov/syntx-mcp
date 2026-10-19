import {isAbsolute} from "node:path";
export function readOwnerSwitchxVideoOperatorConfiguration(enabled:boolean,destination:unknown,path:unknown):
  Readonly<{uploadDestination:"uploaded"|"hidden";ffprobePath:string}>|undefined {
  if(!enabled)return undefined;
  if((destination!=="uploaded"&&destination!=="hidden")||typeof path!=="string"||!isAbsolute(path)||
    path.length>1024||/[\u0000-\u001f\u007f]/u.test(path))throw new Error("OWNER_SWITCHX_VIDEO_OPERATOR_CONFIGURATION_INVALID");
  return Object.freeze({uploadDestination:destination,ffprobePath:path});
}
