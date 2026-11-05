import assert from "node:assert/strict";
import test from "node:test";
import { assertVideo2AudioInputSurface, Video2AudioFlowInstalledCheckError } from "../scripts/check-installed-video2audio-flow.mjs";

const names=["syntx_owner_get_video2audio_source","syntx_upload_video2audio_original","syntx_owner_generate_video2audio","syntx_owner_reconcile_video2audio","syntx_owner_list_video2audio_recoveries","syntx_owner_get_video2audio_result_page"];
for(const current of [false,true])test(`installed Video2Audio ${current?"current":"historical"} input surface keeps exact prompt/seed/media branch`,async()=>{
  const[{Client},{InMemoryTransport},r,s,{AjvJsonSchemaValidator}]=await Promise.all([import("@modelcontextprotocol/sdk/client/index.js"),import("@modelcontextprotocol/sdk/inMemory.js"),import("../dist/src/runtime/observed-owner-runtime.js"),import("../dist/src/mcp/server.js"),import("@modelcontextprotocol/sdk/validation/ajv")]);
  let network=0;
  // This absolute operator path selects the current source profile; the read-only test never executes a probe or uploads bytes.
  const runtime=r.createObservedOwnerRuntime({ownerVideo2AudioEnabled:true,...(current?{ownerVideo2AudioFfprobePath:process.execPath}:{}),fetchImpl:async()=>{network++;throw new Error("NETWORK_DISABLED");}});
  const server=s.createMcpServer(runtime.application,runtime.serverOptions),client=new Client({name:"video2audio-helper-schema",version:"1"}),[a,b]=InMemoryTransport.createLinkedPair();
  try{await server.connect(b);await client.connect(a);const listed=(await client.listTools()).tools;
    assert.deepEqual(assertVideo2AudioInputSurface(listed,current),{tool_count:6,current_input:current});
    const gen=listed.find(t=>t.name===names[2]),validate=new AjvJsonSchemaValidator().getValidator(gen.inputSchema);
    const base={link_attempt_id:"link_video2audio_checker_current_0123456789",video_original_handle:"video2audio_original_00000000-0000-4000-8000-000000000001"};
    assert.equal(validate({...base,prompt:"Synthetic original"}).valid,true);
    assert.equal(validate(base).valid,current);
    assert.equal(validate({...base,prompt:""}).valid,current);
    assert.equal(validate({...base,prompt:"Synthetic",seed:null,negative_prompt:"A bounded negative"}).valid,true);
    for(const field of [{seed:-1},{seed:1.5},{seed:2147483648},{negative_prompt:"x".repeat(5001)},{duration:31},{file_urls:[]}])assert.equal(validate({...base,prompt:"Synthetic",...field}).valid,false);
    for(const mutate of [a=>{a[2].inputSchema.properties.provider_token={type:"string"};},a=>{a[2].inputSchema.properties.seed.anyOf[0].maximum++;},a=>{a[1].inputSchema.properties.content_base64.maxLength++;},a=>{a[3].annotations.readOnlyHint=false;}]){
      const altered=names.map(name=>structuredClone(listed.find(t=>t.name===name)));mutate(altered);assert.throws(()=>assertVideo2AudioInputSurface(altered,current),e=>e instanceof Video2AudioFlowInstalledCheckError);
    }
    assert.throws(()=>assertVideo2AudioInputSurface(listed,!current),e=>e instanceof Video2AudioFlowInstalledCheckError);
    assert.equal(network,0);
  }finally{await client.close();await server.close();await runtime.ownerVideo2AudioLifecycle?.close();await runtime.authStore.close();}
});
