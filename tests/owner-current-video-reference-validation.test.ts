import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { validateOwnerCurrentVideoReference, consumeOwnerCurrentValidatedVideoReference, releaseOwnerCurrentValidatedVideoReference } from "../src/application/owner-current-video-reference-validation.js";
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(640,16);b.writeUInt32BE(640,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
test("current reference image receipt is nominal, scoped and consumed once",async()=>{
 const input={model_id:"seedance-2.0" as const,filename:"image.png",mime_type:"image/png",bytes:png()};
 const receipt=await validateOwnerCurrentVideoReference(input,join(process.cwd(),"ffprobe"));
 assert.equal(receipt.width,640);assert.equal(receipt.model_id,"seedance-2.0");assert.equal(receipt.generation_permit,false);assert.equal(JSON.stringify(receipt).includes("bytes"),false);
 assert.equal(consumeOwnerCurrentValidatedVideoReference({...receipt}),null);
 const bytes=consumeOwnerCurrentValidatedVideoReference(receipt);assert.ok(bytes);bytes.fill(0);assert.equal(consumeOwnerCurrentValidatedVideoReference(receipt),null);
 await assert.rejects(()=>validateOwnerCurrentVideoReference({...input,mime_type:"image/jpeg"},join(process.cwd(),"ffprobe")));
 releaseOwnerCurrentValidatedVideoReference(receipt);
});
test("WAN Omni documents admit bounded known signatures only",async()=>{
 const base={model_id:"wan_30_omni" as const,filename:"source.pdf",mime_type:"application/pdf",bytes:Buffer.from("%PDF-1.7\n%%EOF\n")};
 const pdf=await validateOwnerCurrentVideoReference(base,join(process.cwd(),"ffprobe"));assert.equal(pdf.kind,"file");releaseOwnerCurrentValidatedVideoReference(pdf);
 await assert.rejects(()=>validateOwnerCurrentVideoReference({...base,bytes:Buffer.from("not-a-pdf")},join(process.cwd(),"ffprobe")));
 await assert.rejects(()=>validateOwnerCurrentVideoReference({...base,model_id:"wan_30_reference"},join(process.cwd(),"ffprobe")));
});
