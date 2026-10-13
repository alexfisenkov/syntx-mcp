import assert from "node:assert/strict";
import test from "node:test";
import {
  SyntxChatHttpClient,
  type SyntxChatHttpClientOptions
} from "../src/adapter/syntx/chat-http-client.js";
import {
  SyntxHttpError,
  type SyntxCredentialBroker
} from "../src/adapter/syntx/http-client.js";

const SECRET = ["owner", "chat", "secret", "that", "must", "never", "leak"].join("-");

interface SeenRequest {
  url: string;
  method: string;
  authorization: string | null;
  contentType: string | null;
  redirect: RequestRedirect | undefined;
  body: string | undefined;
}

function brokerWith(value: string): SyntxCredentialBroker {
  return {
    async useCredential<T>(
      operation: (credential: string) => Promise<T>
    ): Promise<T> {
      return operation(value);
    }
  };
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(init?.headers).entries())
    }
  });
}

function makeClient(
  fetchImpl: typeof fetch,
  options: Partial<Pick<SyntxChatHttpClientOptions, "requestTimeoutMs" | "maxResponseBytes">> = {}
): SyntxChatHttpClient {
  return new SyntxChatHttpClient({
    credentialBroker: brokerWith(SECRET),
    fetchImpl,
    ...options
  });
}

function captureRequest(
  input: string | URL | Request,
  init: RequestInit | undefined
): SeenRequest {
  return {
    url: String(input),
    method: init?.method ?? "GET",
    authorization: new Headers(init?.headers).get("authorization"),
    contentType: new Headers(init?.headers).get("content-type"),
    redirect: init?.redirect,
    body: typeof init?.body === "string" ? init.body : undefined
  };
}

function uploadRequest() {
  return {
    bytes: Uint8Array.from([137, 80, 78, 71]),
    filename: "probe.png",
    mime_type: "image/png",
    destination: "hidden" as const,
    check_duplicates: true as const,
    model_type: "banana"
  };
}

test("internal upload reference bridge reuses the fixed multipart route", async () => {
  let fetchCalls = 0;
  const client = makeClient(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
    assert.equal(new Headers(init?.headers).get("content-type"), null);
    assert.ok(init?.body instanceof FormData);
    const form = init.body as FormData;
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "banana");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "probe.png");
    assert.equal(file.type, "image/png");
    return jsonResponse({
      files: [{ id: 42, url: "https://r2.syntx.ai/uploaded/probe.png" }],
      private_token: SECRET
    });
  });

  assert.deepEqual(await client.uploadFileReferences(uploadRequest()), [{
    file_id: "42",
    url: "https://r2.syntx.ai/uploaded/probe.png"
  }]);
  assert.equal(fetchCalls, 1);
});

test("internal upload reference bridge rejects an unsafe host and missing URL", async () => {
  for (const payload of [
    { files: [{ id: "file-1", url: "https://attacker.invalid/probe.png" }] },
    { files: [{ id: "file-1" }] }
  ]) {
    const client = makeClient(async () => jsonResponse(payload));
    await assert.rejects(
      client.uploadFileReferences(uploadRequest()),
      (error: unknown) =>
        error instanceof SyntxHttpError &&
        error.code === "UPSTREAM_PROTOCOL_ERROR"
    );
  }
});

test("internal i2v bridge injects only validated upload references", async () => {
  const client = makeClient(async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/video/generate?ai_name=wan_video");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.settings, {
      model_type: "wan_26_i2v",
      file_urls: ["https://r2.syntx.ai/uploaded/probe.png"],
      aspect_ratio: "1:1",
      resolution: "720P",
      video_duration: 5,
      prompt_extend: true,
      shot_type: "single",
      audio_setting: "auto",
      seed: null,
      native_audio: false
    });
    return jsonResponse({ id: 700 });
  });
  assert.deepEqual(await client.startVideoWithInternalReferences({
    ai_name: "wan_video",
    chat_id: "chat-i2v",
    prompt: "Animate this image",
    settings: {
      model_type: "wan_26_i2v",
      file_urls: [],
      aspect_ratio: "1:1",
      resolution: "720P",
      video_duration: 5,
      prompt_extend: true,
      shot_type: "single",
      audio_setting: "auto",
      seed: null,
      native_audio: false
    }
  }, [{ url: "https://r2.syntx.ai/uploaded/probe.png" }]), {
    chat_uuid: "chat-i2v",
    message_id: "700"
  });
});

test("internal i2v bridge rejects caller-supplied nonempty file_urls", async () => {
  const client = makeClient(async () => jsonResponse({ id: 1 }));
  await assert.rejects(
    client.startVideoWithInternalReferences({
      ai_name: "wan_video",
      chat_id: "chat-i2v",
      prompt: "Animate",
      settings: { model_type: "wan_26_i2v", file_urls: ["https://r2.syntx.ai/x"] }
    }, [{ url: "https://r2.syntx.ai/uploaded/probe.png" }]),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST"
  );
});

