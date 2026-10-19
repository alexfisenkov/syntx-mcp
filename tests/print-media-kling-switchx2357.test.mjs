import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMediaMcpConfig,parseArguments} from '../scripts/print-media-mcp-config.mjs';
const url=new URL('../scripts/print-media-mcp-config.mjs',import.meta.url).href;
test('2357 Kling media and Switchx are independent default-off operator-owned groups',()=>{
 const base=buildMediaMcpConfig(url,process.execPath).mcpServers.syntx.env;
 for(const [flag,key,group] of [['--include-kling-media','includeKlingMedia','KLING_MEDIA'],['--include-switchx-video','includeSwitchxVideo','SWITCHX_VIDEO']]){
  assert.deepEqual(parseArguments(['--confirm-enable-paid-tools',flag]),{kind:'emit',[key]:true});
  const selected=buildMediaMcpConfig(url,process.execPath,{[key]:true}).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(base,'SYNTX_OWNER_'+group),false);
  assert.deepEqual(Object.fromEntries(Object.entries(selected).filter(([k,v])=>base[k]!==v)),{
   ['SYNTX_OWNER_'+group]:'1',['SYNTX_OWNER_'+group+'_UPLOAD_DESTINATION']:'<uploaded|hidden>',
   ['SYNTX_OWNER_'+group+'_FFPROBE_PATH']:'<absolute path to trusted ffprobe executable>'});
  assert.throws(()=>parseArguments([flag]));
 }
});
