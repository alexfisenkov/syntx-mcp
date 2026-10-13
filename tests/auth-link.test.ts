import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import {
  ObservedSyntxAuthProvider,
  validateApprovalUrl
} from "../src/auth/observed-syntx-provider.js";
import type { AuthBinding } from "../src/auth/types.js";
import { AuthLinkError, AuthProviderError } from "../src/auth/types.js";

const UPSTREAM_UUID = "018f2f60-91c4-7c3d-8e52-0f7d0e21b581";
const OTHER_UPSTREAM_UUID = "018f2f60-91c4-7c3d-8e52-0f7d0e21b582";
const PUBLIC_ATTEMPT_ID = "link_public_attempt_00000001";
const TEST_CREDENTIAL = "YOUR_TEST_BEARER_CREDENTIAL_VALUE";
const TOKEN_RESPONSE_FIELD = "token" as const;
const BINDING: AuthBinding = {
  tenant_id: "tenant-alpha",
  subject: "subject-alpha"
};

test("links one tenant through the exact observed response shapes", async () => {
  const requests: Array<{ url: string; method: string; body: BodyInit | null }> = [];
  const fetchImpl = sequenceFetch(
    [
      { uuid: UPSTREAM_UUID },
      {
        valid: true,
        complete: true,
        [TOKEN_RESPONSE_FIELD]: TEST_CREDENTIAL,
        is_new_user: false
      }
    ],
    requests
  );
  const { provider, store, service } = createHarness(fetchImpl);

  const created = await service.createAttempt(BINDING);
  assert.deepEqual(created, {
    attempt_id: PUBLIC_ATTEMPT_ID,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status: "CHALLENGE_CREATED",
    expires_at: "2026-09-02T12:05:00.000Z",
    linked: false
  });
  assert.equal(created.attempt_id.includes(UPSTREAM_UUID), false);

  const handoff = await service.issueHandoff(BINDING, created.attempt_id);
  assert.equal(handoff.attempt.status, "HANDOFF_ISSUED");
  assert.equal(
    handoff.approval_url,
    `tg://resolve?domain=syntxaibot&start=auth_${UPSTREAM_UUID}`
  );
  assert.deepEqual(requests[0], {
    url: "https://api.syntx.ai/api/v1/auth/startauth",
    method: "POST",
    body: "{}"
  });

  const statusBeforePoll = await service.getStatus(BINDING, created.attempt_id);
  assert.equal(JSON.stringify(statusBeforePoll).includes(UPSTREAM_UUID), false);
  assert.equal("approval_url" in statusBeforePoll, false);

  const linked = await service.checkAttempt(BINDING, created.attempt_id);
  assert.equal(linked.status, "LINKED");
  assert.equal(linked.linked, true);
  assert.equal(linked.expires_at, null);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1]?.url,
    `https://api.syntx.ai/api/v1/auth/token/${UPSTREAM_UUID}`
  );

  const credentialWorked = await service.useCredential(
    BINDING,
    created.attempt_id,
    (credential) =>
      credential.scheme === "Bearer" && credential.value === TEST_CREDENTIAL
  );
  assert.equal(credentialWorked, true);

  const safeSerialization = JSON.stringify({ linked, provider, store, service });
  assert.equal(safeSerialization.includes(TEST_CREDENTIAL), false);
  assert.equal(safeSerialization.includes(UPSTREAM_UUID), false);
});

test("each pending check performs exactly one bounded token request", async () => {
  const requests: Array<{ url: string; method: string; body: BodyInit | null }> = [];
  const fetchImpl = sequenceFetch(
    [
      { uuid: UPSTREAM_UUID },
      { valid: true, complete: false },
      { valid: true, complete: false }
    ],
    requests
  );
  const { service } = createHarness(fetchImpl);
  const created = await service.createAttempt(BINDING);
  await service.issueHandoff(BINDING, created.attempt_id);

  const first = await service.checkAttempt(BINDING, created.attempt_id);
  assert.equal(first.status, "POLLING");
  assert.equal(requests.length, 2);

  const second = await service.checkAttempt(BINDING, created.attempt_id);
  assert.equal(second.status, "POLLING");
  assert.equal(requests.length, 3);
  assert.equal(
    requests.filter((request) => request.method === "GET").length,
    2
  );
});

