import assert from "node:assert/strict";
import test from "node:test";
import type { PreparedSyntxMediaRequest } from "../src/adapter/syntx/upstream-adapter.js";
import type { ChatMessageHistoryCandidate, ChatMessageHistorySnapshot } from "../src/adapter/syntx/chat-http-client.js";
import type {
  OwnerContractMediaClient,
  OwnerContractMediaContractContext,
  OwnerContractMediaReadClient
} from "../src/application/owner-contract-media.js";
import {
  OwnerContractMediaError,
  OwnerContractMediaService
} from "../src/application/owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "../src/application/owner-contract-media-recovery.js";

const ATTEMPT_ID = "link_owner_contract_media_attempt01";
const IMAGE_CHAT = "chat-owner-contract-image";
const VIDEO_CHAT = "chat-owner-contract-video";

const imageContract: OwnerContractMediaContractContext = {
  model_id: "banana-2.1",
  operation_id: "generate-image",
  modality: "image",
  ai_name: "banana",
  model_type: "banana-2.1",
  schema_hash: `sha256:${"a".repeat(64)}`,
  status: "live_verified",
  mime_types: ["image/jpeg"]
};

const videoContract: OwnerContractMediaContractContext = {
  model_id: "seedance_pro-fast",
  operation_id: "generate-video",
  modality: "video",
  ai_name: "seedance",
  model_type: "seedance_pro-fast",
  schema_hash: `sha256:${"b".repeat(64)}`,
  status: "live_verified",
  mime_types: ["video/mp4"]
};

const imagePrepared: PreparedSyntxMediaRequest = {
  prompt: "one source-backed image request",
  ai_name: "banana",
  modality: "image",
  schema_hash: imageContract.schema_hash,
  settings: {
    n: 1,
    model_type: "banana-2.1",
    aspect_ratio: "1:1",
    image_size: "1K",
    thinking_level: "minimal",
    file_urls: []
  }
};

const videoPrepared: PreparedSyntxMediaRequest = {
  prompt: "one source-backed video request",
  ai_name: "seedance",
  modality: "video",
  schema_hash: videoContract.schema_hash,
  settings: {
    model_type: "seedance_pro-fast",
    resolution: "720p",
    mode: "mini",
    aspect_ratio: "16:9",
    video_duration: 5,
    generate_audio: true,
    file_urls: []
  }
};

function makeClient(options: {
  readonly startImage?: OwnerContractMediaClient["startImage"];
  readonly startVideo?: OwnerContractMediaClient["startVideo"];
  readonly listInProgress?: OwnerContractMediaClient["listInProgress"];
  readonly getMessage?: OwnerContractMediaClient["getMessage"];
  readonly listMessageCandidates?: OwnerContractMediaClient["listMessageCandidates"];
  readonly onStart?: (kind: "image" | "video", request: unknown) => void;
} = {}): { client: OwnerContractMediaClient; calls: { create: number; image: number; video: number; list: number; get: number } } {
  const calls = { create: 0, image: 0, video: 0, list: 0, get: 0 };
  const client: OwnerContractMediaClient = {
    async createChat(scope) {
      calls.create += 1;
      return { chat_uuid: scope === "image" ? IMAGE_CHAT : VIDEO_CHAT };
    },
    async startImage(request) {
      calls.image += 1;
      options.onStart?.("image", structuredClone(request));
      return options.startImage
        ? options.startImage(request)
        : { chat_uuid: request.chat_uuid, message_id: "image-echo" };
    },
    async startVideo(request) {
      calls.video += 1;
      options.onStart?.("video", structuredClone(request));
      return options.startVideo
        ? options.startVideo(request)
        : { chat_uuid: request.chat_id, message_id: "video-echo" };
    },
    async listInProgress(chatUuid, signal) {
      calls.list += 1;
      return options.listInProgress
        ? options.listInProgress(chatUuid, signal)
        : [{
            message_id: chatUuid === IMAGE_CHAT ? "image-result" : "video-result",
            message_object_id: null,
            object_type: chatUuid === IMAGE_CHAT ? "image" : "video",
            model_type: chatUuid === IMAGE_CHAT ? imageContract.model_type : videoContract.model_type
          }];
    },
    async getMessage(chatUuid, messageId, signal) {
      calls.get += 1;
      if (options.getMessage) return options.getMessage(chatUuid, messageId, signal);
      const image = chatUuid === IMAGE_CHAT;
      const isDispatchEcho = messageId === (image ? "image-echo" : "video-echo");
      return {
        chat_uuid: chatUuid,
        message_id: messageId,
        object_type: isDispatchEcho ? "text" : image ? "image" : "video",
        model_type: image ? imageContract.model_type : videoContract.model_type,
        artifacts: isDispatchEcho ? [] : [{
          url: image ? "https://r2.syntx.ai/owner-contract/image.jpg" : "https://r2.syntx.ai/owner-contract/video.mp4",
          mime_type: image ? "image/jpeg" : "video/mp4"
        }]
      };
    },
    ...(options.listMessageCandidates === undefined ? {} : {
      listMessageCandidates: options.listMessageCandidates
    })
  };
  return { client, calls };
}

