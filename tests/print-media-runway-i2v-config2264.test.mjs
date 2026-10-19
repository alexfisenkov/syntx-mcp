import assert from 'node:assert/strict';
import test from 'node:test';
import {buildMediaMcpConfig,parseArguments,main,INCLUDE_RUNWAY_I2V_FLAG,PAID_TOOLS_CONFIRMATION_FLAG} from '../scripts/print-media-mcp-config.mjs';

test('2264 Runway I2V is independently selected after paid confirmation, defaults and other selections unchanged', async()=>{
  assert.equal(INCLUDE_RUNWAY_I2V_FLAG,'--include-runway-i2v');
  const build=options=>buildMediaMcpConfig(new URL('../scripts/print-media-mcp-config.mjs',import.meta.url).href,process.execPath,options).mcpServers.syntx.env;
  const baseline=build();
  assert.equal(Object.hasOwn(baseline,'SYNTX_OWNER_RUNWAY_I2V'),false);
  const selected=build({includeRunwayI2v:true});
  assert.deepEqual(selected,{...baseline,SYNTX_OWNER_RUNWAY_I2V:'1'});
  assert.deepEqual(build({includeRunwayI2v:false}),baseline);
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG,INCLUDE_RUNWAY_I2V_FLAG]),{kind:'emit',includeRunwayI2v:true});
  for(const args of [[INCLUDE_RUNWAY_I2V_FLAG],[INCLUDE_RUNWAY_I2V_FLAG,PAID_TOOLS_CONFIRMATION_FLAG],[PAID_TOOLS_CONFIRMATION_FLAG,INCLUDE_RUNWAY_I2V_FLAG,INCLUDE_RUNWAY_I2V_FLAG]])assert.throws(()=>parseArguments(args));
  const all=build({includeRunwayI2v:true,includeKling4:true,includeWan27VideoEdit:true,includeSeedanceEditor:true});
  assert.equal(all.SYNTX_OWNER_RUNWAY_I2V,'1');assert.equal(all.SYNTX_OWNER_SEEDANCE_EDITOR,'1');assert.equal(all.SYNTX_OWNER_KLING4,'1');assert.equal(all.SYNTX_OWNER_WAN27_VIDEOEDIT,'1');
  let out='';assert.equal(await main([PAID_TOOLS_CONFIRMATION_FLAG,INCLUDE_RUNWAY_I2V_FLAG],{writeStdout:x=>{out+=x;}}),0);
  assert.equal(JSON.parse(out).mcpServers.syntx.env.SYNTX_OWNER_RUNWAY_I2V,'1');
  let getter=0;assert.throws(()=>build(Object.defineProperty({},'includeRunwayI2v',{enumerable:true,get(){getter++;return true;}})));assert.equal(getter,0);
  for(const bad of [{includeRunwayI2v:1},{includeRunwayI2v:true,extra:false},new Proxy({includeRunwayI2v:true},{})])assert.throws(()=>build(bad));
  let help='';await main(['--help'],{writeStdout:x=>{help+=x;}});assert.match(help,/--include-runway-i2v/u);assert.match(help,/already-cropped/u);assert.match(help,/seed:null/u);
});
