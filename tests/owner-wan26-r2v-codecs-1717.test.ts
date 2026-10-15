import assert from "node:assert/strict";
import test from "node:test";
import { bindOwnerWan26R2vHistory } from "../src/adapter/syntx/owner-wan26-r2v-history.js";
import { decodeOwnerWan26R2vVideoResult } from "../src/adapter/syntx/owner-wan26-r2v-video-result.js";

const models = ["wan_26_r2v", "wan_26_r2v_flash"] as const;
const prompt = "Animate the reference scene";
function obj(id:string,message_id:string,type:string,extra:Record<string,unknown>={}) { return {id,message_id,object_type:type,...extra}; }
function row(id:string,author:number,objects:unknown[]) { return {id,chat_id:527,author_id:author,message_object:objects}; }
function page(messages:unknown[],count=messages.length) { return {messages,pagination:{page:1,page_size:10,total_count:count,total_pages:Math.max(1,Math.ceil(count/10)),has_next:false,has_previous:false}}; }
function context(model_id:unknown="wan_26_r2v") { return {chat_uuid:"r2v-chat",message_id:"r2v-result",provider_chat_id:"527",message_object_ids:["r2v-video-a","r2v-video-b"],model_id}; }
function message(model_id:string) { return row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:model_id,completed:true,object_url:"https://r2.syntx.ai/generated/a.mp4"}),obj("r2v-video-b","r2v-result","video",{model_type:model_id,completed:true,object_url:"https://r2.syntx.ai/generated/b.webm"})]); }
function history(model_id:string, botObjects:unknown[]=[], ackModel=model_id) { return bindOwnerWan26R2vHistory({expected:{chat_uuid:"r2v-chat",owner_echo_message_id:"r2v-ack",prompt,model_id},pages:[page([row("r2v-ack",37,[obj("r2v-ack-text","r2v-ack","text",{model_type:ackModel,object_text:prompt})]),row("r2v-result",-1,botObjects)])]}); }

test("binds regular and Flash exact model history with owner, provider chat, and parent joins",()=>{
  for(const model of models){const witness=history(model,[obj("r2v-video-a","r2v-result","video",{model_type:model,completed:true}),obj("r2v-video-b","r2v-result","video",{model_type:model,completed:true})]);assert.equal(witness.status,"COMPLETE");assert.equal(witness.owner_ack_status,"MATCHED");assert.equal(witness.provider_chat_id,"527");assert.deepEqual(witness.candidate_messages,[{message_id:"r2v-result",message_object_ids:["r2v-video-a","r2v-video-b"]}]);assert.equal(witness.backend_acceptance,"UNPROVEN");}
});
test("does not translate either model identity, and keeps ACK mismatches distinct",()=>{
  for(const model of models){const other=model===models[0]?models[1]:models[0];assert.equal(history(model,[obj("r2v-video-a","r2v-result","video",{model_type:model,completed:true})],other).owner_ack_status,"MISMATCH");const wrong=decodeOwnerWan26R2vVideoResult(message(other),context(model));assert.equal(wrong.model_echo,"MISMATCH");assert.deepEqual(wrong.ready_videos,[]);}
  assert.equal(history(models[0],[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true})]).owner_ack_status,"MATCHED");
  assert.throws(()=>decodeOwnerWan26R2vVideoResult(message(models[0]),context("wan_27_r2v")),/INVALID_OWNER_WAN26_R2V_VIDEO_RESULT_CONTEXT/u);
});
test("keeps missing echo unknown, pending outputs separate, and requires nonempty safe URLs",()=>{
  const base=message(models[0]);const objs=(base.message_object as Record<string,unknown>[]);
  objs[0]=obj("r2v-video-a","r2v-result","video",{completed:true,object_url:"https://r2.syntx.ai/generated/a.mp4"});
  objs[1]=obj("r2v-video-b","r2v-result","video",{model_type:models[0],completed:false,object_url:null});
  const decoded=decodeOwnerWan26R2vVideoResult(base,context());assert.equal(decoded.model_echo,"UNKNOWN");assert.equal(decoded.result_status,"PENDING");assert.deepEqual(decoded.pending_object_indices,[1]);assert.equal(decoded.ready_videos.length,0);
  objs[0]=obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:""});
  const emptyUrl=decodeOwnerWan26R2vVideoResult(base,context());assert.equal(emptyUrl.pending_object_indices[0],0);assert.equal(emptyUrl.ready_videos.length,0);
  objs[0]=obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/generated/a.unknown"});
  const unknownMime=decodeOwnerWan26R2vVideoResult(base,context());assert.equal(unknownMime.ready_videos[0]?.mime_type,null);assert.equal(unknownMime.ready_videos[0]?.mime_source,"UNKNOWN");
});
test("rejects unbound joins and hostile graphs without evaluating accessors",()=>{
  const broken=row("r2v-result",-1,[obj("r2v-video-a","foreign-message","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/a.mp4"})]);
  assert.ok(decodeOwnerWan26R2vVideoResult(broken,context()).gaps.some(g=>g.code==="OBJECT_MESSAGE_ID_MISMATCH"));
  const cyclic:Record<string,unknown>={};cyclic.self=cyclic;assert.equal(bindOwnerWan26R2vHistory(cyclic).gaps[0],"HISTORY_INPUT_INVALID");
  let calls=0;const accessor=Object.defineProperty(message(models[0]),"author_id",{enumerable:true,get(){calls++;return -1;}});
  assert.equal(decodeOwnerWan26R2vVideoResult(accessor,context()).result_status,"UNVERIFIED");assert.equal(calls,0);
  const proxy=new Proxy(message(models[0]),{});assert.equal(decodeOwnerWan26R2vVideoResult(proxy,context()).result_status,"UNVERIFIED");
  assert.equal(history(models[0],[obj("r2v-video-a","foreign-message","video",{model_type:models[0],completed:true})]).status,"UNVERIFIED");
});
test("bounds output arrays and refuses sparse arrays",()=>{
  const many=Array.from({length:65},(_,i)=>obj(`r2v-video-${i}`,"r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/x.mp4"}));
  const raw=row("r2v-result",-1,many);assert.equal(decodeOwnerWan26R2vVideoResult(raw,context()).result_status,"UNVERIFIED");
  const sparse:unknown[]=[];sparse.length=2;sparse[1]=obj("r2v-video-b","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/b.mp4"});
  assert.equal(decodeOwnerWan26R2vVideoResult(row("r2v-result",-1,sparse),context()).result_status,"UNVERIFIED");
});

