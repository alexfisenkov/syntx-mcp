import assert from "node:assert/strict";
import test from "node:test";
import { validateOwnerCurrentVideoReferenceSelection as validate, type OwnerCurrentVideoSelectionEntry } from "../src/application/owner-current-video-reference-policy.js";
const hash=`sha256:${"a".repeat(64)}`;
function entry(n:number,kind:OwnerCurrentVideoSelectionEntry["kind"],role:OwnerCurrentVideoSelectionEntry["role"],duration?:number):OwnerCurrentVideoSelectionEntry {
 return {reference_handle:`current_video_ref_00000000-0000-4000-8000-${String(n).padStart(12,"0")}`,kind,role,mime_type:"synthetic/test",size:1,sha256:hash,...(duration===undefined?{}:{duration_seconds:duration})};
}
test("current family selection applies source mode, count, ordering and measured totals",()=>{
 const first=entry(1,"image","first_frame"),last=entry(2,"image","last_frame"),audio=entry(3,"audio","audio",2),video=entry(4,"video","video",10),image=entry(5,"image","image");
 assert.doesNotThrow(()=>validate("seedance-2.0","frames",[first,last]));
 assert.throws(()=>validate("seedance-2.0","frames",[last,first]));
 assert.doesNotThrow(()=>validate("hailuo-3.0","frames",[last]));
 assert.throws(()=>validate("seedance-2.0","omni-references",[audio]));
 assert.doesNotThrow(()=>validate("seedance-2.0","omni-references",[audio,image,video]));
 assert.throws(()=>validate("seedance-2.5","extend",[image]));
 assert.doesNotThrow(()=>validate("seedance-2.5","extend",[video,image]));
 assert.throws(()=>validate("wan_30_edit","edit",[image]));
 assert.doesNotThrow(()=>validate("wan_30_edit","edit",[video,image,audio]));
 assert.throws(()=>validate("wan_30_reference","reference",[video,entry(6,"video","video",6)]));
 assert.throws(()=>validate("wan_30_reference","reference",[image,image]));
});
