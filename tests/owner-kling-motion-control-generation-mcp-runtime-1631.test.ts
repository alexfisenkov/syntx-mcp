import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_KLING_MOTION_CONTROL_TOOL_NAMES } from "../src/mcp/owner-kling-motion-control-tools.js";

const NAMES=["syntx_owner_get_kling_motion_control_parameters","syntx_owner_upload_kling_motion_control_image","syntx_owner_upload_kling_motion_control_video",
 "syntx_owner_list_kling_motion_control_presets","syntx_owner_select_kling_motion_control_preset","syntx_owner_generate_kling_motion_control_video",
 "syntx_owner_reconcile_kling_motion_control_video","syntx_owner_list_kling_motion_control_recoveries","syntx_owner_get_kling_motion_control_result_page"] as const;
assert.deepEqual(OWNER_KLING_MOTION_CONTROL_TOOL_NAMES,NAMES);
const ATTEMPT="link_motion_control_sdk_1631_0123456789",NOW=Date.parse("2026-10-15T00:00:00Z");
const FFMPEG=process.env.SYNTX_MCV_TEST_FFMPEG??"ffmpeg",FFPROBE=process.env.SYNTX_MCV_TEST_FFPROBE??execFileSync("which",["ffprobe"],{encoding:"utf8"}).trim();
function crc32(b:Uint8Array){let c=0xffff_ffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb8_8320:0);}return(c^0xffff_ffff)>>>0;}
function png300(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(300,16);b.writeUInt32BE(300,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
function dto(value:unknown):Record<string,unknown>{assert.ok(value&&typeof value==="object");const v=(value as Record<string,unknown>).structuredContent;assert.ok(v&&typeof v==="object");return v as Record<string,unknown>;}

test("stock SDK reaches the opt-in Motion Control runtime for owned and selected-preset generation, then recovers GET-only after prune",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"mcv-sdk-1631-")),videoPath=join(dir,"motion.mp4");
 execFileSync(FFMPEG,["-hide_banner","-loglevel","error","-f","lavfi","-i","color=c=blue:s=320x320:r=24:d=3.2","-vf","setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709","-an","-pix_fmt","yuv420p","-c:v","libx264","-movflags","+faststart","-y",videoPath]);
 const mp4=await readFile(videoPath),png=png300(),originalFetch=globalThis.fetch;let now=NOW,uploadCount=0,chatCount=0,generationCount=0,presetFetches=0,historyGets=0,resultGets=0,globalFetchCalls=0;
 const quotes:URLSearchParams[]=[],posts:Array<{chat:string;body:Record<string,any>}>=[];
 const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(input instanceof Request?input.url:String(input)),method=init?.method??"GET";
  if(url.pathname==="/api/v1/user/balance")return Response.json({balance:"1000"});
  if(url.pathname==="/api/v1/user/subscription")return Response.json({active:true,type:"PRO",end_date:new Date(now+86_400_000).toISOString()});
  if(url.pathname==="/api/v2/get_model_info"){quotes.push(new URLSearchParams(url.searchParams));return Response.json({access:true,cost:7,discount_cost:null,free_remaining_generations:null,limit:null,show_warning:false});}
  if(url.pathname==="/api/v1/kling/motions")return Response.json([{name:"Synthetic preset",audio:"https://r2.syntx.ai/preset/audio.mp4",noaudio:"https://r2.syntx.ai/preset/noaudio.mp4"}]);
  if(url.hostname==="r2.syntx.ai"&&url.pathname.startsWith("/preset/")){presetFetches++;const response=new Response(mp4,{status:200,headers:{"content-type":"video/mp4"}});Object.defineProperty(response,"url",{value:url.href});return response;}
  if(url.pathname==="/api/v1/chats/upload-files"&&method==="POST"){
   uploadCount++;const form=init?.body as FormData,file=form.get("files");assert.ok(file instanceof File);
   const isImage=file.type.startsWith("image/");if(isImage)assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);else assert.deepEqual(Buffer.from(await file.arrayBuffer()),mp4);
   assert.equal(form.get("model_type"),"kling_motion_control");return Response.json({files:[{filename:file.name,url:`https://r2.syntx.ai/owned/${file.name}`,mime_type:file.type,size:file.size}]});}
  if(url.pathname==="/api/v1/chats"&&method==="POST")return Response.json({uuid:`mcv-sdk-chat-${++chatCount}`});
  if(url.pathname==="/api/v1/video/generate"&&method==="POST"){
   generationCount++;assert.equal(url.search,"?ai_name=kling");const body=JSON.parse(String(init?.body)) as Record<string,any>;posts.push({chat:String(body.chat_uuid),body});
   assert.deepEqual(body.settings.file_urls.map((f:{type:string})=>f.type),["image","video"]);throw new Error("synthetic response lost after POST");}
  const history=/^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);if(history){historyGets++;const n=history[1]!.at(-1),prompt=posts.find(x=>x.chat===history[1])?.body.prompt??"";
   return Response.json({messages:[{id:`ack-${n}`,chat_id:421,author_id:27,message_object:[{id:`text-${n}`,message_id:`ack-${n}`,object_type:"text",model_type:"kling_motion_control",object_text:prompt}]},
    {id:`bot-${n}`,chat_id:421,author_id:-1,message_object:[{id:`video-${n}`,message_id:`bot-${n}`,object_type:"video",model_type:"kling_motion_control",completed:true,object_url:`https://r2.syntx.ai/generated/${n}.mp4`}]}],
    pagination:{page:Number(url.searchParams.get("page")),page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:false}});}
  const result=/^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);if(result){resultGets++;return Response.json({id:result[2],chat_id:421,author_id:-1,message_object:[
    {id:`video-${result[1]!.at(-1)}`,message_id:result[2],object_type:"video",model_type:"kling_motion_control",completed:true,object_url:`https://r2.syntx.ai/generated/${result[1]!.at(-1)}.mp4`}]});}
  throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
 };
 const defaults=createObservedOwnerRuntime({now:()=>now,fetchImpl});const defaultServer=createMcpServer(defaults.application,defaults.serverOptions),defaultClient=new Client({name:"mcv-1631-default",version:"1"});
 const [dc,ds]=InMemoryTransport.createLinkedPair();
 try{await defaultServer.connect(ds);await defaultClient.connect(dc);const names=(await defaultClient.listTools()).tools.map(x=>x.name);assert.equal(names.some(x=>(NAMES as readonly string[]).includes(x)),false,"Motion Control stays default-off");}
 finally{await defaultClient.close();await defaultServer.close();}
 const runtime=createObservedOwnerRuntime({ownerKlingMotionControlEnabled:true,ownerKlingMotionControlFfprobePath:FFPROBE,now:()=>now,fetchImpl});
 const composition=runtime.serverOptions.ownerKlingMotionControl;assert.ok(composition);const server=createMcpServer(runtime.application,runtime.serverOptions),client=new Client({name:"mcv-1631-sdk",version:"1"});
 const [cc,cs]=InMemoryTransport.createLinkedPair();
 globalThis.fetch=(async()=>{globalFetchCalls++;throw new Error("unexpected unmocked global fetch");}) as typeof fetch;
 try{
  await runtime.authStore.createAttempt({attempt_id:ATTEMPT,binding:runtime.authBinding,expires_at_ms:now+3*60*60_000});await runtime.authStore.beginHandoff(runtime.authBinding,ATTEMPT);
  await runtime.authStore.attachChallenge(runtime.authBinding,ATTEMPT,"synthetic-motion-1631");await runtime.authStore.beginPoll(runtime.authBinding,ATTEMPT);
  await runtime.authStore.markLinked(runtime.authBinding,ATTEMPT,{scheme:"Bearer",value:"synthetic-motion-credential"});
  await server.connect(cs);await client.connect(cc);const listed=(await client.listTools()).tools.map(x=>x.name);
  assert.deepEqual(listed.filter(x=>(NAMES as readonly string[]).includes(x)),NAMES);assert.ok(composition.referenceService&&composition.presetReferenceService&&composition.generationService);
  const generateTool=(await client.listTools()).tools.find(x=>x.name===NAMES[5]);assert.ok(generateTool);
  const inputSchema=generateTool.inputSchema as {type?:string;properties?:Record<string,unknown>;additionalProperties?:boolean};
  assert.equal(inputSchema.type,"object");assert.equal(inputSchema.additionalProperties,false);
  assert.deepEqual(Object.keys(inputSchema.properties??{}).sort(),["link_attempt_id","model_id","image_handle","reference_source","video_handle","preset_video_handle","version","mode","gen_type","native_audio","video_duration","prompt"].sort());
  assert.ok(generateTool.outputSchema&&typeof generateTool.outputSchema==="object","stock SDK must preserve the strict result output schema");
  assert.equal(JSON.stringify(generateTool.inputSchema).includes("https://"),false,"no caller URL shortcut appears in the generation tool");
  assert.equal(uploadCount,0);assert.equal(generationCount,0);
  const image=dto(await client.callTool({name:NAMES[1],arguments:{link_attempt_id:ATTEMPT,filename:"motion.png",mime_type:"image/png",content_base64:png.toString("base64")}}));
  const ownedVideo=dto(await client.callTool({name:NAMES[2],arguments:{link_attempt_id:ATTEMPT,filename:"motion.mp4",mime_type:"video/mp4",content_base64:mp4.toString("base64")}}));
  const library=dto(await client.callTool({name:NAMES[3],arguments:{link_attempt_id:ATTEMPT}}));assert.ok(Array.isArray(library.presets),JSON.stringify(library));const preset=(library.presets as Record<string,unknown>[])[0]!;
  const selected=dto(await client.callTool({name:NAMES[4],arguments:{link_attempt_id:ATTEMPT,preset_handle:preset.preset_handle,variant:"audio"}}));assert.equal(selected.variant,"audio");
  const unavailableSelect=await client.callTool({name:NAMES[4],arguments:{link_attempt_id:ATTEMPT,preset_handle:"kling_motion_control_preset_999_00000000-0000-4000-8000-000000000000",variant:"audio"}});
  assert.equal(unavailableSelect.isError,true);assert.equal(dto(unavailableSelect).status,"unavailable","failed preset selection must preserve its typed unavailable result through SDK schema validation");
  assert.equal(globalFetchCalls,0,"preset download must use the configured fake HTTP transport, never global network");
  assert.equal(JSON.stringify([image,ownedVideo,library,selected]).includes("https://"),false,"uploaded and preset URLs remain private");
  const common={link_attempt_id:ATTEMPT,model_id:"kling_motion_control",prompt:"",version:"3.0",mode:"hd",gen_type:"mcv",native_audio:false,video_duration:3},recoveryIds:string[]=[];
  const crossSource=await client.callTool({name:NAMES[5],arguments:{...common,reference_source:"service_preset",image_handle:image.image_handle,preset_video_handle:selected.preset_video_handle,video_handle:ownedVideo.video_handle}});
  assert.equal(crossSource.isError,true);assert.equal(generationCount,0,"cross-source handles fail before generation");
  for(const [i,request] of [[0,{...common,reference_source:"owned_video",image_handle:image.image_handle,video_handle:ownedVideo.video_handle}],
   [1,{...common,reference_source:"service_preset",image_handle:image.image_handle,preset_video_handle:selected.preset_video_handle}]] as const){
    const started=await client.callTool({name:NAMES[5],arguments:request});assert.equal(started.isError,true,"lost POST acknowledgement must remain unknown");const unknown=dto(started);
    assert.equal(unknown.code,"OUTCOME_UNKNOWN");assert.equal(posts[i]?.body.prompt,"");assert.equal(posts[i]?.body.settings.native_audio,false);
    assert.equal(posts[i]?.body.settings.file_urls[0]?.type,"image");assert.equal(posts[i]?.body.settings.file_urls[1]?.type,"video");
    assert.deepEqual(Object.keys(posts[i]?.body.settings??{}).sort(),["model_type","version","mode","gen_type","native_audio","video_duration","file_urls"].sort());
    assert.equal(posts[i]?.body.settings.model_type,"kling_motion_control");assert.equal(posts[i]?.body.settings.version,"3.0");
    assert.equal(posts[i]?.body.settings.mode,"hd");assert.equal(posts[i]?.body.settings.gen_type,"mcv");assert.equal(posts[i]?.body.settings.video_duration,3);
    assert.match(String(posts[i]?.body.settings.file_urls[0]?.url),/\/owned\/motion\.png$/u);
    if(i===0)assert.match(String(posts[i]?.body.settings.file_urls[1]?.url),/\/owned\//u);else assert.match(String(posts[i]?.body.settings.file_urls[1]?.url),/\/preset\/audio\.mp4$/u);
    assert.equal(typeof unknown.recovery_id,"string");recoveryIds.push(String(unknown.recovery_id));
  }
  assert.equal(generationCount,2);assert.equal(presetFetches,1);assert.equal(quotes.length,4,"both independent preflights must quote all required controls");
  assert.deepEqual(quotes.map(q=>[...q.keys()].filter(k=>k!=="ai_name"&&k!=="model_type").sort()),Array.from({length:4},()=>["gen_type","mode","native_audio","version","video_duration"].sort()));
  assert.ok(quotes.every(q=>["version","mode","gen_type","native_audio","video_duration"].every(k=>q.has(k))));
  assert.ok(quotes.every(q=>q.get("version")==="3.0"&&q.get("mode")==="hd"&&q.get("gen_type")==="mcv"&&q.get("native_audio")==="false"&&q.get("video_duration")==="3"));
  now+=16*60_000;
  const pruned=await client.callTool({name:NAMES[5],arguments:{...common,reference_source:"owned_video",image_handle:image.image_handle,video_handle:ownedVideo.video_handle}});assert.equal(pruned.isError,true);assert.equal(generationCount,2,"expired candidate pruning cannot replay a paid POST");
  for(const recovery_id of recoveryIds){const recovered=await client.callTool({name:NAMES[6],arguments:{link_attempt_id:ATTEMPT,recovery_id}});assert.equal(recovered.isError,undefined);assert.equal(dto(recovered).observed_artifact_count,1);}
  assert.equal(generationCount,2,"reconciliation after preparer prune is GET-only");assert.equal(historyGets,2);assert.equal(resultGets,2);
  const before=historyGets+resultGets;const page=await client.callTool({name:NAMES[8],arguments:{link_attempt_id:ATTEMPT,recovery_id:recoveryIds[0]}});assert.equal(page.isError,undefined);assert.equal(dto(page).observed_artifact_count,1);
  const listedRecoveries=await client.callTool({name:NAMES[7],arguments:{link_attempt_id:ATTEMPT}});assert.equal(listedRecoveries.isError,undefined);
  assert.equal(historyGets+resultGets,before,"result page and recovery list use the local cache");
  const revoked=await client.callTool({name:"syntx_unlink",arguments:{attempt_id:ATTEMPT}});assert.equal(dto(revoked).status,"REVOKED");
  const denied=await client.callTool({name:NAMES[8],arguments:{link_attempt_id:ATTEMPT,recovery_id:recoveryIds[0]}});assert.equal(denied.isError,true);assert.equal(historyGets+resultGets,before);assert.equal(generationCount,2);
 }finally{globalThis.fetch=originalFetch;await client.close();await server.close();await runtime.ownerKlingMotionControlLifecycle?.close().catch(()=>undefined);await rm(dir,{recursive:true,force:true});png.fill(0);}
});