test("public upload receipt never leaks internal reference URLs", async () => {
  const internalUrl = "https://r2.syntx.ai/uploaded/probe.png";
  const client = makeClient(async () => jsonResponse({
    id: "file-1",
    status: "accepted",
    files: [{ id: "file-1", url: internalUrl }]
  }));
  const receipt = await client.uploadFile(uploadRequest());
  assert.deepEqual(receipt, {
    file_id: "file-1",
    mime_type: "image/png",
    size: 4,
    status: "accepted"
  });
  assert.equal(JSON.stringify(receipt).includes(internalUrl), false);
});

test("public upload accepts frontend files response without exposing its URL", async () => {
  const internalUrl = "https://r2.syntx.ai/uploaded/frontend-response.png";
  const client = makeClient(async () => jsonResponse({ files: [{ url: internalUrl }] }));
  const receipt = await client.uploadFile(uploadRequest());
  assert.deepEqual(receipt, {
    file_id: null,
    mime_type: "image/png",
    size: 4,
    status: "accepted"
  });
  assert.equal(JSON.stringify(receipt).includes(internalUrl), false);
});

test("public upload rejects malformed files response and non-SYNTX URL", async () => {
  const malformed = makeClient(async () => jsonResponse({ files: [] }));
  await assert.rejects(malformed.uploadFile(uploadRequest()), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  const unsafe = makeClient(async () => jsonResponse({ files: [{ url: "https://attacker.invalid/file.png" }] }));
  await assert.rejects(unsafe.uploadFile(uploadRequest()), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
});

test("chat lifecycle uses exact fixed routes and returns only redacted fields", async () => {
  const seen: SeenRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = captureRequest(input, init);
    seen.push(request);
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/chats" && request.method === "POST") {
      return jsonResponse({
        uuid: "chat-001",
        title: "a private title",
        owner_token: SECRET
      });
    }
    if (
      url.pathname === "/api/v1/chats/chat-001" &&
      request.method === "DELETE"
    ) {
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/v1/chats/chat-001/inprogress") {
      return jsonResponse([
        {
          message_id: 42,
          message_object_id: "object-42",
          object_type: "image",
          model_type: "banana2",
          prompt: `private ${SECRET}`
        }
      ]);
    }
    if (url.pathname === "/api/v1/chats/chat-001/42") {
      // Real observed shape (docs/интеграция/наблюдение-banana-generation-2026-09-06.md):
      // author_id === -1 marks the bot's own message; the generated artifact
      // lives at message_object[0].object_url, not a top-level/data.* field.
      return jsonResponse({
        id: 42,
        chat_id: 1,
        author_id: -1,
        message_object: [
          {
            id: "object-42",
            message_id: 42,
            object_type: "image",
            object_url: "https://r2.syntx.ai/generated/object-42.png",
            completed: true,
            model_type: "banana2"
          }
        ],
        prompt: `private ${SECRET}`
      });
    }
    throw new Error("unexpected mocked route");
  };

  const client = makeClient(fetchImpl);
  assert.deepEqual(await client.createChat("image", "Private title"), {
    chat_uuid: "chat-001"
  });
  assert.deepEqual(await client.deleteChat("chat-001"), {
    chat_uuid: "chat-001",
    accepted: true
  });
  assert.deepEqual(await client.listInProgress("chat-001"), [
    {
      message_id: "42",
      message_object_id: "object-42",
      object_type: "image",
      model_type: "banana2"
    }
  ]);
  const message = await client.getMessage("chat-001", "42");
  assert.deepEqual(message, {
    chat_uuid: "chat-001",
    message_id: "42",
    message_object_id: "object-42",
    object_type: "image",
    model_type: "banana2",
    artifacts: [
      {
        url: "https://r2.syntx.ai/generated/object-42.png",
        mime_type: "image/png"
      }
    ]
  });

  assert.deepEqual(
    seen.map(({ url, method }) => ({
      path: new URL(url).pathname,
      search: new URL(url).search,
      method
    })),
    [
      { path: "/api/v1/chats", search: "", method: "POST" },
      { path: "/api/v1/chats/chat-001", search: "", method: "DELETE" },
      {
        path: "/api/v1/chats/chat-001/inprogress",
        search: "",
        method: "GET"
      },
      { path: "/api/v1/chats/chat-001/42", search: "", method: "GET" }
    ]
  );
  assert.deepEqual(JSON.parse(seen[0]?.body ?? "null"), {
    title: "Private title",
    scope: "image"
  });
  assert.equal(seen[1]?.body, undefined);
  assert.equal(seen[2]?.body, undefined);
  assert.equal(seen[3]?.body, undefined);
  for (const request of seen) {
    assert.equal(request.authorization, `Bearer ${SECRET}`);
    assert.equal(request.redirect, "error");
  }
  assert.equal(JSON.stringify(message).includes(SECRET), false);
});