test("malformed provider payload fails terminal without exposing payload details", async () => {
  const fetchImpl = sequenceFetch([
    { uuid: UPSTREAM_UUID },
    { valid: true, complete: true }
  ]);
  const { service } = createHarness(fetchImpl);
  const created = await service.createAttempt(BINDING);
  await service.issueHandoff(BINDING, created.attempt_id);
  const failed = await service.checkAttempt(BINDING, created.attempt_id);

  assert.equal(failed.status, "FAILED_TERMINAL");
  assert.equal(JSON.stringify(failed).includes(UPSTREAM_UUID), false);
  await assert.rejects(
    service.useCredential(BINDING, created.attempt_id, () => true),
    hasCode("AUTH_CREDENTIAL_UNAVAILABLE")
  );
});

test("malformed start response is rejected instead of guessing field names", async () => {
  const fetchImpl = sequenceFetch([{ id: UPSTREAM_UUID }]);
  const { service } = createHarness(fetchImpl);
  const created = await service.createAttempt(BINDING);
  const result = await service.issueHandoff(BINDING, created.attempt_id);

  assert.equal(result.attempt.status, "FAILED_TERMINAL");
  assert.equal(result.approval_url, null);
});

test("attempts are bound to both tenant and authenticated subject", async () => {
  const fetchImpl = sequenceFetch([{ uuid: UPSTREAM_UUID }]);
  const { service } = createHarness(fetchImpl);
  const created = await service.createAttempt(BINDING);

  await assert.rejects(
    service.getStatus(
      { tenant_id: "tenant-other", subject: BINDING.subject },
      created.attempt_id
    ),
    hasCode("AUTH_LINK_NOT_FOUND")
  );
  await assert.rejects(
    service.getStatus(
      { tenant_id: BINDING.tenant_id, subject: "subject-other" },
      created.attempt_id
    ),
    hasCode("AUTH_LINK_NOT_FOUND")
  );

  const ownerStatus = await service.getStatus(BINDING, created.attempt_id);
  assert.equal(ownerStatus.status, "CHALLENGE_CREATED");
});

test("expired attempts delete private material and never poll", async () => {
  const requests: Array<{ url: string; method: string; body: BodyInit | null }> = [];
  let now = Date.parse("2026-09-02T12:00:00.000Z");
  const fetchImpl = sequenceFetch([{ uuid: UPSTREAM_UUID }], requests);
  const { service } = createHarness(fetchImpl, {
    now: () => now,
    ttlMs: 1_000
  });
  const created = await service.createAttempt(BINDING);
  await service.issueHandoff(BINDING, created.attempt_id);
  now += 1_001;

  const expired = await service.getStatus(BINDING, created.attempt_id);
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.expires_at, null);
  const afterCheck = await service.checkAttempt(BINDING, created.attempt_id);
  assert.equal(afterCheck.status, "EXPIRED");
  assert.equal(requests.length, 1);
  await assert.rejects(
    service.useCredential(BINDING, created.attempt_id, () => true),
    hasCode("AUTH_CREDENTIAL_UNAVAILABLE")
  );
});

test("linked checks are replay-safe and revoke deletes the credential", async () => {
  const requests: Array<{ url: string; method: string; body: BodyInit | null }> = [];
  const fetchImpl = sequenceFetch(
    [
      { uuid: UPSTREAM_UUID },
      {
        valid: true,
        complete: true,
        [TOKEN_RESPONSE_FIELD]: TEST_CREDENTIAL,
        is_new_user: false
      }
    ],
    requests
  );
  const { service } = createHarness(fetchImpl);
  const created = await service.createAttempt(BINDING);
  await service.issueHandoff(BINDING, created.attempt_id);
  await service.checkAttempt(BINDING, created.attempt_id);

  const replayedCheck = await service.checkAttempt(BINDING, created.attempt_id);
  assert.equal(replayedCheck.status, "LINKED");
  assert.equal(requests.length, 2);

  const revoked = await service.revoke(BINDING, created.attempt_id);
  assert.equal(revoked.status, "REVOKED");
  assert.equal((await service.revoke(BINDING, created.attempt_id)).status, "REVOKED");
  await assert.rejects(
    service.useCredential(BINDING, created.attempt_id, () => true),
    hasCode("AUTH_CREDENTIAL_UNAVAILABLE")
  );
  assert.equal((await service.checkAttempt(BINDING, created.attempt_id)).status, "REVOKED");
  assert.equal(requests.length, 2);
});

