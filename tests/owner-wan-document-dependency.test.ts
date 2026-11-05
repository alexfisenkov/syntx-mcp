import assert from "node:assert/strict";
import test from "node:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {OwnerCurrentVideoGenerationService} from "../src/application/owner-current-video-generation-service.js";
import {getOwnerWanCurrentFamilyDefinition,normalizeOwnerWanCurrentInput,compileOwnerWanCurrentIntent,inspectOwnerWanCurrentIntent,type OwnerWanCurrentIntent,type OwnerWanCurrentNormalized} from "../src/application/owner-wan-current-intent.js";
import {registerOwnerWanCurrentTools} from "../src/mcp/owner-wan-current-tools.js";
import type {OwnerCurrentVideoReferenceMetadata} from "../src/application/owner-current-video-reference-types.js";
const attempt="link_wan_document_test_00000000001";
const hash=(c:string)=>`sha256:${c.repeat(64)}`;
const metadata:readonly OwnerCurrentVideoReferenceMetadata[]=[
 {role:"image",kind:"image",mime_type:"image/png",size:4096,sha256:hash("a"),width:1024,height:1024},
 {role:"video",kind:"video",mime_type:"video/mp4",size:8192,sha256:hash("b"),width:1280,height:720,duration_seconds:5.5},
 {role:"audio",kind:"audio",mime_type:"audio/wav",size:960000,sha256:hash("c"),duration_seconds:10},
 {role:"file",kind:"file",mime_type:"text/plain",size:48,sha256:hash("d")}
];
const base={model_id:"wan_30_omni",prompt:"Use @image1 and @video1",resolution:"720P",aspect_ratio:"16:9",video_duration:5,prompt_extend:false,seed:0,native_audio:false,rendering_speed:"basic"};
const references=metadata.map((item,index)=>({reference_handle:`current_video_ref_00000000-0000-4000-8000-${String(index).padStart(12,"0")}`,role:item.role}));
function errorCode(result:unknown):string {return JSON.parse((result as {content:{text:string}[]}).content[0]!.text).error.code as string;}
test("document with prompt enhancement disabled fails locally before quote, chat, generation or recovery",async()=>{
 let prepares=0,readClients=0,nativeCalls=0;const refs={async prepare(){prepares++;return {bundle:{} as never,metadata};},async revalidate(){throw Error("unexpected");}};
 const native={async createChat(){nativeCalls++;throw Error("unexpected");},async dispatch(){nativeCalls++;throw Error("unexpected");},async observe(){nativeCalls++;throw Error("unexpected");}};
 const links={async getStatus(_binding:unknown,id:string){return {attempt_id:id,authorization_profile:"OBSERVED_OWNER_AUTHORIZED",status:"LINKED",expires_at:null,linked:true};}};
 const service=new OwnerCurrentVideoGenerationService<OwnerWanCurrentNormalized,OwnerWanCurrentIntent>({binding:{tenant_id:"test",subject:"owner"},linkService:links as never,references:refs as never,native:native as never,
  family:getOwnerWanCurrentFamilyDefinition(),createReadClient:()=>{readClients++;throw Error("unexpected");}});
 const server=new McpServer({name:"wan-document-dependency",version:"1"}),client=new Client({name:"wan-document-test",version:"1"}),[caller,host]=InMemoryTransport.createLinkedPair();
 try{registerOwnerWanCurrentTools(server,{service});await server.connect(host);await client.connect(caller);const listed=await client.listTools();
  const tool=listed.tools.find(row=>row.name==="syntx_owner_generate_wan_current");const schema=tool?.inputSchema as {properties?:Record<string,{description?:string}>};
  assert.match(schema.properties?.prompt_extend?.description??"",/true.*document/i);
  const badNormalize=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,model_id:"wan_25_t2v_preview",prompt:"scene",resolution:"720P",aspect_ratio:"16:9",video_duration:6,prompt_extend:true,seed:null,references:[]}});
  assert.equal(badNormalize.isError,true);assert.equal(errorCode(badNormalize),"INVALID_REQUEST");assert.equal(prepares,0);assert.equal(readClients,0);assert.equal(nativeCalls,0);
  const result=await client.callTool({name:"syntx_owner_generate_wan_current",arguments:{link_attempt_id:attempt,...base,references}});
  assert.equal(result.isError,true);assert.equal(errorCode(result),"INVALID_REQUEST");assert.equal(prepares,1);assert.equal(readClients,0);assert.equal(nativeCalls,0);
  const list=await client.callTool({name:"syntx_owner_list_wan_current_recoveries",arguments:{link_attempt_id:attempt}});
  assert.equal(list.isError,undefined);assert.deepEqual((list.structuredContent as {recoveries:unknown[]}).recoveries,[]);
  const allowed=compileOwnerWanCurrentIntent(normalizeOwnerWanCurrentInput({...base,prompt_extend:true}),metadata);
  assert.equal(inspectOwnerWanCurrentIntent(allowed)?.settings.prompt_extend,true);
 }finally{await client.close();await server.close();await service.close();}
});
