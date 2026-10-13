import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChatMutationReceipt,
  CreateChatReceipt,
  InProgressMessage,
  MediaGenerationReceipt,
  RedactedMessageEnvelope
} from "../src/adapter/syntx/chat-http-client.js";
import {
  GenerationFinishedWithoutArtifactError,
  generateOneOwnerImage,
  type OwnerImageChatClient
} from "../src/application/owner-generate-image.js";
import { OwnerImageGenerationOutcomeUnknownError, OwnerImageRecoveryStore } from "../src/application/owner-image-recovery.js";

interface FakeChatClientOptions {
  onCreateChat?: () => void;
  onDeleteChat?: (chatUuid: string) => void;
  onStartImage?: (settings: Readonly<Record<string, unknown>>) => void;
  onStartImageRequest?: (request: { ai_name: string; settings: Readonly<Record<string, unknown>> }) => void;
  inProgressSequence: InProgressMessage[][];
  messageSequence: RedactedMessageEnvelope[];
  startImageResult?: MediaGenerationReceipt | Error;
}

function fakeChatClient(options: FakeChatClientOptions): OwnerImageChatClient {
  let inProgressCall = 0;
  let messageCall = 0;
  return {
    async createChat(_scope, _title): Promise<CreateChatReceipt> {
      options.onCreateChat?.();
      return { chat_uuid: "chat-fake-1" };
    },
    async deleteChat(chatUuid): Promise<ChatMutationReceipt> {
      options.onDeleteChat?.(chatUuid);
      return { chat_uuid: chatUuid, accepted: true };
    },
    async startImage(request): Promise<MediaGenerationReceipt> {
      options.onStartImage?.(request.settings);
      options.onStartImageRequest?.(request);
      if (options.startImageResult instanceof Error) throw options.startImageResult;
      return options.startImageResult ?? { chat_uuid: request.chat_uuid, message_id: "echo-1" };
    },
    async listInProgress(): Promise<InProgressMessage[]> {
      // .at(-1) (not `?? []`): a sequence ending in BOT_IN_PROGRESS repeats
      // "still running forever"; a sequence ending in [] repeats "gone".
      // An entirely empty sequence still means "never seen" ([] fallback).
      const entry = options.inProgressSequence[inProgressCall] ?? options.inProgressSequence.at(-1) ?? [];
      inProgressCall += 1;
      return entry;
    },
    async getMessage(): Promise<RedactedMessageEnvelope> {
      const message = options.messageSequence[messageCall] ?? options.messageSequence.at(-1);
      messageCall += 1;
      if (!message) throw new Error("test fixture exhausted");
      return message;
    }
  };
}

async function instant(): Promise<void> {
  // Real code waits between polls; tests skip the wall-clock delay entirely.
}

const BOT_IN_PROGRESS: InProgressMessage[] = [
  { message_id: "bot-1", message_object_id: "obj-1", object_type: "image", model_type: "banana" }
];
const PENDING_MESSAGE: RedactedMessageEnvelope = {
  chat_uuid: "chat-fake-1",
  message_id: "bot-1",
  artifacts: []
};
const READY_MESSAGE: RedactedMessageEnvelope = {
  chat_uuid: "chat-fake-1",
  message_id: "bot-1",
  artifacts: [{ url: "https://r2.syntx.ai/generated/fake.png", mime_type: "image/png" }]
};
const READY_MESSAGE_TWO_ARTIFACTS: RedactedMessageEnvelope = {
  chat_uuid: "chat-fake-1",
  message_id: "bot-1",
  artifacts: [
    { url: "https://r2.syntx.ai/generated/fake-1.png", mime_type: "image/png" },
    { url: "https://r2.syntx.ai/generated/fake-2.png", mime_type: "image/png" }
  ]
};

test("happy path: dispatches, finds the bot message, and returns its artifacts once ready without deleting the chat", async () => {
  let deleteCalls = 0;
  let settingsSeen: Readonly<Record<string, unknown>> | undefined;
  const client = fakeChatClient({
    onDeleteChat: () => {
      deleteCalls += 1;
    },
    onStartImage: (settings) => {
      settingsSeen = settings;
    },
    inProgressSequence: [BOT_IN_PROGRESS, BOT_IN_PROGRESS],
    messageSequence: [PENDING_MESSAGE, READY_MESSAGE]
  });

  const artifacts = await generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant);

  assert.deepEqual(artifacts, READY_MESSAGE.artifacts);
  assert.deepEqual(settingsSeen, { model_type: "banana" });
  // Long-term CDN retention after chat deletion is unconfirmed (only hours
  // were verified live) — the chat is deliberately left in place even on
  // success, so the owner can still find it if the link ever goes stale.
  assert.equal(deleteCalls, 0);
});

