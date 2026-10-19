import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOwnerHailuoInitialParameters} from '../dist/src/application/owner-hailuo-media-parameters.js';
import {buildOwnerHailuoInitialWire} from '../dist/src/application/owner-hailuo-media-wire.js';
test('2356 Hailuo3 follows the exact source initializer, not the rejected one-image frames candidate',()=>{
  const input={model_id:'hailuo-3.0',prompt:'A quiet moving geometric scene.',resolution:'2K',video_duration:5,
    aspect_ratio:'16:9',mode:'omni-references'};
  assert.deepEqual(normalizeOwnerHailuoInitialParameters(input).source_parameters,{model_type:'hailuo-3.0',
    resolution:'2K',video_duration:5,aspect_ratio:'16:9',mode:'omni-references'});
  const wire=buildOwnerHailuoInitialWire(input,{model_id:'hailuo-3.0',url:'https://r2.syntx.ai/hailuo2356/reference.png',
    sha256:'a'.repeat(64),mime_type:'image/png',width:768,height:768});
  assert.deepEqual(wire.wire.settings,{model_type:'hailuo-3.0',resolution:'2K',video_duration:5,
    aspect_ratio:'16:9',mode:'omni-references',file_urls:[{type:'image',url:'https://r2.syntx.ai/hailuo2356/reference.png'}]});
  assert.throws(()=>normalizeOwnerHailuoInitialParameters({...input,resolution:'768p',video_duration:4,mode:'frames'}));
});
