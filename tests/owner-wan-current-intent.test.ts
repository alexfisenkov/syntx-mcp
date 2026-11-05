import assert from "node:assert/strict";
import test from "node:test";
import {compileOwnerWanCurrentIntent,inspectOwnerWanCurrentIntent,normalizeOwnerWanCurrentInput} from "../src/application/owner-wan-current-intent.js";
import type {OwnerCurrentVideoReferenceMetadata} from "../src/application/owner-current-video-reference-types.js";
const hash=`sha256:${"a".repeat(64)}`;
const base={model_id:"wan_25_t2v_preview",prompt:"a quiet scene",resolution:"720P",aspect_ratio:"16:9",video_duration:5,prompt_extend:true,seed:null};
const audio:OwnerCurrentVideoReferenceMetadata={role:"audio",kind:"audio",mime_type:"audio/mpeg",size:100,sha256:hash,duration_seconds:3};
const image:OwnerCurrentVideoReferenceMetadata={role:"image",kind:"image",mime_type:"image/png",size:100,sha256:hash,width:640,height:480};
const clip:OwnerCurrentVideoReferenceMetadata={role:"first_clip",kind:"video",mime_type:"video/mp4",size:100,sha256:hash,width:640,height:480,duration_seconds:4.2};
const normalized=(x:Record<string,unknown>)=>normalizeOwnerWanCurrentInput(x);
test("WAN current source controls keep blank prompt blocked and bind 25 audio/seed",()=>{
 assert.throws(()=>normalized({...base,prompt:"   "}));
 assert.throws(()=>normalized({...base,video_duration:5.5}));
 const d=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized({...base,seed:123}),[audio]));assert.ok(d);
 assert.equal(d.settings.seed,123);assert.equal(d.settings.model_type,"wan_25_t2v_preview");assert.equal(d.reference_prompt_mode,"DISABLED_LITERAL");
 assert.deepEqual(d.cost_parameters,{resolution:"720P",video_duration:5});
 const i=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized({...base,model_id:"wan_25_i2v_preview"}),[image,audio]));assert.ok(i);
 assert.equal(i.reference_metadata.length,2);assert.equal(i.mode,"i2v");
});
test("WAN27 video-first length/audio guard and R2V measured duration",()=>{
 const {aspect_ratio:_hidden,...rest}=base;const fields={...rest,model_id:"wan_27_i2v",video_duration:5};
 const d=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized(fields),[clip]));assert.ok(d);assert.equal(d.settings.aspect_ratio,"1:1");
 assert.equal(d.settings.native_audio,true);
 const imageFirst={...image,role:"first_frame" as const};const voiced=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized(fields),[imageFirst,audio]));assert.ok(voiced);assert.equal(voiced.settings.native_audio,false);
 assert.throws(()=>compileOwnerWanCurrentIntent(normalized({...fields,video_duration:4}),[clip]));
 assert.throws(()=>compileOwnerWanCurrentIntent(normalized(fields),[clip,audio]));
 const video={...clip,role:"video" as const,duration_seconds:3.125};
 const r=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized({...base,model_id:"wan_27_r2v",video_duration:10}),[image,video,audio]));assert.ok(r);
 assert.equal(r.cost_parameters.duration,3.13);assert.equal(r.reference_prompt_mode,"ENABLED_ALIASES");
});
test("WAN30 current enforces measured duration and document prompt-extend condition",()=>{
 const fields={...base,model_id:"wan_30_omni",aspect_ratio:"adaptive",video_duration:25,native_audio:true,rendering_speed:"prime"};
 const video={...clip,role:"video" as const,duration_seconds:5};const doc:OwnerCurrentVideoReferenceMetadata={role:"file",kind:"file",mime_type:"application/pdf",size:20,sha256:hash};
 const d=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized(fields),[image,video,doc]));assert.ok(d);assert.equal(d.cost_parameters.duration,5);
 assert.throws(()=>compileOwnerWanCurrentIntent(normalized({...fields,prompt_extend:false}),[image,video,doc]));
 assert.throws(()=>compileOwnerWanCurrentIntent(normalized({...fields,video_duration:26}),[image,video,doc]));
 assert.equal(inspectOwnerWanCurrentIntent({}),null);
});
test("WAN27 videoedit derives preserved duration and allows finite custom duration",()=>{
 const input={...base,model_id:"wan_27_videoedit",duration_mode:"preserve_input",audio_setting:"origin"};const {video_duration:_ignored,...withoutDuration}=input;
 const video={...clip,role:"video" as const,duration_seconds:4.25};const preserved=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized(withoutDuration),[video,image]));
 assert.ok(preserved);assert.equal(preserved.settings.video_duration,4.25);assert.equal(preserved.settings.audio_setting,"origin");assert.equal(preserved.cost_parameters.duration,4.25);
 const custom=inspectOwnerWanCurrentIntent(compileOwnerWanCurrentIntent(normalized({...withoutDuration,duration_mode:"custom",video_duration:3.5}),[video,image]));assert.ok(custom);assert.equal(custom.settings.video_duration,3.5);
 assert.throws(()=>compileOwnerWanCurrentIntent(normalized({...withoutDuration,duration_mode:"custom",video_duration:4.5}),[video,image]));
});
