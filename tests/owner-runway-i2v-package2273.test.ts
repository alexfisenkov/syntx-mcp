import assert from 'node:assert/strict';
import test from 'node:test';

test('2273 package root exports the Runway I2V composition and explicit owner APIs',async()=>{
  const entry=await import('../src/index.js');
  for(const name of ['getOwnerRunwayI2vSourceProfile','normalizeOwnerRunwayI2vParameters',
    'OwnerRunwayI2vReferenceService','OwnerRunwayI2vGenerationService','registerSyntxOwnerRunwayI2vTools',
    'createOwnerRunwayI2vRuntime','readOwnerRunwayI2vFlag'])assert.equal(typeof Reflect.get(entry,name),'function',name);
  assert.equal(entry.readOwnerRunwayI2vFlag(undefined),false);
  assert.equal(entry.OWNER_RUNWAY_I2V_TOOL_NAMES.length,4);
  assert.equal(entry.getOwnerRunwayI2vSourceProfile().scope,'video');
});
