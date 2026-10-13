import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModelInfoUrl,
  isSyntxModelInfoCallerParameterKey,
  SyntxHttpClient,
  SyntxHttpError,
  type SyntxCredentialBroker
} from "../src/adapter/syntx/http-client.js";
import { LinkedAttemptCredentialBroker } from "../src/adapter/syntx/link-credential-broker.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type {
  AuthBinding,
  AuthLinkProvider,
  ProviderCredentialReceiver
} from "../src/auth/types.js";

const SECRET = ["owner", "secret", "that", "must", "never", "leak"].join("-");
const validPayload = {
  access: true,
  cost: 3,
  discount_cost: null,
  free_remaining_generations: 0,
  limit: 10,
  show_warning: false
};

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

test("getModelInfo uses fixed route and bearer without leaking it", async () => {
  let seenUrl = "";
  let seenAuthorization = "";
  const client = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return jsonResponse({ ...validPayload, ignored_new_field: "safe-strip" });
    }
  });

  const result = await client.getModelInfo({
    ai_name: "banana",
    model_type: "banana2",
    cost_parameters: { image_size: "2K", count: 2, hdr: false }
  });

  assert.equal(seenAuthorization, `Bearer ${SECRET}`);
  assert.equal(new URL(seenUrl).origin, "https://api.syntx.ai");
  assert.equal(new URL(seenUrl).pathname, "/api/v2/get_model_info");
  assert.equal(new URL(seenUrl).searchParams.has("token"), false);
  assert.deepEqual(result, validPayload);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("query values are encoded and parameters are deterministic", () => {
  const url = buildModelInfoUrl({
    ai_name: "banana",
    model_type: "banana2",
    cost_parameters: { z_mode: "a b", count: 1, enabled: true }
  });
  assert.equal(url.searchParams.get("z_mode"), "a b");
  assert.deepEqual([...url.searchParams.keys()], [
    "ai_name",
    "model_type",
    "count",
    "enabled",
    "z_mode"
  ]);
  assert.throws(
    () => buildModelInfoUrl({ ai_name: "banana&admin=true", model_type: "x" }),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST"
  );
  assert.throws(
    () =>
      buildModelInfoUrl({
        ai_name: "banana",
        model_type: "x",
        cost_parameters: { ai_name: "override" }
      }),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST"
  );
});

test("model-info parameter policy rejects transport-owned and unsafe keys", () => {
  assert.equal(isSyntxModelInfoCallerParameterKey("image_size"), true);
  assert.equal(isSyntxModelInfoCallerParameterKey("model_type"), false);
  assert.equal(isSyntxModelInfoCallerParameterKey("MODEL_TYPE"), false);
  assert.equal(isSyntxModelInfoCallerParameterKey("ai_name"), false);
  assert.equal(isSyntxModelInfoCallerParameterKey("constructor"), false);
  assert.equal(isSyntxModelInfoCallerParameterKey("1invalid"), false);
  assert.equal(isSyntxModelInfoCallerParameterKey("x".repeat(65)), false);
});

test("HTTP denial maps to a fixed credential-free error", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    fetchImpl: async () =>
      jsonResponse({ detail: `rejected ${SECRET}` }, { status: 403 })
  });
  await assert.rejects(
    client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError);
      assert.equal(error.code, "AUTH_OR_ACCESS_DENIED");
      assert.equal(String(error).includes(SECRET), false);
      return true;
    }
  );
});

test("credential broker failures are normalized without secret text", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: {
      async useCredential<T>(): Promise<T> {
        throw new Error(`vault unavailable ${SECRET}`);
      }
    },
    fetchImpl: async () => jsonResponse(validPayload)
  });
  await assert.rejects(
    client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError);
      assert.equal(error.code, "AUTH_REQUIRED");
      assert.equal(String(error).includes(SECRET), false);
      return true;
    }
  );
});