test("a thrown startImage outcome is typed unknown with an exact-attempt opaque recovery id and no retry/delete", async () => {
  const recoveryRecords = new Map<string, Record<string, unknown>>();
  let createCalls = 0;
  let startCalls = 0;
  let deleteCalls = 0;
  const recoveryStore = {
    create(input: Record<string, unknown>) {
      const record = { recovery_id: "recovery_00000000-0000-4000-8000-000000000001", ...input };
      recoveryRecords.set(String(record.recovery_id), record);
      return record;
    },
    get(recoveryId: string, attemptId: string) {
      const record = recoveryRecords.get(recoveryId);
      return record?.attempt_id === attemptId ? record : undefined;
    },
    updateMessageId() {},
    close() {}
  };
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onDeleteChat: () => { deleteCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    startImageResult: new Error("private upstream response and chat-fake-1"),
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(
      client, "private prompt must not escape", "1:1", undefined, instant,
      "banana", "default",
      { store: recoveryStore, attemptId: "link_owner_generate_test_attempt01", modelId: "banana" } as never
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "OwnerImageGenerationOutcomeUnknownError");
      assert.equal((error as Error & { code?: string }).code, "OUTCOME_UNKNOWN");
      assert.equal((error as Error & { recovery_id?: string }).recovery_id, "recovery_00000000-0000-4000-8000-000000000001");
      assert.equal(error.message.includes("private upstream response"), false);
      assert.equal(error.message.includes("chat-fake-1"), false);
      return true;
    }
  );
  assert.equal(createCalls, 1);
  assert.equal(startCalls, 1);
  assert.equal(deleteCalls, 0);
  const [record] = recoveryRecords.values();
  assert.equal(record?.attempt_id, "link_owner_generate_test_attempt01");
  assert.equal(record?.message_id, null);
});

test("an already-aborted signal cannot create a chat or enter startImage", async () => {
  const controller = new AbortController();
  controller.abort();
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });
  await assert.rejects(generateOneOwnerImage(client, "synthetic pre-abort", "1:1", controller.signal, instant));
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("abort while createChat ignores its signal prevents startImage and leaves no recovery pointer", async () => {
  const controller = new AbortController();
  const recoveryStore = new OwnerImageRecoveryStore();
  let createCalls = 0;
  let startCalls = 0;
  let deleteCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; controller.abort(); },
    onStartImage: () => { startCalls += 1; },
    onDeleteChat: () => { deleteCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });
  await assert.rejects(generateOneOwnerImage(
    client, "synthetic abort during create", "1:1", controller.signal, instant,
    "banana", "default", { store: recoveryStore, attemptId: "link_owner_generate_test_attempt01", modelId: "banana" }
  ));
  assert.equal(createCalls, 1);
  assert.equal(startCalls, 0);
  assert.equal(recoveryStore.list("link_owner_generate_test_attempt01").length, 0);
  assert.equal(deleteCalls, 1, "the existing best-effort empty-chat cleanup path runs before dispatch");
});

test("abort during recovery reservation removes the reserved pointer and blocks startImage", async () => {
  const controller = new AbortController();
  let startCalls = 0;
  let removeCalls = 0;
  const recoveryStore = {
    create(input: Record<string, unknown>) {
      controller.abort();
      return { ...input, recovery_id: "recovery_00000000-0000-4000-8000-000000000001" };
    },
    updateMessageId() {},
    remove() { removeCalls += 1; },
    get() { return undefined; },
    list() { return []; }
  };
  const client = fakeChatClient({
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });
  await assert.rejects(generateOneOwnerImage(
    client, "synthetic abort during reserve", "1:1", controller.signal, instant,
    "banana", "default", { store: recoveryStore, attemptId: "link_owner_generate_test_attempt01", modelId: "banana" } as never
  ));
  assert.equal(startCalls, 0);
  assert.equal(removeCalls, 1);
});