test("Telegram approval URL validation accepts only the SYNTX bot handoff", () => {
  const payload = `auth_${UPSTREAM_UUID}`;
  assert.equal(
    validateApprovalUrl(
      `https://t.me/syntxaibot?start=${payload}`,
      UPSTREAM_UUID
    ),
    `https://t.me/syntxaibot?start=${payload}`
  );
  assert.equal(
    validateApprovalUrl(
      `https://telegram.me/syntxaibot?start=${payload}`,
      UPSTREAM_UUID
    ),
    `https://telegram.me/syntxaibot?start=${payload}`
  );
  assert.equal(
    validateApprovalUrl(
      `tg://resolve?domain=syntxaibot&start=${payload}`,
      UPSTREAM_UUID
    ),
    `tg://resolve?domain=syntxaibot&start=${payload}`
  );

  const rejected = [
    `https://evil.example/syntxaibot?start=${payload}`,
    `https://t.me.evil.example/syntxaibot?start=${payload}`,
    `https://t.me/anotherbot?start=${payload}`,
    `https://t.me/syntxaibot?start=${payload}&extra=1`,
    `tg://resolve?domain=anotherbot&start=${payload}`,
    `tg://resolve?domain=syntxaibot&start=auth_${OTHER_UPSTREAM_UUID}`,
    `tg://resolve?domain=syntxaibot&start=${payload}&extra=1`
  ];
  for (const value of rejected) {
    assert.throws(
      () => validateApprovalUrl(value, UPSTREAM_UUID),
      hasCode("INVALID_APPROVAL_URL")
    );
  }
});

test("API base validation is exact and cannot redirect requests off api.syntx.ai", () => {
  const invalidBases = [
    "http://api.syntx.ai/api/v1/",
    "https://api.syntx.ai/",
    "https://syntx.ai/api/v1/",
    "https://api.syntx.ai.evil.example/api/v1/",
    "https://api.syntx.ai/api/",
    "https:" + "//user:pass@api.syntx.ai/api/v1/",
    "https://api.syntx.ai/api/v1/?next=https://evil.example"
  ];
  for (const apiBaseUrl of invalidBases) {
    assert.throws(
      () => new ObservedSyntxAuthProvider({ apiBaseUrl }),
      hasCode("INVALID_API_BASE")
    );
  }
});

test("request timeout is bounded and becomes a retryable state", async () => {
  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    });
  }) as typeof fetch;
  const { service } = createHarness(fetchImpl, { requestTimeoutMs: 5 });
  const created = await service.createAttempt(BINDING);
  const result = await service.issueHandoff(BINDING, created.attempt_id);

  assert.equal(result.attempt.status, "FAILED_RETRYABLE");
  assert.equal(result.approval_url, null);
});

test("provider deadline holds when fetch and response body ignore AbortSignal", async () => {
  const neverFetchProvider = new ObservedSyntxAuthProvider({
    requestTimeoutMs: 5,
    fetchImpl: async () => new Promise<Response>(() => undefined)
  });
  await assert.rejects(
    neverFetchProvider.createChallenge(),
    (error: unknown) =>
      error instanceof AuthProviderError &&
      error.code === "AUTH_PROVIDER_RETRYABLE" &&
      error.retryable
  );

  let bodyCanceled = false;
  const stalledBodyProvider = new ObservedSyntxAuthProvider({
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
    stalledBodyProvider.createChallenge(),
    (error: unknown) =>
      error instanceof AuthProviderError &&
      error.code === "AUTH_PROVIDER_RETRYABLE" &&
      error.retryable
  );
  assert.equal(bodyCanceled, true);
});

test("provider rejects non-JSON and oversized JSON responses", async () => {
  const invalidResponses = [
    new Response(JSON.stringify({ uuid: UPSTREAM_UUID }), {
      status: 200,
      headers: { "content-type": "text/plain" }
    }),
    new Response(
      JSON.stringify({ uuid: UPSTREAM_UUID, padding: "x".repeat(40_000) }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )
  ];

  for (const response of invalidResponses) {
    const fetchImpl = (async () => response) as typeof fetch;
    const { service } = createHarness(fetchImpl);
    const created = await service.createAttempt(BINDING);
    const result = await service.issueHandoff(BINDING, created.attempt_id);
    assert.equal(result.attempt.status, "FAILED_TERMINAL");
    assert.equal(result.approval_url, null);
  }
});

test("an external abort is distinct and leaves the attempt retryable", async () => {
  const fetchImpl = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    if (init?.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }
    throw new Error("The test expected an already-aborted signal.");
  }) as typeof fetch;
  const controller = new AbortController();
  controller.abort();
  const { service } = createHarness(fetchImpl);
  const created = await service.createAttempt(BINDING);
  await assert.rejects(
    service.issueHandoff(BINDING, created.attempt_id, controller.signal),
    hasCode("AUTH_REQUEST_ABORTED")
  );
  assert.equal(
    (await service.getStatus(BINDING, created.attempt_id)).status,
    "FAILED_RETRYABLE"
  );
});

