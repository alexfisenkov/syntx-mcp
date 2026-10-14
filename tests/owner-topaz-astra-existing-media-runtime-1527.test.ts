import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { OwnerTopazAstraExistingMediaService, isOwnerTopazAstraExistingMediaService } from "../src/application/owner-topaz-astra-existing-media-service.js";
import { OwnerTopazAstraGenerationService } from "../src/application/owner-topaz-astra-generation-service.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof } from "../src/transports/stdio-owner.js";

const ATTEMPT = "link_topaz_existing_runtime_1527_owner";
const BINDING = Object.freeze({ tenant_id: "topaz-existing-runtime-1527", subject: "owner-1527" });
const CHAT_UUID = "topaz-existing-runtime-chat-1527";
const OWNER_TITLE = "owner-topaz-astra-12345678-1234-4abc-8def-123456789abc";
const OUTPUT_URL = "https://r2.syntx.ai/private/topaz-existing-runtime-1527.mp4";
const NOW = 1_797_000_000_000;

function json(value: unknown): Response { return Response.json(value); }

async function linkedStore(): Promise<InMemoryAuthLinkStore> {
  const store = new InMemoryAuthLinkStore(() => NOW);
  await store.createAttempt({ attempt_id: ATTEMPT, binding: BINDING, expires_at_ms: NOW + 60_000 });
  await store.beginHandoff(BINDING, ATTEMPT);
  await store.attachChallenge(BINDING, ATTEMPT, "synthetic-topaz-runtime-1527");
  await store.beginPoll(BINDING, ATTEMPT);
  await store.markLinked(BINDING, ATTEMPT, { scheme: "Bearer", value: "synthetic-runtime-credential" });
  return store;
}

