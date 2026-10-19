import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createObservedOwnerRuntime} from '../dist/src/runtime/observed-owner-runtime.js';
import {createMcpServer} from '../dist/src/mcp/server.js';

test('2321 observed runtime adds only independent WAN25 and DOP groups without startup network',async()=>{
 let fetches=0;const create=opts=>createObservedOwnerRuntime({fetchImpl:async()=>{fetches++;throw Error('OFFLINE_ONLY');},...opts});
 const runtimes=[create({}),create({ownerWan25T2vEnabled:true,ownerHiggsfieldDopEnabled:true,ownerHiggsfieldDopUploadDestination:'uploaded'})];
 const listings=[];
 try{
  for(const runtime of runtimes){
   const server=createMcpServer(runtime.application,runtime.serverOptions),client=new Client({name:'2321-reader',version:'1'});
   const [caller,host]=InMemoryTransport.createLinkedPair();
   try{await server.connect(host);await client.connect(caller);listings.push((await client.listTools()).tools.map(t=>t.name));}
   finally{await client.close();await server.close();}
  }
  const added=listings[1].filter(n=>!listings[0].includes(n)).sort();
  assert.deepEqual(added,[
   'syntx_owner_generate_higgsfield_dop_video','syntx_owner_generate_wan25_t2v_video',
   'syntx_owner_get_higgsfield_dop_motions','syntx_owner_get_higgsfield_dop_result','syntx_owner_get_wan25_t2v_result',
   'syntx_owner_import_higgsfield_dop_image',
   'syntx_owner_list_higgsfield_dop_recoveries','syntx_owner_list_wan25_t2v_recoveries',
   'syntx_owner_upload_higgsfield_dop_image'
  ]);
  assert.equal(new Set(listings[1]).size,listings[1].length);assert.equal(fetches,0);
 }finally{for(const r of runtimes){await r.ownerWan25T2vLifecycle?.close();await r.ownerHiggsfieldDopLifecycle?.close();r.authStore.close?.();}}
});
