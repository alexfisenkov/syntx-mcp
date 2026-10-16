import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import {
  OwnerKling4ReferenceService,
  OwnerKling4ReferenceServiceError,
  isOwnerKling4ReferenceService
} from "../src/application/owner-kling4-reference-service.js";

const ATTEMPT_A = "link_kling4_owner_0123456789abcdef";
const ATTEMPT_B = "link_kling4_owner_fedcba9876543210";
const BINDING = Object.freeze({ tenant_id: "kling4-reference-test-tenant", subject: "kling4-reference-test-owner" });
const MP4_FIXTURE_BASE64 = [
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAaUbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAC7gAAQAAAQAA",
  "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA",
  "Bb50cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAC7gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA",
  "AAAAAAAAAAAAAABAAAAAArwAAAK8AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAu4AAAEAAABAAAAAAU2bWRpYQAAACBtZGhk",
  "AAAAAAAAAAAAAAAAAAAwAAAAkABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAE4W1p",
  "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAABKFzdGJsAAAAwXN0c2QA",
  "AAAAAAAAAQAAALFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAArwCvABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGli",
  "eDI2NAAAAAAAAAAAAAAAGP//AAAAN2F2Y0MBZAAf/+EAGmdkAB+s2UCwFnu8BEAAAAMAQAAADAPGDGWAAQAGaOvjyyLA/fj4AAAA",
  "ABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAB0lAAAAAAAAABhzdHRzAAAAAAAAAAEAAABIAAACAAAAABRzdHNzAAAAAAAAAAEA",
  "AAABAAACSGN0dHMAAAAAAAAARwAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQA",
  "AAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAA",
  "AQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAA",
  "CgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAA",
  "AAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAAB",
  "AAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAK",
  "AAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAA",
  "AAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAgAAAAAAgAAAgAAAAAcc3RzYwAAAAAA",
  "AAABAAAAAQAAAEgAAAABAAABNHN0c3oAAAAAAAAAAAAAAEgAAANBAAAAHAAAABkAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAi",
  "AAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAA",
  "GQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAA",
  "ABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIA",
  "AAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAUc3RjbwAAAAAAAAABAAAGxAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAA",
  "AAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAwAAAACGZyZWUA",
  "AAr2bWRhdAAAAq8GBf//q9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUct",
  "NCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRp",
  "b25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5",
  "X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAg",
  "ZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yMiBsb29rYWhlYWRfdGhyZWFk",
  "cz0zIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWlu",
  "ZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVu",
  "X2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjQgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xv",
  "b2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlw",
  "X3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAACKZYiEADv//vdOvwKbVMIqA5JXCvbKpCZZuVJrAfKmAAADAAADAAADAAk76KQ+5z+I",
  "eZgAAAMAPkANUCoAx4RsHiDZB6BJBBA3wuw0QAAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAA",
  "AwAAAwAAAwAAAwAAAwH7AAAAGEGaJGxDv/6plgAAAwAAAwAAAwAAAwAErAAAABVBnkJ4hf8AAAMAAAMAAAMAAAMABZUAAAAVAZ5h",
  "dEK/AAADAAADAAADAAADAAd0AAAAFQGeY2pCvwAAAwAAAwAAAwAAAwAHdQAAAB5BmmhJqEFomUwId//+qZYAAAMAAAMAAAMAAAMA",
  "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",
].join("");
const MP4 = Buffer.from(MP4_FIXTURE_BASE64, "base64");
const FORMAT = "mov,mp4,m4a,3gp,3g2,mj2";
const VIDEO_PROBE = JSON.stringify({ streams: [
  {codec_type:"video",codec_name:"h264",width:700,height:700,start_time:"0.000000",duration:"4.000000"},
  {codec_type:"audio",codec_name:"aac",start_time:"0.500000",duration:"5.000000"}
], format:{format_name:FORMAT,duration:"5.000000"} });

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function crc32(bytes: Uint8Array): number {
  let crc=0xffff_ffff; for (const byte of bytes) { crc^=byte; for(let bit=0;bit<8;bit+=1) crc=(crc>>>1)^(crc&1?0xedb8_8320:0); }
  return (crc^0xffff_ffff)>>>0;
}
function pngWithDimensions(width: number, height: number): Buffer {
  const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),pngChunk("IDAT",Buffer.from([120,156,99,0,0,0,2,0,1])),pngChunk("IEND",Buffer.alloc(0))]);
}