test("four generation modalities use their observed paths and payload keys", async () => {
  const seen: SeenRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = captureRequest(input, init);
    seen.push(request);
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/v1/llm/generate") {
      return jsonResponse({
        job_id: "job-1",
        stream_url: "https://sse.syntx.ai/jobs/job-1",
        message_id: 10,
        prompt: SECRET
      });
    }
    return jsonResponse({ id: seen.length * 100, private: SECRET });
  };
  const client = makeClient(fetchImpl);

  assert.deepEqual(
    await client.startText({
      ai_name: "chatgpt",
      chat_uuid: "chat-text",
      text: "Explain this",
      model: "gpt-5.6",
      thinking: true,
      plan: false,
      deep_research: true
    }),
    {
      chat_uuid: "chat-text",
      provider_job_id: "job-1",
      message_id: "10"
    }
  );
  assert.deepEqual(
    await client.startImage({
      ai_name: "banana",
      chat_uuid: "chat-image",
      prompt: "Draw a pear",
      settings: {
        model_type: "banana2",
        image_size: "2K"
      }
    }),
    { chat_uuid: "chat-image", message_id: "200" }
  );
  assert.deepEqual(
    await client.startVideo({
      ai_name: "veo3",
      chat_id: "chat-video",
      prompt: "Animate the pear",
      settings: {
        model_type: "veo3-fast"
      }
    }),
    { chat_uuid: "chat-video", message_id: "300" }
  );
  assert.deepEqual(
    await client.startAudio({
      ai_name: "elevenlabs",
      chat_uuid: "chat-audio",
      prompt: "Read this sentence",
      settings: {
        model_type: "eleven-v3"
      }
    }),
    { chat_uuid: "chat-audio", message_id: "400" }
  );

  assert.deepEqual(
    seen.map((request) => ({
      path: new URL(request.url).pathname,
      ai: new URL(request.url).searchParams.get("ai_name"),
      method: request.method,
      contentType: request.contentType,
      body: JSON.parse(request.body ?? "null") as unknown
    })),
    [
      {
        path: "/api/v1/llm/generate",
        ai: "chatgpt",
        method: "POST",
        contentType: "application/json",
        body: {
          chat_uuid: "chat-text",
          text: "Explain this",
          model: "gpt-5.6",
          thinking: true,
          plan: false,
          deep_research: true
        }
      },
      {
        path: "/api/v1/design/generate",
        ai: "banana",
        method: "POST",
        contentType: "application/json",
        body: {
          chat_uuid: "chat-image",
          prompt: "Draw a pear",
          settings: {
            model_type: "banana2",
            image_size: "2K"
          }
        }
      },
      {
        path: "/api/v1/video/generate",
        ai: "veo3",
        method: "POST",
        contentType: "application/json",
        body: {
          chat_id: "chat-video",
          prompt: "Animate the pear",
          settings: {
            model_type: "veo3-fast"
          }
        }
      },
      {
        path: "/api/v1/audio/generate",
        ai: "elevenlabs",
        method: "POST",
        contentType: "application/json",
        body: {
          chat_uuid: "chat-audio",
          prompt: "Read this sentence",
          settings: {
            model_type: "eleven-v3"
          }
        }
      }
    ]
  );
  assert.equal(JSON.stringify(await Promise.all([])).includes(SECRET), false);
});

test("cancel uses the exact message route and sends no guessed body", async () => {
  let seen: SeenRequest | undefined;
  const client = makeClient(async (input, init) => {
    seen = captureRequest(input, init);
    return jsonResponse({ ok: true, detail: SECRET });
  });
  const result = await client.cancelMessage("chat-7", "message-9");
  assert.deepEqual(result, {
    chat_uuid: "chat-7",
    message_id: "message-9",
    accepted: true
  });
  assert.equal(
    new URL(seen?.url ?? "https://invalid").pathname,
    "/api/v1/chats/chat-7/messages/message-9/cancel"
  );
  assert.equal(seen?.method, "POST");
  assert.equal(seen?.body, undefined);
  assert.equal(seen?.contentType, null);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("credential, network and HTTP failures map to fixed secret-free errors", async () => {
  const httpCases = [
    [401, "AUTH_OR_ACCESS_DENIED"],
    [403, "AUTH_OR_ACCESS_DENIED"],
    [408, "UPSTREAM_TIMEOUT"],
    [429, "UPSTREAM_RATE_LIMITED"],
    [500, "UPSTREAM_UNAVAILABLE"],
    [504, "UPSTREAM_TIMEOUT"]
  ] as const;
  for (const [status, expectedCode] of httpCases) {
    const client = makeClient(async () =>
      jsonResponse({ detail: `upstream ${SECRET}` }, { status })
    );
    await assert.rejects(client.createChat("text", "Title"), (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError);
      assert.equal(error.code, expectedCode);
      assert.equal(String(error).includes(SECRET), false);
      return true;
    });
  }

  const networkClient = makeClient(async () => {
    throw new Error(`network ${SECRET}`);
  });
  await assert.rejects(
    networkClient.createChat("text", "Title"),
    (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError);
      assert.equal(error.code, "UPSTREAM_UNAVAILABLE");
      assert.equal(String(error).includes(SECRET), false);
      return true;
    }
  );

  const brokerClient = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(): Promise<T> {
        throw new Error(`vault ${SECRET}`);
      }
    },
    fetchImpl: async () => jsonResponse({ uuid: "never" })
  });
  await assert.rejects(
    brokerClient.createChat("text", "Title"),
    (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(String(error).includes(SECRET), false);
      return true;
    }
  );
});

