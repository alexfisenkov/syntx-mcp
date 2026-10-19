import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaMcpConfig, parseArguments } from '../scripts/print-media-mcp-config.mjs';
const url = new URL('../scripts/print-media-mcp-config.mjs', import.meta.url).href;
test('2349 WAN27 I2V is independently opted in without startup side effects', () => {
  assert.deepEqual(parseArguments(['--confirm-enable-paid-tools', '--include-wan27-i2v']), {kind:'emit',includeWan27I2v:true});
  const base = buildMediaMcpConfig(url, process.execPath).mcpServers.syntx.env;
  const selected = buildMediaMcpConfig(url, process.execPath, {includeWan27I2v:true}).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(base,'SYNTX_OWNER_WAN27_I2V'),false);
  assert.deepEqual(Object.fromEntries(Object.entries(selected).filter(([k,v])=>base[k]!==v)), {
    SYNTX_OWNER_WAN27_I2V:'1',SYNTX_OWNER_WAN27_I2V_UPLOAD_DESTINATION:'<uploaded|hidden>'
  });
  for(const argv of [['--include-wan27-i2v'],['--include-wan27-i2v','--confirm-enable-paid-tools'],
    ['--confirm-enable-paid-tools','--include-wan27-i2v','--include-wan27-i2v']]) assert.throws(()=>parseArguments(argv));
});
test('2349 all eleven independent media selections can be combined without a stale option ceiling',()=>{
  const keys=['includeKling4','includeWan27VideoEdit','includeSeedanceEditor','includeRunwayI2v','includeGrokI2v',
    'includeWan25T2vPreview','includeHiggsfieldDop','includeHailuoInitial','includeHappyHorse','includeWan27I2v','includeSeedance25T2v'];
  const env=buildMediaMcpConfig(url,process.execPath,Object.fromEntries(keys.map(k=>[k,true]))).mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_WAN27_I2V,'1');assert.equal(env.SYNTX_OWNER_HAPPY_HORSE,'1');
  assert.equal(env.SYNTX_OWNER_SEEDANCE25_T2V,'1');
  assert.throws(()=>buildMediaMcpConfig(url,process.execPath,{unknown:true}));
});
test('2349 Seedance25 is independently default-off and requires first paid confirmation',()=>{
  assert.deepEqual(parseArguments(['--confirm-enable-paid-tools','--include-seedance25-t2v']),{kind:'emit',includeSeedance25T2v:true});
  const base=buildMediaMcpConfig(url,process.execPath).mcpServers.syntx.env;
  const selected=buildMediaMcpConfig(url,process.execPath,{includeSeedance25T2v:true}).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(base,'SYNTX_OWNER_SEEDANCE25_T2V'),false);
  assert.deepEqual(Object.fromEntries(Object.entries(selected).filter(([k,v])=>base[k]!==v)),{SYNTX_OWNER_SEEDANCE25_T2V:'1'});
  assert.throws(()=>parseArguments(['--include-seedance25-t2v']));
});
