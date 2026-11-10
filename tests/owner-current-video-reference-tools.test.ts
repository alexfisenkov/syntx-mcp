import assert from "node:assert/strict";
import {join} from "node:path";
import test from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {SyntxChatHttpClient} from "../src/adapter/syntx/chat-http-client.js";
import {OwnerCurrentVideoReferenceStore} from "../src/application/owner-current-video-reference-store.js";
import {registerOwnerCurrentVideoReferenceTools} from "../src/mcp/owner-current-video-reference-tools.js";
import {describeRemoteMediaFileTool} from "../src/runtime/remote-owner-media-file-input.js";
import {isReviewedMediaFlagEnabled} from "../src/runtime/reviewed-media-profile.js";
function crc32(bytes:Uint8Array):number {let c=0xffffffff;for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^(c&1?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const b=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=","base64");b.writeUInt32BE(640,16);b.writeUInt32BE(640,20);b.writeUInt32BE(crc32(b.subarray(12,29)),29);return b;}
function errorCode(result:unknown):string{return JSON.parse((result as {content:{text:string}[]}).content[0]!.text).error.code as string;}
test("stock SDK lists and validates current reference upload without exposing owned URL",async()=>{
 assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_CURRENT_VIDEO_REFERENCES",undefined,{SYNTX_OWNER_MEDIA_PROFILE:"all-supported"}),true);
 assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_CURRENT_VIDEO_REFERENCES",undefined,{}),false);
 let linked=true,fail=false,calls=0;const chat=new SyntxChatHttpClient({credentialBroker:{async useCredential<T>(f:(s:string)=>Promise<T>){return f("synthetic-current-reference-credential");}},fetchImpl:async()=>{calls++;if(fail)throw Error("synthetic network failure");return Response.json({files:[{url:"https://r2.syntx.ai/private-owned.png"}]});}});
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:linked?"LINKED":"UNLINKED",expires_at:null,linked};}};
 const store=new OwnerCurrentVideoReferenceStore({binding:{tenant_id:"tenant",subject:"owner"},linkService:links as never,resolveClient:()=>chat,ffprobePath:join(process.cwd(),"ffprobe")});
 const server=new McpServer({name:"current-reference",version:"1"}),client=new Client({name:"current-reference-test",version:"1"}),[caller,host]=InMemoryTransport.createLinkedPair();
 try{registerOwnerCurrentVideoReferenceTools(server,store);await server.connect(host);await client.connect(caller);const listed=await client.listTools();assert.equal(listed.tools.length,2);
  const upload=listed.tools.find(tool=>tool.name==="syntx_owner_upload_current_video_reference");assert.ok(upload);assert.deepEqual(describeRemoteMediaFileTool(upload)._meta?.["openai/fileParams"],["file"]);
  assert.ok((upload.inputSchema.properties?.model_id as {enum?:unknown[]})?.enum?.includes("omni1.2"));
  const policy=await client.callTool({name:"syntx_get_current_video_reference_policy",arguments:{}});
  assert.equal(policy.isError,undefined);assert.ok((policy.structuredContent as {models:string[]}).models.includes("omni1.2"));
  const result=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:{link_attempt_id:"link_current_reference_0000000001",model_id:"seedance-2.0",filename:"source.png",mime_type:"image/png",content_base64:png().toString("base64")}});
  assert.equal(result.isError,undefined,JSON.stringify(result));assert.equal(JSON.stringify(result).includes("r2.syntx.ai"),false);assert.ok((result.structuredContent as {reference_handle:string}).reference_handle);
  const omni=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:{link_attempt_id:"link_current_reference_0000000001",model_id:"omni1.2",filename:"source.png",mime_type:"image/png",content_base64:png().toString("base64")}});
  assert.equal(omni.isError,undefined,JSON.stringify(omni));assert.ok((omni.structuredContent as {reference_handle:string}).reference_handle);
  const args={link_attempt_id:"link_current_reference_0000000001",model_id:"seedance-2.0",filename:"source.png",mime_type:"image/png",content_base64:png().toString("base64")};
  const invalid=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:{...args,content_base64:Buffer.from("bad").toString("base64")}});
  assert.equal(errorCode(invalid),"INVALID_REQUEST");
  linked=false;const unlinked=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:args});assert.equal(errorCode(unlinked),"PRINCIPAL_NOT_LINKED");linked=true;
  fail=true;const unknown=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:args});assert.equal(errorCode(unknown),"UPLOAD_OUTCOME_UNKNOWN");
  const before=calls,again=await client.callTool({name:"syntx_owner_upload_current_video_reference",arguments:args});assert.equal(errorCode(again),"UPLOAD_OUTCOME_UNKNOWN");assert.equal(calls,before);
 } finally{await client.close();await server.close();await store.close();}
});