test("a fast completed image result is recovered from bounded owned-chat history before polling", async () => {
  const history: ChatMessageHistorySnapshot = {
    complete: true,
    page: 1,
    page_size: 10,
    total_count: 2,
    total_pages: 1,
    has_next: false,
    has_previous: false,
    provider_chat_id: "412",
    messages: [
      { message_id: "completed-image", provider_chat_id: "412", author_role: "bot", objects: [
        { message_object_id: "completed-image-object", object_type: "image", model_type: "banana-2.1" }
      ] },
      { message_id: "image-echo", provider_chat_id: "412", author_role: "owner", objects: [] }
    ]
  };
  const { client, calls } = makeClient({
    listInProgress: async () => [],
    listMessageCandidates: async (_chat, echo) => {
      assert.equal(echo, "image-echo");
      return history;
    },
    getMessage: async (chatUuid, messageId) => ({
      chat_uuid: chatUuid,
      message_id: messageId,
      object_type: messageId === "image-echo" ? "text" : "image",
      model_type: "banana-2.1",
      artifacts: messageId === "image-echo" ? [] : [{
        url: "https://r2.syntx.ai/owner-contract/fast-image.jpg", mime_type: "image/jpeg"
      }]
    })
  });

  const result = await createService().generate({
    client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
  });

  assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/fast-image.jpg", mime_type: "image/jpeg" }]);
  assert.equal(calls.image, 1);
  assert.equal(calls.list, 0);
  assert.equal(calls.get, 2);
});

test("a history-bound image that is still pending is polled by its exact message ID", async () => {
  let resultReads = 0;
  const history: ChatMessageHistorySnapshot = {
    complete: true, page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false, provider_chat_id: "412",
    messages: [
      { message_id: "image-echo", provider_chat_id: "412", author_role: "owner", objects: [] },
      { message_id: "pending-image", provider_chat_id: "412", author_role: "bot", objects: [
        { message_object_id: "pending-image-object", object_type: "image", model_type: "banana-2.1" }
      ] }
    ]
  };
  const { client, calls } = makeClient({
    listMessageCandidates: async () => history,
    listInProgress: async () => [{
      message_id: "pending-image", message_object_id: "pending-image-object",
      object_type: "image", model_type: "banana-2.1"
    }],
    getMessage: async (chatUuid, messageId) => {
      assert.ok(messageId === "image-echo" || messageId === "pending-image");
      if (messageId === "pending-image") resultReads += 1;
      return {
        chat_uuid: chatUuid, message_id: messageId,
        object_type: messageId === "image-echo" ? "text" : "image",
        model_type: "banana-2.1",
        artifacts: resultReads < 2 ? [] : [{
          url: "https://r2.syntx.ai/owner-contract/pending-image.jpg", mime_type: "image/jpeg"
        }]
      };
    }
  });
  const waits: number[] = [];
  const service = createService({ wait: async (milliseconds) => { waits.push(milliseconds); } });

  const result = await service.generate({
    client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
  });

  assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/pending-image.jpg", mime_type: "image/jpeg" }]);
  assert.equal(calls.image, 1);
  assert.equal(calls.list, 1);
  assert.ok(waits.includes(3_000));
});

