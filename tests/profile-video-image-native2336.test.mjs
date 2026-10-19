import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntxChatHttpClient } from '../dist/src/adapter/syntx/chat-http-client.js';
import { validateOwnerHiggsfieldDopImageUpload } from '../dist/src/application/owner-higgsfield-dop-image-policy.js';

test('native DOP upload accepts a complete duplicate content_type ACK for its genuine image', async () => {
  let calls = 0;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
  const media = validateOwnerHiggsfieldDopImageUpload({ model_id: 'dop-lite', filename: 'reference.png', mime_type: 'image/png', bytes });
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential(use) { return use('synthetic-profile-native2336-token'); } },
    fetchImpl: async (input, init) => {
      calls++;
      assert.equal(String(input), 'https://api.syntx.ai/api/v1/chats/upload-files');
      assert.equal(init.method, 'POST');
      assert.equal(init.body.get('model_type'), 'dop-lite');
      assert.equal(init.body.get('destination'), 'uploaded');
      const file = init.body.get('files');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
      return new Response(JSON.stringify({ files: [{ status: 'duplicate', filename: file.name,
        size: file.size, content_type: file.type, width: 1, height: 1,
        hash: 'opaque-provider-hash-not-a-client-digest', url: 'https://r2.syntx.ai/synthetic2336/reference.png' }],
        duplicates: 1, successful: 0, failed: 0, total: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const receipt = await client.uploadOwnerHiggsfieldDopImage({ media, destination: 'uploaded' });
  assert.equal(calls, 1);
  assert.equal(receipt.model_id, 'dop-lite');
  assert.equal(receipt.size, bytes.length);
  assert.equal(receipt.width, 1);
  assert.equal(Object.hasOwn(receipt, 'url'), false);
});
