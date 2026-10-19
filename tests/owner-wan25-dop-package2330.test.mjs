import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/src/index.js';

test('package exposes WAN25 and DOP public composition without dispatch capabilities', () => {
  for (const name of ['normalizeOwnerWan25T2vParameters', 'OwnerWan25T2vGenerationService',
    'createOwnerWan25T2vRuntime', 'registerSyntxOwnerWan25T2vTools', 'readOwnerWan25T2vFlag',
    'normalizeOwnerHiggsfieldDopParameters', 'OwnerHiggsfieldDopReferenceService',
    'OwnerHiggsfieldDopGenerationService', 'createOwnerHiggsfieldDopRuntime',
    'registerSyntxOwnerHiggsfieldDopTools', 'readOwnerHiggsfieldDopFlag',
    'readOwnerHiggsfieldDopOperatorConfiguration']) assert.equal(typeof api[name], 'function', name);
  assert.deepEqual(api.OWNER_HIGGSFIELD_DOP_MODEL_IDS, ['dop-lite', 'dop-turbo']);
  assert.equal(api.OWNER_WAN25_T2V_MODEL_ID, 'wan_25_t2v_preview');
  assert.equal(api.OWNER_WAN25_T2V_TOOL_NAMES.length, 3);
  assert.equal(api.OWNER_HIGGSFIELD_DOP_TOOL_NAMES.length, 6);
  assert.equal(api.readOwnerWan25T2vFlag(undefined), false);
  assert.equal(api.readOwnerHiggsfieldDopFlag(undefined), false);
  for (const name of ['consumeOwnerWan25T2vDispatch', 'consumeOwnerHiggsfieldDopDispatch',
    'recordOwnerWan25T2vTransport', 'recordOwnerHiggsfieldDopTransport']) assert.equal(Object.hasOwn(api, name), false);
});
