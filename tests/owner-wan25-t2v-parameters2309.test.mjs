import assert from 'node:assert/strict';
import test from 'node:test';
const modulePath='../dist/src/application/owner-wan25-t2v-parameters.js';
const tuple={model_id:'wan_25_t2v_preview',prompt:'A blue cube turns slowly.',resolution:'720P',aspect_ratio:'1:1',video_duration:5,prompt_extend:false,seed:null};
test('2309 WAN25 T2V projects explicit source-backed controls and an empty media list',async()=>{
 const m=await import(modulePath);const r=m.normalizeOwnerWan25T2vParameters(tuple);
 assert.deepEqual(r.intent,tuple);assert.deepEqual(r.settings,{model_type:tuple.model_id,resolution:'720P',aspect_ratio:'1:1',video_duration:5,prompt_extend:false,seed:null,file_urls:[]});
 assert.equal(r.dispatch_allowed,false);assert.equal(r.backend_acceptance,'UNPROVEN');
 for(const resolution of ['480P','720P','1080P'])for(const duration of [5,10])assert.equal(m.normalizeOwnerWan25T2vParameters({...tuple,resolution,video_duration:duration}).settings.video_duration,duration);
 assert.equal(m.loadOwnerWan25T2vRuntimeCatalog().catalog.get(tuple.model_id).ai_name,'wan_video');
});
test('2309 WAN25 rejects hidden/default/foreign/media controls and invalid cross-field combinations',async()=>{
 const {normalizeOwnerWan25T2vParameters:n}=await import(modulePath);
 for(const patch of [{model_id:'wan_26_t2v'},{video_duration:6},{resolution:'480p'},{resolution:'480P',aspect_ratio:'4:3'},{seed:0},{seed:undefined},{audio:'file'},{native_audio:false},{prompt:' '},{prompt:'x'.repeat(1501)},{prompt:'\ud800'}])assert.throws(()=>n({...tuple,...patch}));
 assert.equal(n({...tuple,aspect_ratio:'4:3'}).settings.aspect_ratio,'4:3');
});
test('2309 WAN25 rejects proxies and accessors without reading getters',async()=>{
 const {normalizeOwnerWan25T2vParameters:n}=await import(modulePath);let reads=0;
 const bad={...tuple};Object.defineProperty(bad,'prompt',{enumerable:true,get(){reads++;return 'x';}});
 assert.throws(()=>n(bad));assert.equal(reads,0);assert.throws(()=>n(new Proxy(tuple,{})));
});