function jsonResponse(value: unknown, status=200): Response { return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}}); }
function broker(): SyntxCredentialBroker { return {async useCredential<T>(operation:(credential:string)=>Promise<T>):Promise<T>{return operation("synthetic-kling4-reference-credential");}}; }

async function linkedOwners(attemptIds: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let next=0;
  const provider: AuthLinkProvider={authorizationProfile:"OBSERVED_OWNER_AUTHORIZED",
    async createChallenge(){return {upstream_attempt_id:`k4-reference-${next}`,approval_url:"https://example.invalid/approve"};},
    async pollChallenge(_id,receiveCredential){await receiveCredential({scheme:"Bearer",value:"synthetic-linked-k4-owner-token"});return {state:"LINKED"};}};
  const links=new PerUserLinkService(provider,new InMemoryAuthLinkStore(now),{now,attemptIdGenerator:()=>attemptIds[next++]!});
  for(const attemptId of attemptIds){await links.createAttempt(BINDING);await links.issueHandoff(BINDING,attemptId);await links.checkAttempt(BINDING,attemptId);}
  return links;
}

async function makeFfprobe(output:string):Promise<{directory:string;path:string}> {
  const directory=await mkdtemp(join(tmpdir(),"syntx-k4-reference-ffprobe-2144-"));
  const interpreter=join(directory,"node"), path=join(directory,"ffprobe-fixture");
  await symlink(process.execPath,interpreter);
  const script="#!/"+interpreter+"\nprocess.stdout.write("+JSON.stringify(output)+");\n";
  await writeFile(path,script,{encoding:"utf8",mode:0o700,flag:"wx"}); await chmod(path,0o700);
  return {directory,path};
}

type FetchHandler = (form:FormData,post:number,signal:AbortSignal|null)=>Promise<Response>|Response;
function makeClient(handler:FetchHandler):SyntxChatHttpClient {
  let post=0;
  return new SyntxChatHttpClient({credentialBroker:broker(),fetchImpl:async(input,init)=>{
    assert.equal(String(input),"https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method,"POST"); assert.equal(init?.redirect,"error");
    const form=init?.body as FormData; assert.deepEqual([...form.keys()],["files","destination","check_duplicates","model_type"]);
    assert.equal(form.get("destination"),"uploaded"); assert.equal(form.get("check_duplicates"),"true");
    post+=1; return handler(form,post,(init?.signal as AbortSignal|null)??null);
  }});
}

function makeService(links:PerUserLinkService,resolveClient:(attemptId:string)=>unknown,now:()=>number,ffprobePath:string):OwnerKling4ReferenceService {
  return new OwnerKling4ReferenceService({binding:BINDING,linkService:links,resolveClient,ffprobePath,maxVideoFileBytes:1024*1024,now});
}

test("uploads K4 image and video references, keeps receipts URL-free, and captures ordered cost metadata", async()=>{
  let now=1000, fileIndex=0; const callerImage=pngWithDimensions(300,300), expectedImage=Buffer.from(callerImage);
  const linked=await linkedOwners([ATTEMPT_A],()=>now); const ffprobe=await makeFfprobe(VIDEO_PROBE);
  const client=makeClient(async(form,post)=>{
    const file=form.get("files"); assert.ok(file instanceof File);
    const bytes=Buffer.from(await file.arrayBuffer());
    if(post===1) assert.deepEqual(bytes,expectedImage); else assert.deepEqual(bytes,MP4);
    const url=`https://r2.syntx.ai/kling4/${++fileIndex}.${post===1?"png":"mp4"}`;
    return jsonResponse({files:[{id:`k4-file-${post}`,url,status:"uploaded",mime_type:file.type,size:file.size}]});
  });
  const service=makeService(linked,()=>client,()=>now,ffprobe.path);
  try{
    const imagePending=service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"frame.png",mime_type:"image/png",bytes:callerImage});
    callerImage.fill(0);
    const image=await imagePending;
    const video=await service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"clip.mp4",mime_type:"video/mp4",bytes:MP4});
    assert.equal(isOwnerKling4ReferenceService(service),true);
    assert.equal(image.model_id,"kling_4_omni"); assert.equal(image.kind,"image");
    assert.equal(image.duration_seconds,null); assert.equal(image.input_cost_duration_seconds,null);
    assert.equal(video.kind,"video"); assert.equal(video.duration_seconds,5); assert.equal(video.input_cost_duration_seconds,5.5);
    assert.equal(JSON.stringify(image).includes("r2.syntx.ai"),false); assert.equal(JSON.stringify(video).includes("r2.syntx.ai"),false);
    const owned=await service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_omni",reference_handles:[video.reference_handle,image.reference_handle]});
    assert.equal(service.isOwnedReferences(owned),true); assert.equal(owned.generation_permit,false);
    assert.equal(JSON.stringify(owned).includes("r2.syntx.ai"),false);
    assert.deepEqual(owned.references.map((item)=>[item.reference_handle,item.kind,item.duration_seconds,item.input_cost_duration_seconds]),
      [[video.reference_handle,"video",5,5.5],[image.reference_handle,"image",null,null]]);
    const captured=service.withCapturedReferences(owned,(capturedClient,records)=>({sameClient:capturedClient===client,records}));
    assert.equal(captured.sameClient,true);
    assert.deepEqual(captured.records.map((record)=>Object.keys(record).sort()),[
      ["duration_seconds","kind","reference_handle","sha256","url"],["duration_seconds","kind","reference_handle","sha256","url"]]);
    assert.equal(captured.records[0]!.url,"https://r2.syntx.ai/kling4/2.mp4");
    assert.equal(captured.records[0]!.duration_seconds,5.5);
    assert.equal(captured.records[1]!.duration_seconds,null);
    assert.equal(Object.keys(image).includes("url"),false);
  }finally{await service.close();await rm(ffprobe.directory,{recursive:true,force:true});}
});

