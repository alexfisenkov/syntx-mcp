import {isAbsolute} from "node:path";
export function readOwnerSwitchxVideoOperatorConfiguration(enabled:boolean,destination:unknown,path:unknown,ffmpeg:unknown=undefined):
  Readonly<{uploadDestination:"uploaded"|"hidden";ffprobePath:string;ffmpegPath?:string}>|undefined {
  if(!enabled)return undefined;
  if((destination!=="uploaded"&&destination!=="hidden")||typeof path!=="string"||!isAbsolute(path)||
    path.length>1024||/[\u0000-\u001f\u007f]/u.test(path) || (ffmpeg!==undefined && (typeof ffmpeg!=="string" || !isAbsolute(ffmpeg) || ffmpeg!==ffmpeg.trim() || ffmpeg.length>1024 || /[\u0000-\u001f\u007f]/u.test(ffmpeg))))throw new Error("OWNER_SWITCHX_VIDEO_OPERATOR_CONFIGURATION_INVALID");
  return Object.freeze({uploadDestination:destination,ffprobePath:path,...(typeof ffmpeg==="string"?{ffmpegPath:ffmpeg}:{})});
}