function runtimeFetch(events: string[]): typeof fetch {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    if (method !== "GET") throw new Error("Topaz existing-media runtime must stay GET-only.");
    events.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/v1/chats") return json({ chats: [{ id: 8101, uuid: CHAT_UUID, scope: "tool_video_upscaler", title: OWNER_TITLE }],
      pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/messages`) return json({ messages: [
      { id: "owner-message", chat_id: 8101, author_id: 17, message_object: [] },
      { id: "bot-message", chat_id: 8101, author_id: -1, message_object: [{ id: "video-object", message_id: "bot-message", object_type: "video",
        model_type: "slp-2.5", completed: true, object_url: OUTPUT_URL }] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    if (url.pathname === `/api/v1/chats/${CHAT_UUID}/bot-message`) return json({ id: "bot-message", chat_id: 8101, author_id: -1,
      message_object: [{ id: "video-object", message_id: "bot-message", object_type: "video", model_type: "slp-2.5", completed: true, object_url: OUTPUT_URL }] });
    throw new Error(`Unexpected Topaz runtime GET ${url.pathname}`);
  };
  return fetchImpl;
}

test("Topaz existing-media runtime is default-off and composes a genuine reader over the shared cached chat client", async () => {
  let calls = 0;
  const defaults = createObservedOwnerRuntime({ fetchImpl: async () => { calls++; throw new Error("Unexpected startup request"); } });
  assert.equal(defaults.serverOptions.ownerTopazAstra, undefined);
  assert.equal(defaults.ownerTopazAstraLifecycle, undefined);
  await defaults.authStore.close?.();

  const store = await linkedStore(), events: string[] = [];
  const fetchImpl = runtimeFetch(events);
  const runtime = createObservedOwnerRuntime({ authBinding: BINDING, authStore: store, fetchImpl, now: () => NOW,
    ownerTopazAstraEnabled: true, ownerTopazAstraFfprobePath: "/usr/bin/ffprobe", ownerTopazAstraUploadDestination: "hidden" });
  const reader = runtime.serverOptions.ownerTopazAstra?.existingMediaService;
  try {
    assert.ok(reader instanceof OwnerTopazAstraExistingMediaService);
    assert.equal(isOwnerTopazAstraExistingMediaService(reader), true);
    assert.ok(runtime.serverOptions.ownerTopazAstra?.generationService instanceof OwnerTopazAstraGenerationService);
    assert.ok(runtime.serverOptions.ownerTopazAstra?.originalReferenceService instanceof OwnerTopazAstraOriginalReferenceService);
    assert.equal(calls, 0, "runtime composition must not request auth or provider data");
    assert.deepEqual(events, [], "enabled runtime composition must not request auth or provider data");
    const page = await reader.listExistingResults({ attemptId: ATTEMPT, page: 1 });
    assert.equal(page.results.length, 1);
    const artifact = await reader.getExistingResult({ attemptId: ATTEMPT, result_handle: page.results[0]!.result_handle });
    assert.equal(artifact.object_url, OUTPUT_URL, "a handle from discovery remains valid on the shared cached client");
    assert.deepEqual(events, ["GET /api/v1/chats", `GET /api/v1/chats/${CHAT_UUID}/messages`,
      `GET /api/v1/chats/${CHAT_UUID}/bot-message`, `GET /api/v1/chats/${CHAT_UUID}/bot-message`]);
  } finally {
    await runtime.ownerTopazAstraLifecycle?.close();
    store.close();
  }
});

test("Topaz invalidation and owner-stdio EOF drain the reader before generation and original services", async () => {
  const runtime = createObservedOwnerRuntime({ ownerTopazAstraEnabled: true, ownerTopazAstraFfprobePath: "/usr/bin/ffprobe",
    ownerTopazAstraUploadDestination: "hidden", fetchImpl: async () => { throw new Error("No startup request expected"); } });
  const lifecycle = runtime.ownerTopazAstraLifecycle;
  const reader = runtime.serverOptions.ownerTopazAstra?.existingMediaService;
  assert.ok(reader instanceof OwnerTopazAstraExistingMediaService);
  assert.ok(lifecycle);
  const targets = [
    [OwnerTopazAstraExistingMediaService.prototype, "invalidateAttempt"],
    [OwnerTopazAstraGenerationService.prototype, "invalidateAttempt"],
    [OwnerTopazAstraOriginalReferenceService.prototype, "invalidateAttempt"],
    [OwnerTopazAstraExistingMediaService.prototype, "close"],
    [OwnerTopazAstraGenerationService.prototype, "close"],
    [OwnerTopazAstraOriginalReferenceService.prototype, "close"]
  ] as const;
  const descriptors = targets.map(([prototype, key]) => Object.getOwnPropertyDescriptor(prototype, key)!);
  const events: string[] = [];
  let failReaderInvalidation = true;
  try {
    targets.forEach(([prototype, key], index) => {
      const method = descriptors[index]!.value as (...args: unknown[]) => Promise<void>;
      Object.defineProperty(prototype, key, { ...descriptors[index], value: async function (this: object, ...args: unknown[]) {
        events.push(["reader.invalidate", "generation.invalidate", "original.invalidate", "reader.close", "generation.close", "original.close"][index]!);
        await (Reflect.apply(method, this, args) as Promise<void>);
        if (index === 0 && key === "invalidateAttempt" && failReaderInvalidation) throw new Error("synthetic reader invalidation cleanup failure");
      } });
    });
    await assert.rejects(lifecycle.invalidateAttempt(ATTEMPT), /synthetic reader invalidation cleanup failure/u);
    assert.deepEqual(events, ["reader.invalidate", "generation.invalidate", "original.invalidate"]);
    failReaderInvalidation = false;
    events.length = 0;
    const transport = { onclose: undefined, close: async () => undefined } as unknown as Transport;
    const input = new PassThrough();
    const closeArgs = new Array(41).fill(undefined) as unknown as Parameters<typeof closeOwnerReadServicesOnTransportEof>;
    closeArgs[0] = transport;
    closeArgs[6] = input;
    closeArgs[40] = lifecycle;
    const closeOnEof = closeOwnerReadServicesOnTransportEof(...closeArgs);
    await closeOnEof();
    assert.deepEqual(events, ["reader.close", "generation.close", "original.close"]);
    input.destroy();
  } finally {
    targets.forEach(([prototype, key], index) => Object.defineProperty(prototype, key, descriptors[index]!));
    await lifecycle.close().catch(() => undefined);
    runtime.authStore.close?.();
  }
});
