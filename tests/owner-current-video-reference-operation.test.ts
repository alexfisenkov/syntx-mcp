import assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {SyntxChatHttpClient} from "../src/adapter/syntx/chat-http-client.js";
import {OwnerCurrentVideoReferenceStore} from "../src/application/owner-current-video-reference-store.js";
import {OwnerCurrentVideoNativeService} from "../src/adapter/syntx/owner-current-video-reference-native.js";
import {normalizeOwnerHailuo3CurrentInput,compileOwnerHailuo3CurrentIntent} from "../src/application/owner-hailuo3-current-intent.js";
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(640,16);b.writeUInt32BE(640,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
const attempt="link_current_reference_0000000001", model="hailuo-3.0",url1="https://r2.syntx.ai/image-1.png",url2="https://r2.syntx.ai/image-2.png";
async function fixture(lostAck:boolean,missingEcho:boolean,swapped=false,duplicate=false,wrongModel=false,sameUrl=false){let uploads=0,posts=0,gets=0,now=1_700_000_000_000,linked=true;let sent:Record<string,unknown>|undefined;const secondUrl=sameUrl?url1:url2;
 const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-video-credential");}},fetchImpl:async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??"GET";
  if(url.pathname.endsWith("/chats/upload-files")){uploads++;return Response.json({files:[{url:uploads===1?url1:secondUrl}]});}
  if(url.pathname.endsWith("/chats")&&method==="POST")return Response.json({uuid:"current-chat"});
  if(url.pathname.endsWith("/video/generate")&&method==="POST"){posts++;sent=JSON.parse(String(init?.body));if(lostAck)throw Error("lost synthetic ACK");return Response.json({id:"owner1"});}
  const ref=(id:string,u:string)=>({id,message_id:"owner1",object_type:"image",object_url:u,model_type:wrongModel&&id==="ref2"?"other-model":model});
  const media=missingEcho?[ref("ref1",url1)]:duplicate?[ref("ref1",url1),ref("ref2",url1)]:swapped?[ref("ref2",secondUrl),ref("ref1",url1)]:[ref("ref1",url1),ref("ref2",secondUrl)];
  const owner={id:"owner1",chat_id:7,author_id:123,message_object:[{id:"text1",message_id:"owner1",object_type:"text",object_text:"quiet scene",model_type:model},...media]};
  const bot={id:"bot1",chat_id:7,author_id:-1,message_object:[{id:"video1",message_id:"bot1",object_type:"video",model_type:model}]};
  if(url.pathname.endsWith("/messages")){gets++;return Response.json({messages:[owner,bot],pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_previous:false,has_next:false}});}
  if(url.pathname.endsWith("/bot1")){gets++;return Response.json({...bot,message_object:[{...bot.message_object[0],object_url:"https://r2.syntx.ai/result.mp4",completed:true}]});}
  throw Error("unexpected synthetic request");}});
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:linked?"LINKED":"UNLINKED",expires_at:null,linked};}};
 const binding={tenant_id:"tenant",subject:"owner"},store=new OwnerCurrentVideoReferenceStore({binding,linkService:links as never,resolveClient:()=>client,ffprobePath:join(process.cwd(),"ffprobe"),now:()=>now});
 const native=new OwnerCurrentVideoNativeService({binding,linkService:links as never,references:store,resolveClient:()=>client});
 const one=await store.upload({attemptId:attempt,model_id:model,filename:"one.png",mime_type:"image/png",content_base64:png().toString("base64")});
 const two=await store.upload({attemptId:attempt,model_id:model,filename:"two.png",mime_type:"image/png",content_base64:png().toString("base64")});
 const prepared=await store.prepare({attemptId:attempt,model_id:model,mode:"frames",references:[{reference_handle:one.reference_handle,role:"first_frame"},{reference_handle:two.reference_handle,role:"last_frame"}]});
 const intent=compileOwnerHailuo3CurrentIntent(normalizeOwnerHailuo3CurrentInput({model_id:model,mode:"frames",prompt:"quiet scene",resolution:"768p",video_duration:5,aspect_ratio:"auto"}),prepared.metadata);
 return {native,store,prepared,intent,get sent(){return sent;},get posts(){return posts;},get gets(){return gets;},advance(){now+=16*60_000;},unlink(){linked=false;}};
}
test("current native sends one closed typed bundle and observes every owned reference",async()=>{const f=await fixture(false,false);try{
 await assert.rejects(()=>f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:{}}));
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});assert.equal((await f.native.dispatch(op)).status,"acknowledged");
 assert.equal(f.posts,1);const body=f.sent as {settings:{file_urls:Array<{type:string}>}};assert.deepEqual(body.settings.file_urls.map(x=>x.type),["first_frame","last_frame"]);
 f.advance();const result=await f.native.observe(op);assert.equal(result.status,"complete");assert.equal(result.artifacts.length,1);assert.equal(f.gets,2);
 }finally{await f.native.close();await f.store.close();}});
test("lost ACK reconciles only by GET; missing owner reference remains unverified",async()=>{const f=await fixture(true,true);try{
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});await assert.rejects(()=>f.native.dispatch(op),/OUTCOME_UNKNOWN/u);
 assert.equal((await f.native.observe(op)).status,"unverified");assert.equal(f.posts,1);assert.equal(f.gets,1);
 }finally{await f.native.close();await f.store.close();}});
test("lost ACK can be recovered only after every owned reference echo matches",async()=>{const f=await fixture(true,false);try{
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});await assert.rejects(()=>f.native.dispatch(op),/OUTCOME_UNKNOWN/u);
 assert.equal((await f.native.observe(op)).status,"complete");assert.equal(f.posts,1);assert.equal(f.gets,2);
 }finally{await f.native.close();await f.store.close();}});
test("permuted owner reference echoes match without changing sender order",async()=>{const f=await fixture(false,false,true);try{
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});await f.native.dispatch(op);
 assert.equal((await f.native.observe(op)).status,"complete");assert.deepEqual((f.sent as {settings:{file_urls:Array<{type:string}>}}).settings.file_urls.map(r=>r.type),["first_frame","last_frame"]);assert.equal(f.posts,1);assert.equal(f.gets,2);
 }finally{await f.native.close();await f.store.close();}});
test("duplicated owner reference cannot replace a different reference",async()=>{const f=await fixture(false,false,false,true);try{
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});await f.native.dispatch(op);
 assert.equal((await f.native.observe(op)).status,"unverified");assert.equal(f.posts,1);assert.equal(f.gets,1);
 }finally{await f.native.close();await f.store.close();}});
test("reference echo from a different model remains unverified",async()=>{const f=await fixture(false,false,false,false,true);try{
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});await f.native.dispatch(op);
 assert.equal((await f.native.observe(op)).status,"unverified");assert.equal(f.posts,1);assert.equal(f.gets,1);
 }finally{await f.native.close();await f.store.close();}});
test("two genuine roles sharing one uploaded URL require two owner echo objects",async()=>{const f=await fixture(false,false,false,false,false,true);try{
 const op=await f.native.createChat({attemptId:attempt,bundle:f.prepared.bundle,intent:f.intent});await f.native.dispatch(op);
 assert.equal((await f.native.observe(op)).status,"complete");assert.equal(f.posts,1);assert.equal(f.gets,2);
 }finally{await f.native.close();await f.store.close();}});