test("ambiguous or mismatched owned-chat history fails closed after one image dispatch", async () => {
  const owner: ChatMessageHistoryCandidate = {
    message_id: "image-echo", provider_chat_id: "412", author_role: "owner", objects: []
  };
  const bot: ChatMessageHistoryCandidate = {
    message_id: "image-result", provider_chat_id: "412", author_role: "bot" as const,
    objects: [{ message_object_id: "image-object", object_type: "image", model_type: "banana-2.1" }]
  };
  const base: ChatMessageHistorySnapshot = {
    complete: true, page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false, provider_chat_id: "412", messages: [owner, bot]
  };
  const invalidHistories: ChatMessageHistorySnapshot[] = [
    { ...base, has_next: true } as unknown as ChatMessageHistorySnapshot,
    { ...base, provider_chat_id: "not-numeric" },
    { ...base, messages: [owner, { ...bot, provider_chat_id: "413" }] },
    { ...base, messages: [owner, { ...bot, objects: [{ message_object_id: "image-object", object_type: "image", model_type: "other-model" }] }] },
    { ...base, messages: [owner, { ...bot, objects: [{ message_object_id: "image-object", object_type: "video", model_type: "banana-2.1" }] }] },
    { ...base, total_count: 3, messages: [owner, bot, { ...bot, message_id: "second-bot" }] },
    { ...base, total_count: 3, messages: [owner, bot, { ...owner, message_id: "second-owner" }] },
    { ...base, total_count: 3, messages: [owner, bot, { ...bot, author_role: "other" as const, message_id: "extra-row" }] }
  ];

  for (const history of invalidHistories) {
    const { client, calls } = makeClient({
      listMessageCandidates: async () => history,
      getMessage: async (chatUuid, messageId) => ({
        chat_uuid: chatUuid, message_id: messageId, object_type: "text", model_type: "banana-2.1", artifacts: []
      }),
      listInProgress: async () => { throw new Error("invalid history must not fall back to a guess"); }
    });
    await assert.rejects(createService().generate({
      client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
    }), (error: unknown) => error instanceof OwnerContractMediaError &&
      error.code === "OUTCOME_UNKNOWN" && /^recovery_[0-9a-f-]{36}$/u.test(error.recoveryId ?? ""));
    assert.equal(calls.image, 1);
  }
});

test("read-only reconciliation can bind the known owner echo to a completed history result", async () => {
  const recoveryStore = new OwnerContractMediaRecoveryStore({ ttlMs: 60_000, maxRecords: 8 });
  const service = new OwnerContractMediaService({ recoveryStore, wait: async () => undefined, imageTimeoutMs: 15 });
  let historyReads = 0;
  const ownerOnly: ChatMessageHistorySnapshot = {
    complete: true, page: 1, page_size: 10, total_count: 1, total_pages: 1,
    has_next: false, has_previous: false, provider_chat_id: "412",
    messages: [{ message_id: "image-echo", provider_chat_id: "412", author_role: "owner", objects: [] }]
  };
  const completed: ChatMessageHistorySnapshot = {
    ...ownerOnly,
    total_count: 2,
    messages: [
      ownerOnly.messages[0]!,
      { message_id: "completed-image", provider_chat_id: "412", author_role: "bot", objects: [
        { message_object_id: "completed-image-object", object_type: "image", model_type: "banana-2.1" }
      ] }
    ]
  };
  const { client, calls } = makeClient({
    listMessageCandidates: async () => ++historyReads === 1 ? ownerOnly : completed,
    listInProgress: async () => [],
    getMessage: async (chatUuid, messageId) => ({
      chat_uuid: chatUuid, message_id: messageId,
      object_type: messageId === "image-echo" ? "text" : "image", model_type: "banana-2.1",
      artifacts: messageId === "completed-image" ? [{
        url: "https://r2.syntx.ai/owner-contract/reconciled-image.jpg", mime_type: "image/jpeg"
      }] : []
    })
  });
  let recoveryId = "";
  await assert.rejects(service.generate({
    client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
  }), (error: unknown) => {
    assert.ok(error instanceof OwnerContractMediaError);
    assert.equal(error.code, "OUTCOME_UNKNOWN");
    recoveryId = error.recoveryId ?? "";
    return true;
  });
  const readOnlyClient: OwnerContractMediaReadClient = {
    listInProgress: (chatUuid, signal) => client.listInProgress(chatUuid, signal),
    getMessage: (chatUuid, messageId, signal) => client.getMessage(chatUuid, messageId, signal),
    listMessageCandidates: (chatUuid, echo, signal) => client.listMessageCandidates!(chatUuid, echo, signal)
  };

  const recovered = await service.reconcile({
    client: readOnlyClient, attemptId: ATTEMPT_ID, recoveryId, contract: imageContract
  });

  assert.deepEqual(recovered.artifacts, [{
    url: "https://r2.syntx.ai/owner-contract/reconciled-image.jpg", mime_type: "image/jpeg"
  }]);
  assert.equal(calls.image, 1);
  assert.equal(calls.create, 1);
});

