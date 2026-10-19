import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createObservedOwnerRuntime} from '../dist/src/runtime/observed-owner-runtime.js';
import {createMcpServer} from '../dist/src/mcp/server.js';
import {OWNER_WAN27_I2V_TOOL_NAMES} from '../dist/src/mcp/owner-wan27-i2v-tools.js';
import {OWNER_SEEDANCE25_T2V_TOOL_NAMES} from '../dist/src/mcp/owner-seedance25-t2v-tools.js';
test('2352 WAN27 I2V and Seedance25 register independently, with zero startup network and full lifecycle closure',async()=>{
  let fetches=0;
  const offline=async()=>{fetches++;throw Error('OFFLINE_ONLY');};
  const runtimes=[createObservedOwnerRuntime({fetchImpl:offline}),createObservedOwnerRuntime({fetchImpl:offline,
    ownerWan27I2vEnabled:true,ownerWan27I2vUploadDestination:'uploaded',ownerSeedance25T2vEnabled:true})];
  const listings=[];
  try{
    for(const r of runtimes){
      const server=createMcpServer(r.application,r.serverOptions),client=new Client({name:'2352-reader',version:'1'});
      const [caller,host]=InMemoryTransport.createLinkedPair();
      try{await server.connect(host);await client.connect(caller);listings.push((await client.listTools()).tools.map(t=>t.name));}
      finally{await client.close();await server.close();}
    }
    assert.deepEqual(listings[1].filter(n=>!listings[0].includes(n)).sort(),[...OWNER_WAN27_I2V_TOOL_NAMES,
      ...OWNER_SEEDANCE25_T2V_TOOL_NAMES,'syntx_owner_get_video_recovery_diagnostic'].sort());
    assert.equal(new Set(listings[1]).size,listings[1].length);assert.equal(fetches,0);
  }finally{for(const r of runtimes){await r.ownerWan27I2vLifecycle?.close();await r.ownerSeedance25T2vLifecycle?.close();r.authStore.close?.();}}
});