test("allows a fresh zero-reference owned set but binds it to the linked principal and client", async()=>{
  let now=2000; const linked=await linkedOwners([ATTEMPT_A],()=>now);
  const client=makeClient(async()=>jsonResponse({files:[]})); let currentClient=client;
  const service=makeService(linked,()=>currentClient,()=>now,"/no-probe-needed-for-zero-refs");
  try{
    const empty=await service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_omni",reference_handles:[]});
    assert.equal(empty.references.length,0); assert.equal(service.isOwnedReferences(empty),true);
    const captured=service.withCapturedReferences(empty,(same,records)=>({same:same===client,count:records.length}));
    assert.deepEqual(captured,{same:true,count:0});
    currentClient=new SyntxChatHttpClient({credentialBroker:broker()});
    assert.equal(service.isOwnedReferences(empty),false);
    assert.throws(()=>service.withCapturedReferences(empty,()=>true),(error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="REFERENCE_UNAVAILABLE");
    currentClient=client;
    const fresh=await service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_omni",reference_handles:[]});
    now+=15*60_000;
    assert.equal(service.isOwnedReferences(fresh),false);
    await service.invalidateAttempt(ATTEMPT_A);
    assert.equal(service.isOwnedReferences(fresh),false);
  }finally{await service.close();}
});

test("rejects cross-model, cross-attempt, duplicate, and forged reference resolutions", async()=>{
  let now=3000; const linked=await linkedOwners([ATTEMPT_A,ATTEMPT_B],()=>now);
  const client=makeClient(async(_form,post)=>jsonResponse({files:[{id:`k4-${post}`,url:`https://r2.syntx.ai/kling4/${post}.png`,status:"uploaded",mime_type:"image/png",size:pngWithDimensions(300,300).length}]}));
  const service=makeService(linked,()=>client,()=>now,"/unused");
  try{
    const uploaded=await service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",filename:"still.png",mime_type:"image/png",bytes:pngWithDimensions(300,300)});
    await assert.rejects(service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_omni",reference_handles:[uploaded.reference_handle]}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="REFERENCE_UNAVAILABLE");
    await assert.rejects(service.resolveReferences({attemptId:ATTEMPT_B,model_id:"kling_4_keyframes",reference_handles:[uploaded.reference_handle]}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="REFERENCE_UNAVAILABLE");
    await assert.rejects(service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",reference_handles:[uploaded.reference_handle,uploaded.reference_handle]}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="INVALID_REQUEST");
    const owned=await service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",reference_handles:[uploaded.reference_handle]});
    assert.equal(service.isOwnedReferences(Object.freeze({...owned})),false);
  }finally{await service.close();}
});

test("does not retry uncertain upload semantics and allows duplicate identical successful uploads", async()=>{
  let now=4000; const linked=await linkedOwners([ATTEMPT_A],()=>now); let posts=0;
  const sameUrl="https://r2.syntx.ai/kling4/shared.png";
  const client=makeClient(async(form,post)=>{posts+=1;const file=form.get("files");assert.ok(file instanceof File);
    return jsonResponse({files:[{id:`k4-${post}`,url:sameUrl,status:"uploaded",mime_type:file.type,size:file.size}]});});
  const service=makeService(linked,()=>client,()=>now,"/unused"); const firstBytes=pngWithDimensions(300,300);
  try{
    const one=await service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"one.png",mime_type:"image/png",bytes:firstBytes});
    const two=await service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"two.png",mime_type:"image/png",bytes:Buffer.from(firstBytes)});
    assert.notEqual(one.reference_handle,two.reference_handle); assert.equal(posts,2);
    const conflict=pngWithDimensions(301,300);
    await assert.rejects(service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"conflict.png",mime_type:"image/png",bytes:conflict}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"conflict-again.png",mime_type:"image/png",bytes:conflict}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts,3);
  }finally{await service.close();}
});

