import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerGrokI2vUploadReferenceForClient, type OwnerGrokI2vImageUploadContext } from "../src/adapter/syntx/owner-grok-i2v-upload-context.js";
import { validateOwnerGrokI2vImageUpload } from "../src/application/owner-grok-i2v-image-policy.js";

const SECRET = "synthetic-grok-i2v-native-token";
const ATTEMPT = "link_grok_i2v_owner_0123456789abcdef";
const OTHER_ATTEMPT = "link_grok_i2v_other_0123456789abcdef";
const TITLE = "owner-grok-i2v-job";
type ModelId = "grok_i2v" | "grok_15_i2v";
type ChatContext = Readonly<{ status: "created"; chat_uuid: string; attempt_id: string; model_id: ModelId;
  scope: "video"; generation_permit: false }>;
const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); } };
function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64"); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function validated(model_id: ModelId, width: number, height: number) {
  return validateOwnerGrokI2vImageUpload({ model_id, filename: "frame.png", mime_type: "image/png", bytes: png(width, height) });
}
function create(client: SyntxChatHttpClient, input: { attemptId: string; model_id: ModelId; title: string }, signal?: AbortSignal) {
  const method = (client as unknown as { createOwnerGrokI2vChat?: (input: { attemptId: string; model_id: ModelId; title: string }, signal?: AbortSignal) => Promise<ChatContext> }).createOwnerGrokI2vChat;
  assert.equal(typeof method, "function", "fixed Grok I2V chat constructor must exist");
  return method!.call(client, input, signal);
}
function isOwned(client: SyntxChatHttpClient, context: unknown, attemptId: string): boolean {
  const method = (client as unknown as { isOwnerGrokI2vChat?: (context: unknown, attemptId: string) => boolean }).isOwnerGrokI2vChat;
  assert.equal(typeof method, "function", "client-bound nominal context predicate must exist");
  return method!.call(client, context, attemptId);
}
function invalidate(client: SyntxChatHttpClient, attemptId?: string): void {
  const method = (client as unknown as { invalidateOwnerGrokI2vChats?: (attemptId?: string) => void }).invalidateOwnerGrokI2vChats;
  assert.equal(typeof method, "function", "attempt epoch invalidation must exist");
  method!.call(client, attemptId);
}

test("2282 creates a fixed video-scope Grok I2V chat and returns a model-bound nominal context", async () => {
  const seen: Array<{ url: string; method: string; authorization: string | null; body: string | undefined }> = [];
  let next = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? init.body : undefined });
    return response({ uuid: `grok-i2v-chat-00${++next}` });
  } });
  for (const model_id of ["grok_i2v", "grok_15_i2v"] as const) {
    const context = await create(client, { attemptId: ATTEMPT, model_id, title: TITLE });
    assert.deepEqual(context, { status: "created", chat_uuid: `grok-i2v-chat-00${next}`, attempt_id: ATTEMPT,
      model_id, scope: "video", generation_permit: false });
    assert.equal(Object.isFrozen(context), true);
    assert.equal(isOwned(client, context, ATTEMPT), true);
    assert.equal(isOwned(client, context, OTHER_ATTEMPT), false);
    assert.equal(isOwned(client, { ...context }, ATTEMPT), false);
  }
  assert.deepEqual(seen, [
    { url: "https://api.syntx.ai/api/v1/chats", method: "POST", authorization: `Bearer ${SECRET}`,
      body: JSON.stringify({ title: TITLE, scope: "video" }) },
    { url: "https://api.syntx.ai/api/v1/chats", method: "POST", authorization: `Bearer ${SECRET}`,
      body: JSON.stringify({ title: TITLE, scope: "video" }) }
  ]);
});

test("2282 rejects unowned model, accessor input, and malformed chat response without widening the route", async () => {
  let calls = 0, getterCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    calls++; return response({ uuid: "unsafe/chat" });
  } });
  for (const input of [
    { attemptId: "wrong", model_id: "grok_i2v", title: TITLE },
    { attemptId: ATTEMPT, model_id: "runway_frames", title: TITLE },
    { attemptId: ATTEMPT, model_id: "grok_i2v", title: "" },
    { attemptId: ATTEMPT, model_id: "grok_i2v", title: "x".repeat(1025) }
  ]) await assert.rejects(() => create(client, input as never));
  const withGetter = Object.defineProperties({}, {
    attemptId: { enumerable: true, get() { getterCalls++; return ATTEMPT; } },
    model_id: { enumerable: true, value: "grok_i2v" }, title: { enumerable: true, value: TITLE }
  });
  await assert.rejects(() => create(client, withGetter as never));
  assert.equal(getterCalls, 0);
  await assert.rejects(() => create(client, { attemptId: ATTEMPT, model_id: "grok_i2v", title: TITLE }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" && !String(error).includes(SECRET));
  assert.equal(calls, 1);

  const denied = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => response({ detail: SECRET }, 401) });
  await assert.rejects(() => create(denied, { attemptId: ATTEMPT, model_id: "grok_15_i2v", title: TITLE }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "AUTH_OR_ACCESS_DENIED" && !String(error).includes(SECRET));
});