test("malformed, wrong-media and oversized responses fail closed", async () => {
  const responses: Array<() => Response> = [
    () =>
      new Response("not-json", {
        headers: { "content-type": "application/json" }
      }),
    () =>
      new Response(JSON.stringify({ uuid: "chat-1" }), {
        headers: { "content-type": "text/plain" }
      }),
    () =>
      new Response(JSON.stringify({ uuid: "chat-1" }), {
        headers: {
          "content-type": "application/json",
          "content-length": "999999"
        }
      }),
    () => jsonResponse({ uuid: "bad/id", bearer: SECRET }),
    () =>
      new Response(JSON.stringify({ uuid: "chat-1", padding: "x".repeat(1024) }), {
        headers: { "content-type": "application/json" }
      })
  ];

  for (const response of responses) {
    const client = makeClient(async () => response(), { maxResponseBytes: 256 });
    await assert.rejects(
      client.createChat("text", "Title"),
      (error: unknown) => {
        assert.ok(error instanceof SyntxHttpError);
        assert.equal(error.code, "UPSTREAM_PROTOCOL_ERROR");
        assert.equal(String(error).includes(SECRET), false);
        return true;
      }
    );
  }
});

test("timeout and caller abort remain distinct when fetch ignores its signal", async () => {
  const neverFetch: typeof fetch = async () =>
    new Promise<Response>(() => {
      // Deliberately ignores AbortSignal.
    });
  const timeoutClient = makeClient(neverFetch, { requestTimeoutMs: 5 });
  await assert.rejects(
    timeoutClient.createChat("text", "Title"),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );

  const controller = new AbortController();
  const abortClient = makeClient(neverFetch, { requestTimeoutMs: 30_000 });
  const pending = abortClient.createChat("text", "Title", controller.signal);
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_REQUEST_ABORTED"
  );

  const hangingBodyClient = makeClient(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"uuid":"chat'));
          }
        }),
        { headers: { "content-type": "application/json" } }
      ),
    { requestTimeoutMs: 5 }
  );
  await assert.rejects(
    hangingBodyClient.createChat("text", "Title"),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );
});

test("pre-aborted caller request never reaches fetch", async () => {
  let fetchCalls = 0;
  const client = makeClient(async () => {
    fetchCalls += 1;
    return jsonResponse({ uuid: "never" });
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    client.createChat("text", "Title", controller.signal),
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_REQUEST_ABORTED"
  );
  assert.equal(fetchCalls, 0);
});

test("deadline and caller abort also bound a stalled credential broker", async () => {
  let fetchCalls = 0;
  let lateCallback:
    | ((credential: string) => Promise<unknown>)
    | undefined;
  const stalledBroker: SyntxCredentialBroker = {
    async useCredential<T>(
      operation: (credential: string) => Promise<T>
    ): Promise<T> {
      lateCallback = operation as (credential: string) => Promise<unknown>;
      return new Promise<T>(() => {
        // Simulates a blocked vault or lock.
      });
    }
  };
  const timeoutClient = new SyntxChatHttpClient({
    credentialBroker: stalledBroker,
    requestTimeoutMs: 5,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ uuid: "never" });
    }
  });
  await assert.rejects(
    timeoutClient.createChat("text", "Title"),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );
  assert.ok(lateCallback);
  await assert.rejects(
    lateCallback(SECRET),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );
  assert.equal(fetchCalls, 0);

  const controller = new AbortController();
  const abortClient = new SyntxChatHttpClient({
    credentialBroker: stalledBroker,
    requestTimeoutMs: 30_000,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ uuid: "never" });
    }
  });
  const pending = abortClient.createChat("text", "Title", controller.signal);
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_REQUEST_ABORTED"
  );
  assert.equal(fetchCalls, 0);
});