test("deadline and caller abort bound a stalled credential broker", async () => {
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
  const timeoutClient = new SyntxHttpClient({
    credentialBroker: stalledBroker,
    requestTimeoutMs: 5,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(validPayload);
    }
  });
  await assert.rejects(
    timeoutClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
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
  const abortClient = new SyntxHttpClient({
    credentialBroker: stalledBroker,
    requestTimeoutMs: 30_000,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse(validPayload);
    }
  });
  const pending = abortClient.getModelInfo(
    { ai_name: "banana", model_type: "banana2" },
    controller.signal
  );
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_REQUEST_ABORTED"
  );
  assert.equal(fetchCalls, 0);
});

test("timeout and abort are normalized", async () => {
  const client = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    requestTimeoutMs: 5,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      })
  });
  await assert.rejects(
    client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );
});

test("caller abort is distinct from the upstream deadline", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    fetchImpl: async () => {
      throw new Error("fetch must not run for an already-aborted request");
    }
  });
  await assert.rejects(
    client.getModelInfo(
      { ai_name: "banana", model_type: "banana2" },
      controller.signal
    ),
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_REQUEST_ABORTED"
  );
});

test("timeout is enforced when fetch or body ignores AbortSignal", async () => {
  const neverFetch = async () => new Promise<Response>(() => undefined);
  const fetchClient = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    requestTimeoutMs: 5,
    fetchImpl: neverFetch
  });
  await assert.rejects(
    fetchClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );

  let bodyCanceled = false;
  const bodyClient = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    requestTimeoutMs: 5,
    fetchImpl: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            return new Promise<void>(() => undefined);
          },
          cancel() {
            bodyCanceled = true;
          }
        }),
        { headers: { "content-type": "application/json" } }
      )
  });
  await assert.rejects(
    bodyClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );
  assert.equal(bodyCanceled, true);
});

test("network failures are fixed and early protocol rejection cancels bodies", async () => {
  const privateFailure = `network-${SECRET}`;
  const networkClient = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    fetchImpl: async () => {
      throw new Error(privateFailure);
    }
  });
  await assert.rejects(
    networkClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) => {
      assert.ok(error instanceof SyntxHttpError);
      assert.equal(error.code, "UPSTREAM_UNAVAILABLE");
      assert.equal(String(error).includes(privateFailure), false);
      return true;
    }
  );

  let canceled = false;
  const protocolClient = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    fetchImpl: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("private-body"));
          },
          cancel() {
            canceled = true;
          }
        }),
        { headers: { "content-type": "text/plain" } }
      )
  });
  await assert.rejects(
    protocolClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) =>
      error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_PROTOCOL_ERROR"
  );
  assert.equal(canceled, true);
});

test("cleanup cannot defeat the deadline and late responses are reaped", async () => {
  let stalledCancelCalled = false;
  const stalledCancelResponse = new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        stalledCancelCalled = true;
        return new Promise<void>(() => undefined);
      }
    }),
    { status: 500, headers: { "content-type": "application/json" } }
  );
  const cleanupClient = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    requestTimeoutMs: 5,
    fetchImpl: async () => stalledCancelResponse
  });
  await assert.rejects(
    Promise.race([
      cleanupClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
      rejectAfter(100, "cleanup exceeded the outer test deadline")
    ]),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE"
  );
  assert.equal(stalledCancelCalled, true);

  let resolveLate: ((response: Response) => void) | undefined;
  let lateCancelCalled = false;
  const lateClient = new SyntxHttpClient({
    credentialBroker: brokerWith(SECRET),
    requestTimeoutMs: 5,
    fetchImpl: async () =>
      await new Promise<Response>((resolve) => {
        resolveLate = resolve;
      })
  });
  await assert.rejects(
    lateClient.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
  );
  resolveLate?.(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          lateCancelCalled = true;
        }
      }),
      { headers: { "content-type": "application/json" } }
    )
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(lateCancelCalled, true);
});