test("terminal-empty result keeps the bot message id for exact GET recovery", async () => {
  const store = new OwnerImageRecoveryStore();
  const attemptId = "link_owner_generate_test_attempt01";
  const client = fakeChatClient({
    inProgressSequence: [BOT_IN_PROGRESS, []],
    messageSequence: [PENDING_MESSAGE, PENDING_MESSAGE]
  });
  await assert.rejects(
    generateOneOwnerImage(client, "synthetic terminal-empty case", "1:1", undefined, instant, "banana", "default", {
      store, attemptId, modelId: "banana"
    }),
    (error: unknown) => {
      assert.ok(error instanceof OwnerImageGenerationOutcomeUnknownError);
      assert.equal(error.recovery_id !== undefined, true);
      return true;
    }
  );
  const [listed] = store.list(attemptId);
  const record = listed === undefined ? undefined : store.get(listed.recovery_id, attemptId);
  assert.equal(record?.message_id, "bot-1");
  assert.deepEqual(record?.mime_types, ["image/png"]);
});

test("external abort after startImage stays unknown and preserves the provider receipt id", async () => {
  const store = new OwnerImageRecoveryStore();
  const attemptId = "link_owner_generate_test_attempt01";
  const controller = new AbortController();
  const client = fakeChatClient({ inProgressSequence: [[]], messageSequence: [PENDING_MESSAGE] });
  const abortDuringPoll = async () => { controller.abort(); };
  await assert.rejects(
    generateOneOwnerImage(client, "synthetic abort case", "1:1", controller.signal, abortDuringPoll, "banana", "default", {
      store, attemptId, modelId: "banana"
    }),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError && error.recovery_id !== undefined
  );
  const [listed] = store.list(attemptId);
  const record = listed === undefined ? undefined : store.get(listed.recovery_id, attemptId);
  assert.equal(record?.message_id, "echo-1");
});

test("invalid start receipt remains typed unknown without retry or chat deletion", async () => {
  const store = new OwnerImageRecoveryStore();
  let starts = 0;
  let deletes = 0;
  const client = fakeChatClient({
    onStartImage: () => { starts += 1; },
    onDeleteChat: () => { deletes += 1; },
    startImageResult: { chat_uuid: "wrong-chat", message_id: "echo-invalid" },
    inProgressSequence: [],
    messageSequence: []
  });
  await assert.rejects(
    generateOneOwnerImage(client, "synthetic invalid receipt case", "1:1", undefined, instant, "banana", "default", {
      store, attemptId: "link_owner_generate_test_attempt01", modelId: "banana"
    }),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError && error.recovery_id !== undefined
  );
  assert.equal(starts, 1);
  assert.equal(deletes, 0);
  assert.equal(store.list("link_owner_generate_test_attempt01").length, 1);
  assert.equal(store.list("link_foreign_attempt_0000000000").length, 0);
});

test("aspect_ratio other than 1:1 is forwarded in settings", async () => {
  let settingsSeen: Readonly<Record<string, unknown>> | undefined;
  const client = fakeChatClient({
    onStartImage: (settings) => {
      settingsSeen = settings;
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a lighthouse", "16:9", undefined, instant);

  assert.deepEqual(settingsSeen, { model_type: "banana", aspect_ratio: "16:9" });
});

test("gpt-image-1 routes to sora-images with its exact live-verified settings", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant, "gpt-image-1");

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: { model_type: "gpt-image-1" }
  });
});

test("gpt-image-1.5 routes to sora-images with its exact live-verified settings", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a greenhouse", "1:1", undefined, instant, "gpt-image-1.5");

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: { model_type: "gpt-image-1.5" }
  });
});

test("gpt-image-1 rejects an unverified setting before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => {
      createCalls += 1;
    },
    onStartImage: () => {
      startCalls += 1;
    },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "16:9", undefined, instant, "gpt-image-1"),
    /gpt-image-1.*aspect_ratio/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("gpt-image-1.5 rejects an unverified setting before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => {
      createCalls += 1;
    },
    onStartImage: () => {
      startCalls += 1;
    },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "16:9", undefined, instant, "gpt-image-1.5"),
    /gpt-image-1\.5 only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("gpt-image-1.5 routes to sora-images with its matching exact settings", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant, "gpt-image-1.5");

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: { model_type: "gpt-image-1.5" }
  });
});