test("invalidation drains an in-flight POST and retains its no-replay tombstone", async()=>{
  let now=5000, beginFetch!:()=>void, posts=0; const started=new Promise<void>((resolve)=>{beginFetch=resolve;});
  const linked=await linkedOwners([ATTEMPT_A],()=>now);
  const client=makeClient(async(_form,_post,signal)=>{posts+=1;beginFetch();return await new Promise<Response>((_resolve,reject)=>signal?.addEventListener("abort",()=>reject(new Error("synthetic abort")),{once:true}));});
  const service=makeService(linked,()=>client,()=>now,"/unused"); const bytes=pngWithDimensions(300,300);
  const pending=service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",filename:"pending.png",mime_type:"image/png",bytes});
  try{
    await started;
    await service.invalidateAttempt(ATTEMPT_A);
    await assert.rejects(pending,(error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",filename:"retry.png",mime_type:"image/png",bytes}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts,1);
  }finally{await service.close();}
});

test("a conflicting shared URL revokes every prior owner's model-scoped handle and blocks their reupload", async()=>{
  let now=6000,posts=0; const linked=await linkedOwners([ATTEMPT_A,ATTEMPT_B],()=>now);
  const sharedUrl="https://r2.syntx.ai/kling4/colliding.png";
  const client=makeClient(async(form)=>{posts+=1;const file=form.get("files");assert.ok(file instanceof File);
    return jsonResponse({files:[{id:`collision-${posts}`,url:sharedUrl,status:"uploaded",mime_type:file.type,size:file.size}]});});
  const service=makeService(linked,()=>client,()=>now,"/unused");
  const priorBytes=pngWithDimensions(300,300),conflictBytes=pngWithDimensions(301,300);
  try{
    const first=await service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",filename:"first.png",mime_type:"image/png",bytes:priorBytes});
    const second=await service.uploadReference({attemptId:ATTEMPT_B,model_id:"kling_4_omni",filename:"second.png",mime_type:"image/png",bytes:Buffer.from(priorBytes)});
    await service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",reference_handles:[first.reference_handle]});
    await service.resolveReferences({attemptId:ATTEMPT_B,model_id:"kling_4_omni",reference_handles:[second.reference_handle]});
    await assert.rejects(service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_omni",filename:"conflict.png",mime_type:"image/png",bytes:conflictBytes}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.resolveReferences({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",reference_handles:[first.reference_handle]}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="REFERENCE_UNAVAILABLE");
    await assert.rejects(service.resolveReferences({attemptId:ATTEMPT_B,model_id:"kling_4_omni",reference_handles:[second.reference_handle]}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="REFERENCE_UNAVAILABLE");
    await assert.rejects(service.uploadReference({attemptId:ATTEMPT_A,model_id:"kling_4_keyframes",filename:"first-retry.png",mime_type:"image/png",bytes:priorBytes}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.uploadReference({attemptId:ATTEMPT_B,model_id:"kling_4_omni",filename:"second-retry.png",mime_type:"image/png",bytes:priorBytes}),
      (error:unknown)=>error instanceof OwnerKling4ReferenceServiceError&&error.code==="UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts,3);
  }finally{await service.close();}
});