test("response redirects, invalid UTF-8 and upstream timeout statuses fail closed", async () => {
  const redirected = jsonResponse(validPayload);
  Object.defineProperties(redirected, {
    redirected: { value: true },
    url: { value: "https://evil.example/redirected" }
  });
  const invalidUtf8 = new Response(
    bytesWithInvalidUtf8(
      '{"access":true,"cost":3,"discount_cost":null,"free_remaining_generations":0,"limit":10,"show_warning":false,"ignored":"',
      '"}'
    ).buffer as ArrayBuffer,
    { headers: { "content-type": "application/json" } }
  );
  for (const response of [redirected, invalidUtf8]) {
    const client = new SyntxHttpClient({
      credentialBroker: brokerWith(SECRET),
      fetchImpl: async () => response
    });
    await assert.rejects(
      client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
      (error: unknown) =>
        error instanceof SyntxHttpError &&
        error.code === "UPSTREAM_PROTOCOL_ERROR"
    );
  }

  for (const status of [408, 504]) {
    const client = new SyntxHttpClient({
      credentialBroker: brokerWith(SECRET),
      fetchImpl: async () => jsonResponse({}, { status })
    });
    await assert.rejects(
      client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
      (error: unknown) =>
        error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT"
    );
  }
});

test("malformed, wrong-media and oversized responses fail closed", async () => {
  const cases: Array<() => Promise<Response>> = [
    async () =>
      new Response("not-json", {
        headers: { "content-type": "application/json" }
      }),
    async () =>
      new Response(JSON.stringify(validPayload), {
        headers: { "content-type": "text/plain" }
      }),
    async () =>
      new Response(JSON.stringify(validPayload), {
        headers: {
          "content-type": "application/json",
          "content-length": "999999"
        }
      }),
    async () => jsonResponse({ access: "yes" })
  ];

  for (const fetchImpl of cases) {
    const client = new SyntxHttpClient({
      credentialBroker: brokerWith(SECRET),
      maxResponseBytes: 1024,
      fetchImpl
    });
    await assert.rejects(
      client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
      (error: unknown) =>
        error instanceof SyntxHttpError &&
        error.code === "UPSTREAM_PROTOCOL_ERROR"
    );
  }
});

test("linked-attempt broker composes auth and HTTP without serializing the credential", async () => {
  const binding: AuthBinding = {
    tenant_id: "tenant-one",
    subject: "subject-one"
  };
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() {
      return {
        upstream_attempt_id: "018f2f60-91c4-7c3d-8e52-0f7d0e21b581",
        approval_url:
          "tg://resolve?domain=syntxaibot&start=auth_018f2f60-91c4-7c3d-8e52-0f7d0e21b581"
      };
    },
    async pollChallenge(
      _upstreamAttemptId: string,
      receiveCredential: ProviderCredentialReceiver
    ) {
      await receiveCredential({ scheme: "Bearer", value: SECRET });
      return { state: "LINKED" } as const;
    }
  };
  const store = new InMemoryAuthLinkStore(() => 1_788_364_800_000);
  const service = new PerUserLinkService(provider, store, {
    now: () => 1_788_364_800_000,
    attemptIdGenerator: () => "link_public_attempt_00000002"
  });
  const attempt = await service.createAttempt(binding);
  await service.issueHandoff(binding, attempt.attempt_id);
  await service.checkAttempt(binding, attempt.attempt_id);

  const client = new SyntxHttpClient({
    credentialBroker: new LinkedAttemptCredentialBroker(
      service,
      binding,
      attempt.attempt_id
    ),
    fetchImpl: async (_input, init) => {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${SECRET}`
      );
      return jsonResponse(validPayload);
    }
  });
  assert.deepEqual(
    await client.getModelInfo({ ai_name: "banana", model_type: "banana2" }),
    validPayload
  );
  assert.equal(JSON.stringify({ service, store, client }).includes(SECRET), false);
});

function rejectAfter(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), milliseconds);
  });
}

function bytesWithInvalidUtf8(prefix: string, suffix: string): Uint8Array {
  const left = new TextEncoder().encode(prefix);
  const right = new TextEncoder().encode(suffix);
  const result = new Uint8Array(left.length + 1 + right.length);
  result.set(left, 0);
  result[left.length] = 0xff;
  result.set(right, left.length + 1);
  return result;
}