test("ideogram routes with the exact live-verified generate defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "ideogram");

  assert.deepEqual(requestSeen, {
    ai_name: "ideogram",
    settings: {
      model_type: "ideogram",
      rendering_speed: "TURBO",
      aspect_ratio: "1:1",
      resolution: "",
      style_type: "GENERAL",
      style_preset: "",
      magic_prompt: "AUTO",
      color_palette_mode: "preset",
      negative_prompt: "",
      num_images: 1,
      seed: null,
      mode: "generate",
      image_weight: 50,
      resemblance: 55,
      detail: 90
    }
  });
});

test("ideogram rejects an unverified aspect ratio before creating a chat", async () => {
  let createCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });
  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "ideogram"),
    /ideogram.*aspect_ratio/u
  );
  assert.equal(createCalls, 0);
});

test("flux-1 routes to flux with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "flux-1");

  assert.deepEqual(requestSeen, {
    ai_name: "flux",
    settings: {
      model_type: "flux-1",
      steps: 28,
      cfg: 3.5,
      resolution: "1024x1024",
      civitai_loras: [],
      workflow_type: "default",
      image_strength: 0.5
    }
  });
});

test("flux-1 rejects an unverified aspect ratio before creating a chat", async () => {
  let createCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });
  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "flux-1"),
    /flux-1.*aspect_ratio/u
  );
  assert.equal(createCalls, 0);
});

test("seedream-5 routes to seedream with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "seedream-5");

  assert.deepEqual(requestSeen, {
    ai_name: "seedream",
    settings: {
      model_type: "seedream-5",
      resolution: "2K",
      stream: false,
      aspect_ratio: "1:1"
    }
  });
});

test("seedream-4 routes to seedream with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "seedream-4");

  assert.deepEqual(requestSeen, {
    ai_name: "seedream",
    settings: {
      model_type: "seedream-4",
      resolution: "2K",
      stream: false,
      aspect_ratio: "1:1"
    }
  });
});

test("seedream-4.5 routes to seedream with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "seedream-4.5");

  assert.deepEqual(requestSeen, {
    ai_name: "seedream",
    settings: {
      model_type: "seedream-4.5",
      resolution: "2K",
      stream: false,
      aspect_ratio: "1:1"
    }
  });
});

test("seedream-5.0-pro routes to seedream with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "seedream-5.0-pro");

  assert.deepEqual(requestSeen, {
    ai_name: "seedream",
    settings: {
      model_type: "seedream-5.0-pro",
      resolution: "2K",
      stream: false,
      aspect_ratio: "1:1"
    }
  });
});