test("auth cleanup cannot hang and late responses are reaped", async () => {
  let stalledCancelCalled = false;
  const stalledResponse = new Response(
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
  const stalledProvider = new ObservedSyntxAuthProvider({
    requestTimeoutMs: 5,
    fetchImpl: async () => stalledResponse
  });
  await assert.rejects(
    Promise.race([
      stalledProvider.createChallenge(),
      rejectAfter(100, "auth cleanup exceeded the outer test deadline")
    ]),
    (error: unknown) =>
      error instanceof AuthProviderError && error.retryable
  );
  assert.equal(stalledCancelCalled, true);

  let resolveLate: ((response: Response) => void) | undefined;
  let lateCancelCalled = false;
  const lateProvider = new ObservedSyntxAuthProvider({
    requestTimeoutMs: 5,
    fetchImpl: async () =>
      await new Promise<Response>((resolve) => {
        resolveLate = resolve;
      })
  });
  await assert.rejects(lateProvider.createChallenge(), (error: unknown) =>
    error instanceof AuthProviderError && error.retryable
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

test("auth rejects redirected responses, transient statuses and invalid UTF-8", async () => {
  const redirected = new Response(JSON.stringify({ uuid: UPSTREAM_UUID }), {
    headers: { "content-type": "application/json" }
  });
  Object.defineProperties(redirected, {
    redirected: { value: true },
    url: { value: "https://evil.example/redirected" }
  });
  await assert.rejects(
    new ObservedSyntxAuthProvider({
      fetchImpl: async () => redirected
    }).createChallenge(),
    hasCode("MALFORMED_PROVIDER_RESPONSE")
  );

  const invalidUtf8 = bytesWithInvalidUtf8(
    '{"uuid":"018f2f60-91c4-7c3d-8e52-0f7d0e21b5',
    '1"}'
  );
  await assert.rejects(
    new ObservedSyntxAuthProvider({
      fetchImpl: async () =>
        new Response(invalidUtf8.buffer as ArrayBuffer, {
          headers: { "content-type": "application/json" }
        })
    }).createChallenge(),
    hasCode("MALFORMED_PROVIDER_RESPONSE")
  );

  for (const status of [408, 425, 429, 500]) {
    const { service } = createHarness(
      (async () =>
        new Response("{}", {
          status,
          headers: { "content-type": "application/json" }
        })) as typeof fetch
    );
    const created = await service.createAttempt(BINDING);
    const result = await service.issueHandoff(BINDING, created.attempt_id);
    assert.equal(result.attempt.status, "FAILED_RETRYABLE");
  }
});

test("credential receiver failures are normalized without echoing the bearer", async () => {
  const secret = ["BEARER", "SENTINEL", "RECEIVER", "910c81"].join("_");
  const provider = new ObservedSyntxAuthProvider({
    fetchImpl: sequenceFetch([
      {
        valid: true,
        complete: true,
        token: secret,
        is_new_user: false
      }
    ])
  });
  await assert.rejects(
    provider.pollChallenge(UPSTREAM_UUID, (credential) => {
      throw new Error(`receiver failed for ${credential.value}`);
    }),
    (error: unknown) => {
      assert.ok(error instanceof AuthProviderError);
      assert.equal(error.retryable, true);
      assert.equal(String(error).includes(secret), false);
      return true;
    }
  );
});

function createHarness(
  fetchImpl: typeof fetch,
  options: {
    now?: () => number;
    ttlMs?: number;
    requestTimeoutMs?: number;
  } = {}
) {
  const now = options.now ?? (() => Date.parse("2026-09-02T12:00:00.000Z"));
  const provider = new ObservedSyntxAuthProvider({
    fetchImpl,
    requestTimeoutMs: options.requestTimeoutMs ?? 1_000
  });
  const store = new InMemoryAuthLinkStore(now);
  const service = new PerUserLinkService(provider, store, {
    now,
    defaultTtlMs: options.ttlMs ?? 5 * 60_000,
    attemptIdGenerator: () => PUBLIC_ATTEMPT_ID
  });
  return { provider, store, service };
}

function sequenceFetch(
  payloads: unknown[],
  requests: Array<{ url: string; method: string; body: BodyInit | null }> = []
): typeof fetch {
  let index = 0;
  return (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const payload = payloads[index];
    index += 1;
    if (payload === undefined) throw new Error("Unexpected mock request.");
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      body: init?.body ?? null
    });
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

function hasCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof AuthLinkError && error.code === code;
}

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