function createService(options: {
  imageTimeoutMs?: number;
  videoTimeoutMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
} = {}) {
  return new OwnerContractMediaService({
    recoveryStore: new OwnerContractMediaRecoveryStore({
      ...(options.now === undefined ? {} : { now: options.now }),
      ttlMs: 60_000,
      maxRecords: 8
    }),
    imageTimeoutMs: options.imageTimeoutMs ?? 5_000,
    videoTimeoutMs: options.videoTimeoutMs ?? 5_000,
    wait: options.wait ?? (async () => undefined),
    now: options.now ?? (() => 1_800_000_000_000)
  });
}

test("prepared live image contract dispatches the exact image payload once", async () => {
  let captured: unknown;
  const { client, calls } = makeClient({ onStart: (_kind, request) => { captured = request; } });
  const result = await createService().generate({
    client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
  });
  assert.deepEqual(captured, {
    ai_name: "banana",
    chat_uuid: IMAGE_CHAT,
    prompt: "one source-backed image request",
    settings: {
      n: 1,
      model_type: "banana-2.1",
      aspect_ratio: "1:1",
      image_size: "1K",
      thinking_level: "minimal",
      file_urls: []
    }
  });
  assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/image.jpg", mime_type: "image/jpeg" }]);
  assert.deepEqual(calls, { create: 1, image: 1, video: 0, list: 1, get: 2 });
});

test("prepared live video contract dispatches the exact video payload once", async () => {
  let captured: unknown;
  const { client, calls } = makeClient({ onStart: (_kind, request) => { captured = request; } });
  const result = await createService().generate({
    client, attemptId: ATTEMPT_ID, contract: videoContract, prepared: videoPrepared
  });
  assert.deepEqual(captured, {
    ai_name: "seedance",
    chat_id: VIDEO_CHAT,
    prompt: "one source-backed video request",
    settings: {
      model_type: "seedance_pro-fast",
      resolution: "720p",
      mode: "mini",
      aspect_ratio: "16:9",
      video_duration: 5,
      generate_audio: true,
      file_urls: []
    }
  });
  assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/video.mp4", mime_type: "video/mp4" }]);
  assert.deepEqual(calls, { create: 1, image: 0, video: 1, list: 1, get: 2 });
});

test("receipt echo and wrong modality/model/MIME DTOs never surface as contract artifacts", async () => {
  const mismatches = [
    { object_type: "text", model_type: "banana-2.1", mime_type: "image/jpeg" },
    { object_type: "image", model_type: "banana", mime_type: "image/jpeg" },
    { object_type: "image", model_type: "banana-2.1", mime_type: "image/png" }
  ] as const;
  for (const mismatch of mismatches) {
    const { client, calls } = makeClient({
      listInProgress: async () => [{
        message_id: "image-result", message_object_id: null, object_type: "image", model_type: "banana-2.1"
      }],
      getMessage: async (chatUuid, messageId) => ({
        chat_uuid: chatUuid,
        message_id: messageId,
        object_type: mismatch.object_type,
        model_type: mismatch.model_type,
        artifacts: [{ url: "https://r2.syntx.ai/owner-contract/mismatched.jpg", mime_type: mismatch.mime_type }]
      })
    });
    await assert.rejects(
      createService({ imageTimeoutMs: 100 }).generate({
        client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
      }),
      (error: unknown) => error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && !!error.recoveryId
    );
    assert.equal(calls.image, 1);
    assert.equal(calls.video, 0);
    assert.equal(calls.create, 1);
  }
});