test("keeps message and object ID namespaces independent and accepts an empty complete history",()=>{
  const emptyPage={messages:[],pagination:{page:1,page_size:10,total_count:0,total_pages:0,has_next:false,has_previous:false}};
  const numeric = bindOwnerWan26R2vHistory({expected:{chat_uuid:"r2v-chat",owner_echo_message_id:null,prompt,model_id:models[0]},pages:[emptyPage]});
  assert.equal(numeric.status,"PENDING");
  const negativePage={messages:[],pagination:{...emptyPage.pagination,total_count:-1,total_pages:-1}};
  assert.equal(bindOwnerWan26R2vHistory({expected:{chat_uuid:"r2v-chat",owner_echo_message_id:null,prompt,model_id:models[0]},pages:[negativePage]}).status,"INCOMPLETE");
  const sameIds = bindOwnerWan26R2vHistory({expected:{chat_uuid:"r2v-chat",owner_echo_message_id:"41",prompt,model_id:models[0]},pages:[page([row("41",37,[obj("41","41","text",{model_type:models[0],object_text:prompt})])])]});
  assert.equal(sameIds.owner_ack_status,"MATCHED");
});
test("retains unknown fields at every envelope level and rejects non-JSON numeric values",()=>{
  const extraOuter = decodeOwnerWan26R2vVideoResult({...message(models[0]),task_id:"provider-task"},context());
  assert.ok(extraOuter.gaps.some(g=>g.code==="UNRECOGNIZED_MESSAGE_FIELDS"));
  const extraPage = bindOwnerWan26R2vHistory({expected:{chat_uuid:"r2v-chat",owner_echo_message_id:"r2v-ack",prompt,model_id:models[0]},pages:[{...page([row("r2v-ack",37,[obj("r2v-ack-text","r2v-ack","text",{model_type:models[0],object_text:prompt})])]),unexpected:true}]});
  assert.ok(extraPage.gaps.includes("HISTORY_UNKNOWN_FIELDS"));
  const meta = {value:Number.POSITIVE_INFINITY};
  const withMeta = row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/a.mp4",metadata:meta})]);
  assert.equal(decodeOwnerWan26R2vVideoResult(withMeta,context()).result_status,"UNVERIFIED");
  const withNan = row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/a.mp4",metadata:{value:Number.NaN}})]);
  assert.equal(decodeOwnerWan26R2vVideoResult(withNan,context()).result_status,"UNVERIFIED");
  const sparseMeta:unknown[]=[];sparseMeta.length=2;sparseMeta[1]="tail";
  const withSparseMeta=row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/a.mp4",metadata:{items:sparseMeta}})]);
  assert.equal(decodeOwnerWan26R2vVideoResult(withSparseMeta,context()).result_status,"UNVERIFIED");
  let nestedCalls=0;const hostileMeta=Object.defineProperty({},"value",{enumerable:true,get(){nestedCalls++;return 1;}});
  const withGetter=row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/a.mp4",metadata:hostileMeta})]);
  assert.equal(decodeOwnerWan26R2vVideoResult(withGetter,context()).result_status,"UNVERIFIED");assert.equal(nestedCalls,0);
});
test("returns two successful ordered regular and Flash outputs with safe URLs",()=>{
  for(const model of models){const decoded=decodeOwnerWan26R2vVideoResult(message(model),context(model));assert.equal(decoded.result_status,"OBSERVED");assert.equal(decoded.ready_videos.length,2);assert.deepEqual(decoded.ready_videos.map(x=>x.message_object_id),["r2v-video-a","r2v-video-b"]);assert.ok(decoded.ready_videos.every(x=>x.object_url.startsWith("https://r2.syntx.ai/")&&x.object_url.length>0));}
});
test("rejects an extra empty history page after the reported terminal page",()=>{
  const firstMessages=[row("r2v-ack",37,[obj("r2v-ack-text","r2v-ack","text",{model_type:models[0],object_text:prompt})]),row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true})])];
  const first={messages:firstMessages,pagination:{page:1,page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:false}};
  const extra={messages:[],pagination:{page:2,page_size:10,total_count:2,total_pages:1,has_next:false,has_previous:true}};
  const witness=bindOwnerWan26R2vHistory({expected:{chat_uuid:"r2v-chat",owner_echo_message_id:"r2v-ack",prompt,model_id:models[0]},pages:[first,extra]});
  assert.notEqual(witness.status,"COMPLETE");
});
test("rejects symbol-keyed metadata as outside the closed JSON input shape",()=>{
  const metadata={value:"x",[Symbol("hidden")]:"not-json"};
  const raw=row("r2v-result",-1,[obj("r2v-video-a","r2v-result","video",{model_type:models[0],completed:true,object_url:"https://r2.syntx.ai/a.mp4",metadata})]);
  assert.equal(decodeOwnerWan26R2vVideoResult(raw,context()).result_status,"UNVERIFIED");
});

