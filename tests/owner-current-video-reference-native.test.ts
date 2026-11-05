import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient, readOwnerCurrentVideoNativeUpload } from "../src/adapter/syntx/chat-http-client.js";
import { validateOwnerCurrentVideoReference } from "../src/application/owner-current-video-reference-validation.js";
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(640,16);b.writeUInt32BE(640,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
test("current native upload requires a genuine local receipt and binds owner, attempt and client",async()=>{
 let calls=0;const client=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-reference-credential");}},fetchImpl:async()=>{calls++;return Response.json({files:[{url:"https://r2.syntx.ai/owned-image.png"}]});}});
 const other=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-reference-credential");}},fetchImpl:async()=>{throw Error("unexpected");}});
 const attempt="link_current_reference_0000000001",principal={tenant_id:"tenant",subject_id:"owner",connection_id:attempt};
 await assert.rejects(()=>client.uploadOwnerCurrentVideoReference({attempt_id:attempt,principal,reference:{}}));assert.equal(calls,0);
 const receipt=await validateOwnerCurrentVideoReference({model_id:"seedance-2.0",filename:"owned.png",mime_type:"image/png",bytes:png()},join(process.cwd(),"ffprobe"));
 const context=await client.uploadOwnerCurrentVideoReference({attempt_id:attempt,principal,reference:receipt});assert.equal(calls,1);assert.equal(JSON.stringify(context),"{}");
 assert.equal(readOwnerCurrentVideoNativeUpload(client,{...context},attempt,principal),null);
 assert.equal(readOwnerCurrentVideoNativeUpload(other,context,attempt,principal),null);
 assert.equal(readOwnerCurrentVideoNativeUpload(client,context,attempt,{...principal,subject_id:"other"}),null);
 assert.equal(readOwnerCurrentVideoNativeUpload(client,context,attempt,principal)?.metadata.model_id,"seedance-2.0");
 await assert.rejects(()=>client.uploadOwnerCurrentVideoReference({attempt_id:attempt,principal,reference:receipt}));assert.equal(calls,1);
});
