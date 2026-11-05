import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerCurrentVideoReferenceStore, compileOwnerCurrentVideoReferenceWire, consumeOwnerCurrentVideoReferenceBundle, peekOwnerCurrentVideoReferenceBundle } from "../src/application/owner-current-video-reference-store.js";
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(640,16);b.writeUInt32BE(640,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
const attempt="link_current_reference_0000000001", principal={tenant_id:"tenant",subject_id:"owner",connection_id:attempt};
test("current reference store binds owner, model, TTL, late auth and one-shot ordered bundle",async()=>{
 let now=1_700_000_000_000,uploads=0,linked=true;const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-store-credential");}},
  fetchImpl:async()=>{uploads++;return Response.json({files:[{url:"https://r2.syntx.ai/current-owned.png"}]});}});
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:linked?"LINKED":"UNLINKED",expires_at:null,linked};}};
 const store=new OwnerCurrentVideoReferenceStore({binding:{tenant_id:"tenant",subject:"owner"},linkService:links as never,resolveClient:()=>client,ffprobePath:join(process.cwd(),"ffprobe"),now:()=>now});
 try {const receipt=await store.upload({attemptId:attempt,model_id:"seedance-2.0",filename:"image.png",mime_type:"image/png",content_base64:png().toString("base64")});
  assert.equal(uploads,1);assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"),false);
  await assert.rejects(()=>store.prepare({attemptId:attempt,model_id:"seedance-2.5",mode:"frames",references:[{reference_handle:receipt.reference_handle,role:"first_frame"}]}));
  const request={attemptId:attempt,model_id:"seedance-2.0" as const,mode:"frames",references:[{reference_handle:receipt.reference_handle,role:"first_frame" as const},{reference_handle:receipt.reference_handle,role:"last_frame" as const}]};
  const prepared=await store.prepare(request);assert.equal(JSON.stringify(prepared).includes("r2.syntx.ai"),false);
  assert.throws(()=>consumeOwnerCurrentVideoReferenceBundle(store,prepared.bundle,client,attempt,principal));
  linked=false;await assert.rejects(()=>store.revalidate(prepared.bundle));linked=true;await store.revalidate(prepared.bundle);
  const peek=peekOwnerCurrentVideoReferenceBundle(store,prepared.bundle,client,attempt,principal);assert.equal(peek.model_id,"seedance-2.0");assert.equal(peek.mode,"frames");assert.equal(peek.metadata.length,2);
  const used=consumeOwnerCurrentVideoReferenceBundle(store,prepared.bundle,client,attempt,principal);assert.deepEqual(used.references.map(r=>r.role),["first_frame","last_frame"]);
  assert.throws(()=>consumeOwnerCurrentVideoReferenceBundle(store,prepared.bundle,client,attempt,principal));
  const reusable=await store.prepare(request);await store.revalidate(reusable.bundle);
  assert.equal(consumeOwnerCurrentVideoReferenceBundle(store,reusable.bundle,client,attempt,principal).references.length,2);
  const another=await store.upload({attemptId:attempt,model_id:"seedance-2.0",filename:"image.png",mime_type:"image/png",content_base64:png().toString("base64")});
  now-=1;await assert.rejects(()=>store.prepare({...request,references:[{reference_handle:another.reference_handle,role:"first_frame"}]}));now+=1;
  const mentions=await store.prepare({attemptId:attempt,model_id:"seedance-2.0",mode:"omni-references",references:[{reference_handle:receipt.reference_handle,role:"image"},{reference_handle:another.reference_handle,role:"image"}]});
  await store.revalidate(mentions.bundle);
  assert.throws(()=>compileOwnerCurrentVideoReferenceWire(store,mentions.bundle,client,attempt,principal,"<<<https://example.com/foreign>>>","ENABLED_ALIASES"));
  const wire=compileOwnerCurrentVideoReferenceWire(store,mentions.bundle,client,attempt,principal,"@image1 and @image2 and @image10","ENABLED_ALIASES");
  assert.equal(wire.prompt,"<<<https://r2.syntx.ai/current-owned.png>>> and <<<https://r2.syntx.ai/current-owned.png>>> and @image10");assert.equal(wire.file_urls.length,1);assert.equal(wire.reference_url_hashes.length,1);
  now+=15*60_000;await assert.rejects(()=>store.prepare({...request,references:[{reference_handle:another.reference_handle,role:"first_frame"}]}));
 } finally {await store.close();}
});

test("unknown reference upload is not replayed",async()=>{
 let calls=0;const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-store-credential");}},fetchImpl:async()=>{calls++;throw Error("lost synthetic acknowledgement");}});
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:"LINKED",expires_at:null,linked:true};}};
 const store=new OwnerCurrentVideoReferenceStore({binding:{tenant_id:"tenant",subject:"owner"},linkService:links as never,resolveClient:()=>client,ffprobePath:join(process.cwd(),"ffprobe")});
 const input={attemptId:attempt,model_id:"seedance-2.0" as const,filename:"image.png",mime_type:"image/png",content_base64:png().toString("base64")};
 try {await assert.rejects(()=>store.upload(input));await assert.rejects(()=>store.upload(input));assert.equal(calls,1);}finally{await store.close();}
});