test("mismatched prepared identity or non-live contract is rejected before chat creation", async () => {
  const { client, calls } = makeClient();
  await assert.rejects(
    createService().generate({
      client, attemptId: ATTEMPT_ID,
      contract: { ...imageContract, status: "reviewed" },
      prepared: imagePrepared
    }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH"
  );
  await assert.rejects(
    createService().generate({
      client, attemptId: ATTEMPT_ID,
      contract: imageContract,
      prepared: { ...imagePrepared, ai_name: "seedance" }
    }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH"
  );
  assert.equal(calls.create, 0);
  assert.equal(calls.image + calls.video, 0);
});

test("caller-provided reference URLs are rejected before owner chat creation", async () => {
  const { client, calls } = makeClient();
  await assert.rejects(
    createService().generate({
      client,
      attemptId: ATTEMPT_ID,
      contract: imageContract,
      prepared: {
        ...imagePrepared,
        settings: { ...imagePrepared.settings, file_urls: ["https://example.invalid/reference.jpg"] }
      }
    }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH"
  );
  assert.deepEqual(calls, { create: 0, image: 0, video: 0, list: 0, get: 0 });
});

test("a dispatch exception returns a redacted unknown handle and does not retry", async () => {
  const privatePrompt = "private prompt value";
  const privateChat = "private-chat-uuid-not-for-mcp";
  const { client, calls } = makeClient({
    startImage: async () => { throw new Error(`${privatePrompt} ${privateChat} private upstream trace`); }
  });
  const service = createService();
  await assert.rejects(
    service.generate({
      client, attemptId: ATTEMPT_ID, contract: imageContract,
      prepared: { ...imagePrepared, prompt: privatePrompt }
    }),
    (error: unknown) => {
      assert.ok(error instanceof OwnerContractMediaError);
      assert.equal(error.code, "OUTCOME_UNKNOWN");
      assert.match(error.recoveryId ?? "", /^recovery_[0-9a-f-]{36}$/u);
      assert.equal(error.message.includes(privatePrompt), false);
      assert.equal(error.message.includes(privateChat), false);
      assert.equal(error.message.includes("private upstream trace"), false);
      return true;
    }
  );
  assert.equal(calls.create, 1);
  assert.equal(calls.image, 1);
  assert.equal(calls.video, 0);
});

test("a malformed dispatch receipt after start also returns OUTCOME_UNKNOWN with a handle", async () => {
  const { client, calls } = makeClient({
    startImage: async (request) => ({ chat_uuid: request.chat_uuid, message_id: "not a safe receipt id" })
  });
  await assert.rejects(
    createService().generate({ client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" &&
      /^recovery_[0-9a-f-]{36}$/u.test(error.recoveryId ?? "")
  );
  assert.equal(calls.create, 1);
  assert.equal(calls.image, 1);
  assert.equal(calls.video, 0);
  assert.equal(calls.list, 0);
});

test("a missing terminal artifact remains OUTCOME_UNKNOWN and is reconciled with GET only", async () => {
  const recoveryStore = new OwnerContractMediaRecoveryStore({ ttlMs: 60_000, maxRecords: 8, now: () => 100 });
  const service = new OwnerContractMediaService({ recoveryStore, now: () => 100, wait: async () => undefined, imageTimeoutMs: 5_000 });
  const clientState = { list: 0, get: 0, starts: 0 };
  const client = makeClient({
    startImage: async (request) => {
      clientState.starts += 1;
      return { chat_uuid: request.chat_uuid, message_id: "echo-image" };
    },
    listInProgress: async () => { clientState.list += 1; return []; },
    getMessage: async (chatUuid, messageId) => {
      clientState.get += 1;
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana-2.1", artifacts: [] };
    }
  }).client;
  let recoveryId = "";
  await assert.rejects(
    service.generate({ client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared }),
    (error: unknown) => {
      assert.ok(error instanceof OwnerContractMediaError);
      assert.equal(error.code, "OUTCOME_UNKNOWN");
      recoveryId = error.recoveryId ?? "";
      return true;
    }
  );
  const readOnlyOwnerClient = makeClient({
    startImage: async () => { clientState.starts += 1; throw new Error("POST must not run"); },
    startVideo: async () => { clientState.starts += 1; throw new Error("POST must not run"); },
    listInProgress: async () => [{
      message_id: "image-result", message_object_id: null, object_type: "image", model_type: "banana-2.1"
    }],
    getMessage: async (chatUuid) => ({
      chat_uuid: chatUuid, message_id: "image-result", object_type: "image", model_type: "banana-2.1",
      artifacts: [{ url: "https://r2.syntx.ai/owner-contract/recovered.jpg", mime_type: "image/jpeg" }]
    })
  }).client;
  const readOnlyClient: OwnerContractMediaReadClient = {
    listInProgress: (chatUuid, signal) => readOnlyOwnerClient.listInProgress(chatUuid, signal),
    getMessage: (chatUuid, messageId, signal) => readOnlyOwnerClient.getMessage(chatUuid, messageId, signal)
  };
  const recovered = await service.reconcile({
    client: readOnlyClient, attemptId: ATTEMPT_ID, recoveryId, contract: imageContract
  });
  assert.deepEqual(recovered.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/recovered.jpg", mime_type: "image/jpeg" }]);
  assert.equal(clientState.starts, 1);
});

test("a terminal artifact at the verified dispatch receipt is returned even when the queue is empty", async () => {
  const { client, calls } = makeClient({
    startImage: async (request) => ({ chat_uuid: request.chat_uuid, message_id: "terminal-image" }),
    listInProgress: async () => [],
    getMessage: async (chatUuid, messageId) => ({
      chat_uuid: chatUuid,
      message_id: messageId,
      object_type: "image",
      model_type: "banana-2.1",
      artifacts: [{ url: "https://r2.syntx.ai/owner-contract/terminal.jpg", mime_type: "image/jpeg" }]
    })
  });
  const result = await createService().generate({
    client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
  });
  assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/terminal.jpg", mime_type: "image/jpeg" }]);
  assert.deepEqual(calls, { create: 1, image: 1, video: 0, list: 0, get: 1 });
});

test("unknown recovery retains the verified receipt id when the bot queue is already empty", async () => {
  let reads = 0;
  const { client, calls } = makeClient({
    startImage: async (request) => ({ chat_uuid: request.chat_uuid, message_id: "receipt-image" }),
    listInProgress: async () => [],
    getMessage: async (chatUuid, messageId) => {
      reads += 1;
      return {
        chat_uuid: chatUuid,
        message_id: messageId,
        object_type: "image",
        model_type: "banana-2.1",
        artifacts: reads === 1 ? [] : [{ url: "https://r2.syntx.ai/owner-contract/recovered-receipt.jpg", mime_type: "image/jpeg" }]
      };
    }
  });
  const service = createService({ imageTimeoutMs: 50 });
  let recoveryId = "";
  await assert.rejects(service.generate({
    client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared
  }), (error: unknown) => {
    assert.ok(error instanceof OwnerContractMediaError);
    assert.equal(error.code, "OUTCOME_UNKNOWN");
    recoveryId = error.recoveryId ?? "";
    return true;
  });
  const recovered = await service.reconcile({
    client, attemptId: ATTEMPT_ID, recoveryId, contract: imageContract
  });
  assert.deepEqual(recovered.artifacts, [{ url: "https://r2.syntx.ai/owner-contract/recovered-receipt.jpg", mime_type: "image/jpeg" }]);
  assert.equal(calls.image, 1);
  assert.equal(calls.video, 0);
  assert.equal(calls.create, 1);
});

test("foreign, expired and contract-mismatched recovery handles fail before reads", async () => {
  let now = 100;
  const store = new OwnerContractMediaRecoveryStore({ ttlMs: 5, maxRecords: 4, now: () => now });
  const service = new OwnerContractMediaService({ recoveryStore: store, now: () => now, wait: async () => undefined, imageTimeoutMs: 5_000 });
  const client = makeClient({ startImage: async () => { throw new Error("dispatch uncertain"); } }).client;
  let recoveryId = "";
  await assert.rejects(service.generate({ client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared }), (error: unknown) => {
    assert.ok(error instanceof OwnerContractMediaError);
    recoveryId = error.recoveryId ?? "";
    return error.code === "OUTCOME_UNKNOWN";
  });
  const calls = makeClient();
  await assert.rejects(service.reconcile({
    client: calls.client, attemptId: "link_other_attempt123456", recoveryId, contract: imageContract
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND");
  await assert.rejects(service.reconcile({
    client: calls.client, attemptId: ATTEMPT_ID, recoveryId, contract: { ...imageContract, schema_hash: `sha256:${"c".repeat(64)}` }
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND");
  now = 106;
  await assert.rejects(service.reconcile({
    client: calls.client, attemptId: ATTEMPT_ID, recoveryId, contract: imageContract
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND");
  assert.deepEqual(calls.calls, { create: 0, image: 0, video: 0, list: 0, get: 0 });
});

test("recovery record binds an optional V2 variant id as well as its schema hash", async () => {
  const store = new OwnerContractMediaRecoveryStore({ now: () => 1_800_000_000_000 });
  const contract = { ...imageContract, variant_id: "banana21-image-1k-minimal-square" };
  const record = store.create({
    attemptId: ATTEMPT_ID,
    chatUuid: IMAGE_CHAT,
    messageId: "image-echo",
    contract,
    now: 1_800_000_000_000
  });
  assert.equal(record.variant_id, "banana21-image-1k-minimal-square");
  const { client, calls } = makeClient();
  const service = new OwnerContractMediaService({ recoveryStore: store, wait: async () => undefined, now: () => 1_800_000_000_000 });
  await assert.rejects(
    service.reconcile({
      client, attemptId: ATTEMPT_ID, recoveryId: record.recovery_id,
      contract: { ...contract, variant_id: "different-reviewed-variant" }
    }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND"
  );
  assert.equal(calls.list + calls.get, 0, "variant mismatch is rejected before any GET");
});

test("deadline covers reads after dispatch and converts timeout or external abort to OUTCOME_UNKNOWN", async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    const never = new Promise<never>(() => undefined);
    const { client, calls } = makeClient({
      listInProgress: async () => {
        if (abort) controller.abort();
        return never;
      }
    });
    await assert.rejects(
      createService({ imageTimeoutMs: 5 }).generate({
        client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared,
        signal: controller.signal
      }),
      (error: unknown) => error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && !!error.recoveryId
    );
    assert.equal(calls.image, 1);
    assert.equal(calls.create, 1);
  }
});

test("video waits use a separate bounded video deadline", async () => {
  const never = new Promise<never>(() => undefined);
  const { client, calls } = makeClient({ listInProgress: async () => never });
  await assert.rejects(
    createService({ videoTimeoutMs: 5 }).generate({
      client, attemptId: ATTEMPT_ID, contract: videoContract, prepared: videoPrepared
    }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && !!error.recoveryId
  );
  assert.equal(calls.create, 1);
  assert.equal(calls.video, 1);
  assert.equal(calls.image, 0);
});

test("deadline overrides may shorten but never exceed the modality upper bounds", () => {
  const recoveryStore = new OwnerContractMediaRecoveryStore();
  assert.throws(() => new OwnerContractMediaService({ recoveryStore, imageTimeoutMs: 180_001 }));
  assert.throws(() => new OwnerContractMediaService({ recoveryStore, videoTimeoutMs: 420_001 }));
});

test("an abort before any chat or dispatch is a pre-dispatch failure without a recovery handle", async () => {
  const controller = new AbortController();
  controller.abort();
  const { client, calls } = makeClient();
  await assert.rejects(
    createService().generate({
      client, attemptId: ATTEMPT_ID, contract: imageContract, prepared: imagePrepared,
      signal: controller.signal
    }),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED" && error.recoveryId === undefined
  );
  assert.deepEqual(calls, { create: 0, image: 0, video: 0, list: 0, get: 0 });
});
