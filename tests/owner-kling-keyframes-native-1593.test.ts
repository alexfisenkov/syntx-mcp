import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerKlingKeyframesReferenceService } from "../src/application/owner-kling-keyframes-reference-service.js";
import { createOwnerKlingKeyframesRequestPreparer } from "../src/application/owner-kling-keyframes-request-preparer.js";
import { createOwnerKlingKeyframesOneShotPermit } from "../src/application/owner-kling-keyframes-one-shot-policy.js";

const ATTEMPT="link_keyframes_native_owner_123456", BINDING={tenant_id:"keyframes-native-tenant",subject:"keyframes-native-owner"}, NOW=Date.parse("2026-10-14T00:00:00.000Z");
const PNG=png300();
function png300(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
function crc32(b:Uint8Array){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}

test("native Keyframes create, typed one-shot POST, complete history, and exact video GET",async()=>{
 let uploads=0,posts=0,chatCreates=0,wire:Record<string,unknown>|undefined,now=NOW;
 const links=new PerUserLinkService({authorizationProfile:"OBSERVED_OWNER_AUTHORIZED",async createChallenge(){return{upstream_attempt_id:"local",approval_url:"https://example.invalid"};},
   async pollChallenge(_id,receive){await receive({scheme:"Bearer",value:"synthetic-link-token"});return{state:"LINKED" as const};}},new InMemoryAuthLinkStore(()=>now),{attemptIdGenerator:()=>ATTEMPT,now:()=>now,defaultTtlMs:30*60_000});
 await links.createAttempt(BINDING);await links.issueHandoff(BINDING,ATTEMPT);await links.checkAttempt(BINDING,ATTEMPT);
 const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(run:(token:string)=>Promise<T>){return run("synthetic-oneshot-token");}},fetchImpl:async(req,init)=>{
   const url=new URL(typeof req==="string"?req:req instanceof URL?req.href:req.url);
   const method=init?.method??(req instanceof Request?req.method:"");
   if(method==="POST"&&uploads<2){uploads++;const f=(init?.body as FormData).get("files") as File;return Response.json({files:[{id:`upload-${uploads}`,url:`https://r2.syntx.ai/keyframes/${uploads}.png`,filename:f.name,mime_type:"image/png",size:PNG.length}]});}
   if(url.pathname.endsWith("/chats")&&init?.method==="POST")return Response.json({uuid:`native-chat-${++chatCreates}`});
   if(url.pathname.endsWith("/video/generate")){posts++;const raw=init?.body??(req instanceof Request?await req.clone().text():"");wire=JSON.parse(String(raw)) as Record<string,unknown>;throw new Error("synthetic lost POST acknowledgement");}
   if(url.pathname.endsWith("/messages")&&init?.method==="GET")return Response.json({messages:[
      {id:"owner-ack-1",chat_id:421,author_id:27,message_object:[{id:"text-1",message_id:"owner-ack-1",object_type:"text",model_type:"kling_keyframes",object_text:"exact private prompt"}]},
      {id:"bot-result-1",chat_id:421,author_id:-1,message_object:[{id:"video-1",message_id:"bot-result-1",object_type:"video",model_type:"kling_keyframes",completed:true,object_url:"https://r2.syntx.ai/output.mp4"}]}
     ],pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:false}});
   if(url.pathname.endsWith("/bot-result-1"))return Response.json({id:"bot-result-1",chat_id:421,author_id:-1,message_object:[
     {id:"video-1",message_id:"bot-result-1",object_type:"video",model_type:"kling_keyframes",completed:true,object_url:"https://r2.syntx.ai/output.mp4"}]});
   throw new Error("unexpected local request");
 }});
 const refs=new OwnerKlingKeyframesReferenceService({binding:BINDING,linkService:links,resolveClient:()=>client,now:()=>now});
 const a=await refs.upload({attemptId:ATTEMPT,content_base64:PNG.toString("base64"),filename:"first.png",mime_type:"image/png"});
 const b=await refs.upload({attemptId:ATTEMPT,content_base64:PNG.toString("base64"),filename:"last.png",mime_type:"image/png"});
 const preparer=createOwnerKlingKeyframesRequestPreparer({referenceService:refs,now:()=>now});
 try{
  const candidate=await preparer.prepare({attemptId:ATTEMPT,prompt:"exact private prompt",parameters:{model_id:"kling_keyframes",version:"2.1",mode:"hd",video_duration:5,native_audio:false,aspect_ratio:null},controls:{temperature:0.6},image_handles:[String(a.image_handle),String(b.image_handle)]});
  const binding=preparer.inspectCandidate(candidate)!;
  const permit=await createOwnerKlingKeyframesOneShotPermit({preparer,candidate,principal:binding.principal,attemptId:ATTEMPT});
  const base={preparer,candidate,permit,principal:binding.principal,attemptId:ATTEMPT,linkService:links,binding:BINDING};
  const candidate2=await preparer.prepare({attemptId:ATTEMPT,prompt:"parallel second prompt",parameters:{model_id:"kling_keyframes",version:"2.1",mode:"hd",video_duration:5,native_audio:false,aspect_ratio:null},controls:{temperature:0.6},image_handles:[String(a.image_handle),String(b.image_handle)]});
  const binding2=preparer.inspectCandidate(candidate2)!;
  const permit2=await createOwnerKlingKeyframesOneShotPermit({preparer,candidate:candidate2,principal:binding2.principal,attemptId:ATTEMPT});
  const base2={...base,candidate:candidate2,permit:permit2,principal:binding2.principal};
  const [chat,chat2]=await Promise.all([client.createOwnerKlingKeyframesChat(base),client.createOwnerKlingKeyframesChat(base2)]);
  assert.notEqual(chat.chat_uuid,chat2.chat_uuid);
  await assert.rejects(client.createOwnerKlingKeyframesChat(base),(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="CHAT_ALREADY_CREATED");
  await assert.rejects(client.startOwnerKlingKeyframesWithOwnedCandidate({...base,chat}), (error:unknown)=>error instanceof Error&&"code" in error&&error.code==="OUTCOME_UNKNOWN");
  assert.equal(posts,1);
  const body=wire as {prompt:string;settings:{file_urls:unknown[]}};
  assert.equal(body.prompt,"exact private prompt");assert.deepEqual(body.settings.file_urls,[{type:"image",url:"https://r2.syntx.ai/keyframes/1.png"},{type:"image",url:"https://r2.syntx.ai/keyframes/2.png"}]);
  await assert.rejects(client.startOwnerKlingKeyframesWithOwnedCandidate({...base2,chat:chat2}),(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="OUTCOME_UNKNOWN");
  assert.equal(posts,2);
  await assert.rejects(client.startOwnerKlingKeyframesWithOwnedCandidate({...base,chat}),(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="CHAT_DISPATCH_ALREADY_STARTED");
  const history=await client.listOwnedKlingKeyframesCandidates({...base,chat});
  assert.equal(history.owner_ack_status,"MATCHED");assert.equal(history.history_binding_status,"BOUND");assert.equal(history.contexts.length,1);
  await assert.rejects(client.getOwnedKlingKeyframesResult({...base,context:{...history.contexts[0]!}}),(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="RESULT_CONTEXT_INVALID");
  const other=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(run:(token:string)=>Promise<T>){return run("synthetic-oneshot-token");}},fetchImpl:async()=>{throw new Error("unexpected cross-client fetch");}});
  await assert.rejects(other.getOwnedKlingKeyframesResult({...base,context:history.contexts[0]}),(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="RESULT_CONTEXT_INVALID");
  now+=16*60_000;
  const resultInput={...base,context:history.contexts[0]};
  const result=await client.getOwnedKlingKeyframesResult(resultInput);
  assert.equal(result.ready_videos.length,1);assert.equal(result.ready_videos[0]?.message_object_id,"video-1");
  await links.revoke(BINDING,ATTEMPT);
  await assert.rejects(client.getOwnedKlingKeyframesResult(resultInput), (error:unknown)=>error instanceof Error&&"code" in error&&error.code==="PRINCIPAL_NOT_LINKED");
  assert.equal(uploads,2);
 }finally{await preparer.close();await refs.close();}
});