test("late response after abort is reaped without awaiting body cancellation", async () => {
  let resolveFetch: ((response: Response) => void) | undefined;
  let cancelCalls = 0;
  const fetchImpl: typeof fetch = async () =>
    new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
  const client = makeClient(fetchImpl, { requestTimeoutMs: 30_000 });
  const controller = new AbortController();
  const pending = client.createChat("text", "Title", controller.signal);
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_REQUEST_ABORTED"
  );

  const lateResponse = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalls += 1;
        return new Promise<void>(() => {
          // Deliberately never settles: cleanup must remain fire-and-forget.
        });
      }
    }),
    { headers: { "content-type": "application/json" } }
  );
  assert.ok(resolveFetch);
  resolveFetch(lateResponse);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelCalls, 1);
});

test("redirect postconditions fail closed and cancel response bodies", async () => {
  const cases = [
    { property: "redirected", value: true },
    { property: "type", value: "opaqueredirect" },
    { property: "url", value: "https://attacker.invalid/api/v1/chats" }
  ] as const;

  for (const testCase of cases) {
    let cancelCalls = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalls += 1;
          return new Promise<void>(() => {
            // A hostile stream is allowed to ignore cancellation.
          });
        }
      }),
      { headers: { "content-type": "application/json" } }
    );
    Object.defineProperty(response, testCase.property, {
      configurable: true,
      value: testCase.value
    });
    const client = makeClient(async () => response);
    await assert.rejects(
      client.createChat("text", "Title"),
      (error: unknown) =>
        error instanceof SyntxHttpError &&
        error.code === "UPSTREAM_PROTOCOL_ERROR"
    );
    assert.equal(cancelCalls, 1);
  }
});

test("early response rejection never blocks on hostile body cancellation", async () => {
  const cases = [
    { status: 500, headers: { "content-type": "application/json" } },
    { status: 200, headers: { "content-type": "text/plain" } },
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "999999"
      }
    }
  ];

  for (const testCase of cases) {
    let cancelCalls = 0;
    const client = makeClient(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelCalls += 1;
              return new Promise<void>(() => {
                // Never settles.
              });
            }
          }),
          { status: testCase.status, headers: testCase.headers }
        ),
      { requestTimeoutMs: 500, maxResponseBytes: 256 }
    );
    const outcome = await Promise.race([
      client.createChat("text", "Title").then(
        () => "resolved",
        () => "rejected"
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 100))
    ]);
    assert.equal(outcome, "rejected");
    assert.equal(cancelCalls, 1);
  }
});

test("stream overflow does not await hostile reader cancellation", async () => {
  let cancelCalls = 0;
  const client = makeClient(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(300));
          },
          cancel() {
            cancelCalls += 1;
            return new Promise<void>(() => {
              // Never settles.
            });
          }
        }),
        { headers: { "content-type": "application/json" } }
      ),
    { requestTimeoutMs: 500, maxResponseBytes: 256 }
  );
  const outcome = await Promise.race([
    client.createChat("text", "Title").then(
      () => "resolved",
      (error: unknown) =>
        error instanceof SyntxHttpError ? error.code : "unexpected"
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 100))
  ]);
  assert.equal(outcome, "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(cancelCalls, 1);
});

test("malformed UTF-8 JSON fails closed", async () => {
  const malformed = Uint8Array.from([
    0x7b, 0x22, 0x75, 0x75, 0x69, 0x64, 0x22, 0x3a, 0x22,
    0xc3, 0x28,
    0x22, 0x7d
  ]);
  const client = makeClient(
    async () =>
      new Response(malformed, {
        headers: { "content-type": "application/json" }
      })
  );
  await assert.rejects(
    client.createChat("text", "Title"),
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
});

test("ACK with a declared empty payload cancels any supplied body", async () => {
  let cancelCalls = 0;
  const client = makeClient(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            cancelCalls += 1;
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "0"
          }
        }
      )
  );
  assert.deepEqual(await client.deleteChat("chat-ack"), {
    chat_uuid: "chat-ack",
    accepted: true
  });
  assert.equal(cancelCalls, 1);
});