test("seedream-4.5 rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "seedream-4.5"),
    /seedream-4\.5 only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("seedream-4 rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "seedream-4"),
    /seedream-4 only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("seedream-5 rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "seedream-5"),
    /seedream-5 only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("grok_t2i routes to grok_image with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "grok_t2i");

  assert.deepEqual(requestSeen, {
    ai_name: "grok_image",
    settings: {
      model_type: "grok_t2i",
      aspect_ratio: "1:1",
      resolution: "1k",
      batch_size: 1
    }
  });
});

test("grok_t2i rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "grok_t2i"),
    /grok_t2i only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("grok_t2i_pro routes to grok_image with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "grok_t2i_pro");

  assert.deepEqual(requestSeen, {
    ai_name: "grok_image",
    settings: {
      model_type: "grok_t2i_pro",
      aspect_ratio: "1:1",
      resolution: "1k",
      batch_size: 1,
      details_quality: "low"
    }
  });
});

test("grok_t2i_pro rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "grok_t2i_pro"),
    /grok_t2i_pro only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("grok_imagine_2 routes to grok_image with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "grok_imagine_2");

  assert.deepEqual(requestSeen, {
    ai_name: "grok_image",
    settings: {
      model_type: "grok_imagine_2",
      aspect_ratio: "1:1",
      resolution: "1k",
      batch_size: 1,
      details_quality: "low"
    }
  });
});

test("grok_imagine_2 rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "grok_imagine_2"),
    /grok_imagine_2 only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("grok_imagine_quality routes to grok_image with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "grok_imagine_quality");

  assert.deepEqual(requestSeen, {
    ai_name: "grok_image",
    settings: {
      model_type: "grok_imagine_quality",
      aspect_ratio: "1:1",
      resolution: "1k",
      batch_size: 1,
      details_quality: "low"
    }
  });
});

test("grok_imagine_quality rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "grok_imagine_quality"),
    /grok_imagine_quality only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("runway_frames routes to runway-frames with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "runway_frames");

  assert.deepEqual(requestSeen, {
    ai_name: "runway-frames",
    settings: {
      model_type: "runway_frames",
      temperature: 3,
      resolution: "1088x1088"
    }
  });
});

test("runway_frames rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "runway_frames"),
    /runway_frames only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("wan_26_t2i routes to wan_image with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "wan_26_t2i");

  assert.deepEqual(requestSeen, {
    ai_name: "wan_image",
    settings: {
      model_type: "wan_26_t2i",
      aspect_ratio: "1:1",
      resolution: "720P",
      seed: null,
      batch_size: 1,
      prompt_extend: false,
      bbox_list: []
    }
  });
});

test("wan_26_t2i rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "wan_26_t2i"),
    /wan_26_t2i only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("uni-1 routes to luma_image with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "uni-1");

  assert.deepEqual(requestSeen, {
    ai_name: "luma_image",
    settings: { model_type: "uni-1" }
  });
});

test("uni-1 rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "uni-1"),
    /uni-1 only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("gpt-image-2.5-sunburst routes to sora-images with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "gpt-image-2.5-sunburst");

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: {
      model_type: "gpt-image-2.5-sunburst",
      aspect_ratio: "1:1",
      details_quality: "medium",
      quality: "1K"
    }
  });
});

test("gpt-image-2.5-sunburst accepts the live-verified 2K landscape settings variant", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(
    client,
    "a red fox",
    "1:1",
    undefined,
    instant,
    "gpt-image-2.5-sunburst",
    "sunburst-2k-high-16x9"
  );

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: {
      model_type: "gpt-image-2.5-sunburst",
      aspect_ratio: "16:9",
      details_quality: "high",
      quality: "2K"
    }
  });
});

test("gpt-image-2.5-sunburst accepts the live-verified 4K ultra-wide settings variant", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(
    client,
    "a red fox",
    "1:1",
    undefined,
    instant,
    "gpt-image-2.5-sunburst",
    "sunburst-4k-max-21x9"
  );

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: {
      model_type: "gpt-image-2.5-sunburst",
      aspect_ratio: "21:9",
      details_quality: "max",
      quality: "4K"
    }
  });
});

test("a Sunburst settings variant is rejected before chat creation for another model", async () => {
  let createCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(
      client,
      "a red fox",
      "1:1",
      undefined,
      instant,
      "gpt-image-1",
      "sunburst-2k-high-16x9"
    ),
    /settings_variant "sunburst-2k-high-16x9" is only supported for gpt-image-2\.5-sunburst or gpt-image-2\.5-flare/u
  );
  assert.equal(createCalls, 0);
});

test("gpt-image-2.5-sunburst rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "gpt-image-2.5-sunburst"),
    /gpt-image-2\.5-sunburst only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("gpt-image-2.5-flare routes to sora-images with its exact live-verified defaults", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(client, "a red fox", "1:1", undefined, instant, "gpt-image-2.5-flare");

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: {
      model_type: "gpt-image-2.5-flare",
      aspect_ratio: "1:1",
      details_quality: "medium",
      quality: "1K"
    }
  });
});

test("gpt-image-2.5-flare accepts the live-verified 2K landscape settings variant", async () => {
  let requestSeen: { ai_name: string; settings: Readonly<Record<string, unknown>> } | undefined;
  const client = fakeChatClient({
    onStartImageRequest: (request) => {
      requestSeen = { ai_name: request.ai_name, settings: request.settings };
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE]
  });

  await generateOneOwnerImage(
    client,
    "a red fox",
    "1:1",
    undefined,
    instant,
    "gpt-image-2.5-flare",
    "flare-2k-high-16x9"
  );

  assert.deepEqual(requestSeen, {
    ai_name: "sora-images",
    settings: {
      model_type: "gpt-image-2.5-flare",
      aspect_ratio: "16:9",
      details_quality: "high",
      quality: "2K"
    }
  });
});