test("2282 invalidating a pending chat create fences stale context publication", async () => {
  let resolveFetch!: (value: Response) => void;
  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    markFetchStarted(); return new Promise<Response>(resolve => { resolveFetch = resolve; });
  } });
  const pending = create(client, { attemptId: ATTEMPT, model_id: "grok_i2v", title: TITLE });
  void pending.catch(() => undefined);
  await fetchStarted;
  invalidate(client, ATTEMPT);
  resolveFetch(response({ uuid: "grok-i2v-stale-chat" }));
  await assert.rejects(() => pending);
});

test("2282 uploads one exact local image with trusted destination and model-bound multipart fields", async () => {
  const observed: Array<{ filename: string; mime_type: string; destination: string; check_duplicates: string; model_type: string; bytes: Buffer }> = [];
  let credentials = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentials++; return operation(SECRET);
  } }, fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData, file = form.get("files");
    assert.ok(file instanceof File);
    observed.push({ filename: file.name, mime_type: file.type, destination: String(form.get("destination")),
      check_duplicates: String(form.get("check_duplicates")), model_type: String(form.get("model_type")),
      bytes: Buffer.from(await file.arrayBuffer()) });
    return response({ files: [{ id: `grok-i2v-file-${observed.length}`, url: "https://r2.syntx.ai/grok-i2v/frame.png",
      filename: file.name, mime_type: file.type, size: file.size, status: "success" }] });
  } });
  const cases = [
    { model_id: "grok_i2v", width: 1600, height: 900, destination: "hidden" },
    { model_id: "grok_15_i2v", width: 384, height: 384, destination: "uploaded" }
  ] as const;
  for (const item of cases) {
    const source = png(item.width, item.height), before = Buffer.from(source);
    const receipt = validateOwnerGrokI2vImageUpload({ model_id: item.model_id, filename: "frame.png", mime_type: "image/png", bytes: source });
    const upload = (client as unknown as { uploadOwnerGrokI2vImage?: (input: unknown) => Promise<OwnerGrokI2vImageUploadContext> }).uploadOwnerGrokI2vImage;
    assert.equal(typeof upload, "function", "fixed Grok I2V image upload method must exist");
    const context = await upload!.call(client, { media: receipt, destination: item.destination });
    assert.deepEqual(observed.at(-1), { filename: "frame.png", mime_type: "image/png", destination: item.destination,
      check_duplicates: "true", model_type: item.model_id, bytes: source });
    assert.equal(context.status, "uploaded"); assert.equal(context.model_id, item.model_id);
    assert.equal(context.destination, item.destination); assert.equal(context.sha256.length, 64);
    assert.equal("url" in context, false);
    assert.deepEqual(readOwnerGrokI2vUploadReferenceForClient(client, context), { type: "image", url: "https://r2.syntx.ai/grok-i2v/frame.png" });
    assert.equal(readOwnerGrokI2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker }), context), null);
    assert.equal(readOwnerGrokI2vUploadReferenceForClient(client, { ...context }), null);
    assert.deepEqual(source, before, "native upload preserves the caller's input bytes");
  }
  assert.equal(credentials, 2);
});

test("2282 rejects forged media or caller-selected destination before credential lookup", async () => {
  let credentials = 0, fetches = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentials++; return operation(SECRET);
  } }, fetchImpl: async () => { fetches++; return response({ files: [] }); } });
  const receipt = validated("grok_i2v", 1600, 900);
  const upload = (client as unknown as { uploadOwnerGrokI2vImage?: (input: unknown) => Promise<unknown> }).uploadOwnerGrokI2vImage;
  assert.equal(typeof upload, "function", "fixed Grok I2V image upload method must exist");
  await assert.rejects(() => upload!.call(client, { media: { ...receipt }, destination: "hidden" }));
  await assert.rejects(() => upload!.call(client, { media: receipt, destination: "public" }));
  await assert.rejects(() => upload!.call(client, { media: receipt, destination: "hidden", url: "https://example.invalid/x.png" }));
  assert.equal(credentials, 0); assert.equal(fetches, 0);
});