test("path, query and model injection are rejected before authorization or fetch", async () => {
  let brokerCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(
        operation: (credential: string) => Promise<T>
      ): Promise<T> {
        brokerCalls += 1;
        return operation(SECRET);
      }
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ uuid: "chat-1" });
    }
  });

  const operations = [
    () => client.deleteChat("../user"),
    () => client.getMessage("chat-1", "x/messages/y/cancel"),
    () =>
      client.startImage({
        ai_name: "banana&admin=true",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: {}
      }),
    () =>
      client.startText({
        ai_name: "chatgpt",
        chat_uuid: "chat-1",
        text: "Hello",
        model: "model/../../admin"
      }),
    () => client.createChat("admin" as "text", "Title")
  ];
  for (const operation of operations) {
    await assert.rejects(
      operation(),
      (error: unknown) =>
        error instanceof SyntxHttpError && error.code === "INVALID_REQUEST"
    );
  }
  assert.equal(brokerCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("prompt, settings, file and URL bounds fail before dispatch", async () => {
  let fetchCalls = 0;
  const client = makeClient(async () => {
    fetchCalls += 1;
    return jsonResponse({ data: { id: "id-1" } });
  });
  const tooManyFiles = Array.from({ length: 17 }, () => ({
    object_type: "file" as const,
    object_url: "https://uploads.example.com/file.pdf"
  }));
  const deepSettings: Record<string, unknown> = {};
  let cursor = deepSettings;
  for (let index = 0; index < 10; index += 1) {
    const nested: Record<string, unknown> = {};
    cursor.next = nested;
    cursor = nested;
  }
  const accessorSettings: Record<string, unknown> = {};
  Object.defineProperty(accessorSettings, "model_type", {
    enumerable: true,
    get: () => SECRET
  });

  const operations = [
    () =>
      client.startText({
        ai_name: "chatgpt",
        chat_uuid: "chat-1",
        text: "x".repeat(128 * 1024 + 1),
        model: "gpt"
      }),
    () =>
      client.startText({
        ai_name: "chatgpt",
        chat_uuid: "chat-1",
        text: "Hello",
        model: "gpt",
        files: tooManyFiles
      }),
    () =>
      client.startText({
        ai_name: "chatgpt",
        chat_uuid: "chat-1",
        text: "Hello",
        model: "gpt",
        thinking: "yes" as unknown as boolean
      }),
    () =>
      client.startText({
        ai_name: "chatgpt",
        chat_uuid: "chat-1",
        text: "Hello",
        model: "gpt",
        files: [
          { object_type: "file", object_url: "http://localhost/private" }
        ]
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: { image_url: ["file:///etc/passwd"] }
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: { image_urls: ["http://127.0.0.1/private"] }
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: {
          image_urls: ["https://127.0.0.1.nip.io/private"]
        }
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: {
          transform: {
            image_urls: ["https://uploads.example.com/private"]
          }
        }
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: { count: Number.NaN }
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: deepSettings
      }),
    () =>
      client.startImage({
        ai_name: "banana",
        chat_uuid: "chat-1",
        prompt: "Draw",
        settings: accessorSettings
      })
  ];

  for (const operation of operations) {
    await assert.rejects(
      operation(),
      (error: unknown) =>
        error instanceof SyntxHttpError && error.code === "INVALID_REQUEST"
    );
  }
  assert.equal(fetchCalls, 0);
});

test("unsafe text stream fails and unsafe artifact URLs are omitted", async () => {
  // Built, not written as a literal, so a secret scanner does not mistake
  // this synthetic embedded-credential URL for a real leaked connection string.
  const embeddedCredentialUrl = `https://${["user", "pw"].join(":")}@r2.syntx.ai/output.png`;
  const unsafeStreamClient = makeClient(async () =>
    jsonResponse({
      job_id: "job-1",
      stream_url: "https://attacker.invalid/steal",
      message_id: "message-1"
    })
  );
  await assert.rejects(
    unsafeStreamClient.startText({
      ai_name: "chatgpt",
      chat_uuid: "chat-1",
      text: "Hello",
      model: "gpt"
    }),
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_PROTOCOL_ERROR"
  );

  const unsafeArtifactClient = makeClient(async () =>
    jsonResponse({
      id: "message-1",
      author_id: -1,
      message_object: [
        { object_type: "image", object_url: "https://attacker.invalid/output.png", completed: true, caption: SECRET },
        { object_type: "image", object_url: "https://r2.syntx.ai/output.png#credential", completed: true },
        { object_type: "image", object_url: "https://r2.syntx.ai:8443/output.png", completed: true },
        { object_type: "image", object_url: embeddedCredentialUrl, completed: true },
        { object_type: "image", object_url: "data:image/png;base64,secret", completed: true },
        { object_type: "file", object_url: "https://r2.syntx.ai/output.pdf", completed: true },
        { object_type: "image", object_url: "https://r2.syntx.ai/not-ready.png", completed: false }
      ],
      prompt: SECRET
    })
  );
  const result = await unsafeArtifactClient.getMessage("chat-1", "message-1");
  assert.deepEqual(result, {
    chat_uuid: "chat-1",
    message_id: "message-1",
    artifacts: []
  });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("getMessage rejects a response whose observed top-level id differs from the requested message", async () => {
  const client = makeClient(async () =>
    jsonResponse({
      id: "other-message",
      author_id: -1,
      message_object: [
        { object_type: "image", object_url: "https://r2.syntx.ai/generated/real.png", completed: true }
      ]
    })
  );

  await assert.rejects(
    client.getMessage("chat-1", "message-1"),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
});

test("an echoed human message never surfaces artifacts, even with an otherwise-valid entry", async () => {
  const echoClient = makeClient(async () =>
    jsonResponse({
      id: "message-2",
      author_id: 139413708,
      message_object: [
        { object_type: "image", object_url: "https://r2.syntx.ai/generated/real.png", completed: true }
      ]
    })
  );
  const result = await echoClient.getMessage("chat-1", "message-2");
  assert.deepEqual(result.artifacts, []);
});

test("a genuine bot-authored, completed artifact is exposed with an inferred mime type", async () => {
  const client = makeClient(async () =>
    jsonResponse({
      id: "message-3",
      author_id: -1,
      message_object: [
        { object_type: "image", object_url: "https://r2.syntx.ai/generated/real.png", completed: true }
      ]
    })
  );
  const result = await client.getMessage("chat-1", "message-3");
  assert.deepEqual(result.artifacts, [
    { url: "https://r2.syntx.ai/generated/real.png", mime_type: "image/png" }
  ]);
});

test("a genuine bot-authored completed video artifact is exposed as mp4", async () => {
  const client = makeClient(async () =>
    jsonResponse({
      id: "message-video",
      author_id: -1,
      message_object: [
        {
          object_type: "video",
          object_url: "https://r2.syntx.ai/generated/seedance-result.mp4",
          completed: true,
          model_type: "seedance-2.0"
        }
      ]
    })
  );
  const result = await client.getMessage("chat-1", "message-video");
  assert.deepEqual(result, {
    chat_uuid: "chat-1",
    message_id: "message-video",
    object_type: "video",
    model_type: "seedance-2.0",
    artifacts: [
      {
        url: "https://r2.syntx.ai/generated/seedance-result.mp4",
        mime_type: "video/mp4"
      }
    ]
  });
});

test("an echoed human video message never surfaces a video artifact", async () => {
  const client = makeClient(async () =>
    jsonResponse({
      id: "message-video-echo",
      author_id: 139413708,
      message_object: [
        {
          object_type: "video",
          object_url: "https://r2.syntx.ai/generated/echo.mp4",
          completed: true,
          model_type: "seedance-2.0"
        }
      ]
    })
  );
  const result = await client.getMessage("chat-1", "message-video-echo");
  assert.deepEqual(result.artifacts, []);
});

test("text receipt never exposes a signed stream URL", async () => {
  const streamSecret = ["SIGNED", "STREAM", "QUERY", "MUST", "NOT", "ESCAPE"].join("_");
  const client = makeClient(async () =>
    jsonResponse({
      job_id: "job-safe",
      stream_url: `https://sse.syntx.ai/jobs/job-safe?token=${streamSecret}`,
      message_id: "message-safe"
    })
  );
  const result = await client.startText({
    ai_name: "chatgpt",
    chat_uuid: "chat-safe",
    text: "Hello",
    model: "gpt"
  });
  assert.deepEqual(result, {
    chat_uuid: "chat-safe",
    provider_job_id: "job-safe",
    message_id: "message-safe"
  });
  assert.equal(JSON.stringify(result).includes(streamSecret), false);
  assert.equal("stream_url" in result, false);
});

test("result decoding exposes no URL while a bot object is still in progress", async () => {
  // Real in-flight shape: the placeholder object already carries an
  // object_url/model_type but completed stays false until generation
  // finishes (наблюдение-banana-generation-2026-09-06.md).
  const notYetFinal = "https://r2.syntx.ai/generated/in-flight-placeholder.png";
  const client = makeClient(async () =>
    jsonResponse({
      id: "message-1",
      author_id: -1,
      message_object: [
        {
          id: "object-1",
          object_type: "image",
          object_url: notYetFinal,
          completed: false,
          model_type: "banana"
        }
      ]
    })
  );

  const result = await client.getMessage("chat-1", "message-1");
  assert.deepEqual(result.artifacts, []);
  assert.equal(JSON.stringify(result).includes(notYetFinal), false);
});

test("bounded message history returns every redacted row with completeness evidence", async () => {
  const promptSecret = "private echoed prompt";
  const metadataSecret = "private-task-metadata";
  const urlSecret = "https://r2.syntx.ai/private-result.png?signature=private";
  const client = makeClient(async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/chat-1/messages?page=1&page_size=10");
    assert.equal(init?.method, "GET");
    return jsonResponse({
      messages: [
        {
          id: 101, created_at: "2026-10-09T00:00:00Z", chat_id: 412,
          author_id: 139413708, updated_at: "2026-10-09T00:00:00Z", is_favorite: false,
          message_object: [{
            id: 201, message_id: 101, object_type: "text",
            text: promptSecret, completed: true, times: [], model_type: "banana-2.1",
            metadata: { task_id: metadataSecret }
          }]
        },
        {
          id: 102, created_at: "2026-10-09T00:00:01Z", chat_id: 412,
          author_id: -1, updated_at: "2026-10-09T00:00:01Z", is_favorite: false,
          message_object: [{
            id: 202, message_id: 102, object_type: "image",
            url: urlSecret, completed: true, times: [], model_type: "banana-2.1",
            metadata: { task_id: metadataSecret }
          }]
        }
      ],
      pagination: {
        page: 1, page_size: 10, total_count: 2, total_pages: 1,
        has_next: false, has_previous: false
      },
      chat_limits: { ignored: true }
    });
  });

  const history = await client.listMessageCandidates("chat-1", "101");
  assert.equal(history.complete, true);
  assert.equal(history.total_count, 2);
  assert.equal(history.provider_chat_id, "412");
  assert.equal(history.requested_chat_uuid, "chat-1");
  assert.deepEqual(history.messages.map((message) => ({
    message_id: message.message_id,
    provider_chat_id: message.provider_chat_id,
    author_role: message.author_role,
    objects: message.objects
  })), [
    {
      message_id: "101", provider_chat_id: "412", author_role: "owner",
      objects: [{ message_object_id: "201", object_type: "text", model_type: "banana-2.1" }]
    },
    {
      message_id: "102", provider_chat_id: "412", author_role: "bot",
      objects: [{ message_object_id: "202", object_type: "image", model_type: "banana-2.1" }]
    }
  ]);
  const serialized = JSON.stringify(history);
  for (const secret of [promptSecret, metadataSecret, urlSecret]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("bounded message history rejects a response that exceeds the requested page size", async () => {
  let fetchCalls = 0;
  const messages = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    chat_id: 412,
    author_id: index === 0 ? 139413708 : -1,
    message_object: []
  }));
  const client = makeClient(async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/chat-1/messages?page=1&page_size=10");
    assert.equal(init?.method, "GET");
    return jsonResponse({
      messages,
      pagination: {
        page: 1, page_size: 10, total_count: 11, total_pages: 2,
        has_next: false, has_previous: false
      }
    });
  });

  await assert.rejects(
    client.listMessageCandidates("chat-1", "1"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
  assert.equal(fetchCalls, 1);
});

test("bounded message history rejects incomplete pagination and inconsistent row IDs", async () => {
  const ownerRow = {
    id: "echo-1", chat_id: 412, author_id: 139413708,
    message_object: [{ id: "echo-object-1", message_id: "echo-1", object_type: "text", model_type: "banana-2.1" }]
  };
  const botRow = {
    id: "bot-1", chat_id: 412, author_id: -1,
    message_object: [{ id: "bot-object-1", message_id: "bot-1", object_type: "image", model_type: "banana-2.1" }]
  };
  const pagination = {
    page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false
  };
  const invalidPayloads = [
    { messages: [ownerRow, botRow], pagination: { ...pagination, has_next: true } },
    { messages: [ownerRow, { ...botRow, chat_id: 413 }], pagination },
    { messages: [ownerRow, { ...botRow, message_object: [{ ...botRow.message_object[0], message_id: "echo-1" }] }], pagination },
    { messages: [ownerRow, { ...botRow, id: "echo-1", message_object: [{ ...botRow.message_object[0], message_id: "echo-1" }] }], pagination },
    { messages: [ownerRow, { ...botRow, message_object: [{ ...botRow.message_object[0], id: "echo-object-1" }] }], pagination },
    { messages: [ownerRow, { ...botRow, message_object: [{ id: "bot-object-1", message_id: "bot-1", model_type: "banana-2.1" }] }], pagination },
    { messages: [ownerRow, { ...botRow, message_object: [{ id: "bot-object-1", object_type: "image", model_type: "banana-2.1" }] }], pagination },
    { messages: Array.from({ length: 21 }, (_, index) => ({ ...botRow, id: `bot-${index}` })), pagination: { ...pagination, total_count: 21, total_pages: 3 } },
    { messages: [{ ...ownerRow, id: "../wrong-id" }, botRow], pagination }
  ];

  for (const payload of invalidPayloads) {
    const client = makeClient(async () => jsonResponse(payload));
    await assert.rejects(
      client.listMessageCandidates("chat-1", "echo-1"),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"
    );
  }
});

test("bounded message history shares deadline and redirect protections", async () => {
  const timeoutClient = makeClient(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), { requestTimeoutMs: 5 });
  await assert.rejects(
    timeoutClient.listMessageCandidates("chat-1", "echo-1"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );

  const redirectedResponse = jsonResponse({});
  Object.defineProperty(redirectedResponse, "url", { value: "https://attacker.invalid/redirect" });
  const redirectClient = makeClient(async () => redirectedResponse);
  await assert.rejects(
    redirectClient.listMessageCandidates("chat-1", "echo-1"),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
});