test("gpt-image-2.5-flare rejects an unverified aspect ratio before creating a chat or paid POST", async () => {
  let createCalls = 0;
  let startCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => { createCalls += 1; },
    onStartImage: () => { startCalls += 1; },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a red fox", "16:9", undefined, instant, "gpt-image-2.5-flare"),
    /gpt-image-2\.5-flare only supports the live-verified aspect_ratio "1:1"/u
  );
  assert.equal(createCalls, 0);
  assert.equal(startCalls, 0);
});

test("an unknown owner model is rejected before creating a chat", async () => {
  let createCalls = 0;
  const client = fakeChatClient({
    onCreateChat: () => {
      createCalls += 1;
    },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant, "not-reviewed" as never),
    /model_id is not live-verified/u
  );
  assert.equal(createCalls, 0);
});

test("a message with several completed artifacts returns all of them, not just the first", async () => {
  const client = fakeChatClient({
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [READY_MESSAGE_TWO_ARTIFACTS]
  });

  const artifacts = await generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant);

  assert.deepEqual(artifacts, READY_MESSAGE_TWO_ARTIFACTS.artifacts);
});

test("any startImage failure is OUTCOME_UNKNOWN and leaves the chat in place", async () => {
  let deleteCalls = 0;
  const rejection = new Error("SYNTX rejected the request");
  const client = fakeChatClient({
    onDeleteChat: () => {
      deleteCalls += 1;
    },
    inProgressSequence: [],
    messageSequence: [],
    startImageResult: rejection
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError &&
      error.code === "OUTCOME_UNKNOWN" && error.recovery_id === undefined &&
      !error.message.includes("chat-fake-1") && !error.message.includes("SYNTX rejected the request")
  );
  assert.equal(deleteCalls, 0);
});

test("a dispatched-but-never-observed generation is OUTCOME_UNKNOWN without exposing the chat id", async () => {
  let deleteCalls = 0;
  const client = fakeChatClient({
    onDeleteChat: () => {
      deleteCalls += 1;
    },
    inProgressSequence: [],
    messageSequence: []
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError &&
      error.code === "OUTCOME_UNKNOWN" && !error.message.includes("chat-fake-1")
  );
  assert.equal(deleteCalls, 0);
});

test("a generation that stays in progress forever times out as OUTCOME_UNKNOWN", async () => {
  let deleteCalls = 0;
  const client = fakeChatClient({
    onDeleteChat: () => {
      deleteCalls += 1;
    },
    inProgressSequence: [BOT_IN_PROGRESS],
    messageSequence: [PENDING_MESSAGE]
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant),
    (error: unknown) => error instanceof OwnerImageGenerationOutcomeUnknownError &&
      error.code === "OUTCOME_UNKNOWN" && !error.message.includes("chat-fake-1")
  );
  assert.equal(deleteCalls, 0);
});

test("a message that disappears from in-progress without ever producing an artifact fails fast, not after the full timeout budget", async () => {
  let deleteCalls = 0;
  const client = fakeChatClient({
    onDeleteChat: () => {
      deleteCalls += 1;
    },
    // Found once by waitForBotMessageId, then gone on the very first check
    // inside waitForArtifacts — the real signal for "rejected/moderated/
    // failed", distinct from "still generating".
    inProgressSequence: [BOT_IN_PROGRESS, []],
    messageSequence: [PENDING_MESSAGE]
  });

  await assert.rejects(
    generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant),
    (error: unknown) => error instanceof GenerationFinishedWithoutArtifactError &&
      error instanceof OwnerImageGenerationOutcomeUnknownError && error.code === "OUTCOME_UNKNOWN" &&
      !error.message.includes("chat-fake-1")
  );
  assert.equal(deleteCalls, 0);
});

test("a terminal empty read is reconciled before it is classified as no artifact", async () => {
  const client = fakeChatClient({
    inProgressSequence: [BOT_IN_PROGRESS, []],
    messageSequence: [PENDING_MESSAGE, READY_MESSAGE]
  });

  const artifacts = await generateOneOwnerImage(client, "a lighthouse", "1:1", undefined, instant);

  assert.deepEqual(artifacts, READY_MESSAGE.artifacts);
});
