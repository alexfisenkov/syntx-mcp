import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider, AuthBinding } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient, isOwnerSunoGenerationResultMessageContext } from "../src/adapter/syntx/chat-http-client.js";
import { normalizeOwnerSunoGenerationParameters } from "../src/application/owner-suno-generation-parameters.js";
import { OwnerSunoGenerationRequestPreparer } from "../src/application/owner-suno-generation-request-preparer.js";
import { OwnerSunoGenerationOneShotPolicy } from "../src/application/owner-suno-generation-one-shot-policy.js";
import { OwnerSunoTrackContextStore } from "../src/application/owner-suno-track-context.js";
import { normalizeOwnerSunoTrackOperationParameters } from "../src/application/owner-suno-track-operation-parameters.js";
import * as preparerModule from "../src/application/owner-suno-track-operation-request-preparer.js";
import * as oneShotModule from "../src/application/owner-suno-track-operation-one-shot-policy.js";

const ATTEMPT_A = "link_suno_operation_1299_owner_a_0123456789";
const ATTEMPT_B = "link_suno_operation_1299_owner_b_0123456789";
const BINDING_A = Object.freeze({ tenant_id: "suno-operation-1299-tenant", subject: "suno-operation-1299-owner" });
const BINDING_B = Object.freeze({ tenant_id: "suno-operation-1299-tenant-b", subject: "suno-operation-1299-owner-b" });
const PROMPT = "A synthetic cover operation for the genuine local fixture";
const CREDENTIAL = "synthetic-suno-operation-1299-credential";
const stores = new Set<InMemoryAuthLinkStore>();

interface NativeApi {
  createOwnerSunoGenerationChat(input: unknown): Promise<Record<string, unknown>>;
  startSunoWithOwnedCandidate(input: unknown): Promise<Record<string, unknown>>;
  listOwnedSunoGenerationCandidates(chat: unknown): Promise<Record<string, unknown>>;
  getOwnedSunoGenerationResult(context: unknown): Promise<unknown>;
}

function api(client: SyntxChatHttpClient): NativeApi { return client as unknown as NativeApi; }

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function generateParameters(): Record<string, unknown> {
  return { model_id: "V6", mode: "generate", prompt: PROMPT, is_custom_mode: false,
    is_instrumental: true, negative_tags: "", styles: "", title: "Suno operation fixture" };
}

function operationParameters(trackHandle: string, mode: "cover" | "extend" = "cover",
  overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model_id: "V6", mode, track_handle: trackHandle, prompt: "A bright cover arrangement",
    is_custom_mode: false, is_instrumental: false, negative_tags: "", styles: "warm strings",
    title: "Cover fixture", ...(mode === "extend" ? { continue_at: 12.3 } : {}), ...overrides
  };
}

async function fixture(options: { readonly trackTtlMs?: number } = {}) {
  let now = Date.parse("2026-10-14T00:00:00.000Z");
  let challenge = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      challenge += 1;
      return { upstream_attempt_id: `synthetic-suno-operation-challenge-${challenge}`, approval_url: "https://example.invalid/" };
    },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const authStore = new InMemoryAuthLinkStore(() => now);
  stores.add(authStore);
  const attemptIds = [ATTEMPT_A, ATTEMPT_B];
  const linkService = new PerUserLinkService(provider, authStore, {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attemptIds.shift() ?? ATTEMPT_B
  });
  for (const [binding, attemptId] of [[BINDING_A, ATTEMPT_A], [BINDING_B, ATTEMPT_B]] as const) {
    await linkService.createAttempt(binding);
    await linkService.issueHandoff(binding, attemptId);
    assert.equal((await linkService.checkAttempt(binding, attemptId)).status, "LINKED");
  }
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return linkService.useCredential(BINDING_A, ATTEMPT_A, (credential) => operation(credential.value));
    }
  };
  const audioIds = ["suno-operation-audio-1299-a", "suno-operation-audio-1299-b"];
  const audioObjects = (messageId: string) => audioIds.map((id) => ({
    id, message_id: messageId, object_type: "audio", object_url: `https://r2.syntx.ai/generated/${id}.mp3`,
    completed: true, model_type: "V6"
  }));
  let chatUuid = "";
  let ackId = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatUuid = "suno-operation-chat-1299";
      return Response.json({ uuid: chatUuid });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      ackId = "suno-operation-ack-1299";
      return Response.json({ id: ackId });
    }
    if (url.pathname.endsWith("/messages") && method === "GET") return Response.json({
      messages: [
        { id: ackId, chat_id: 9002, author_id: 42, message_object: [{ id: "suno-operation-owner-text-1299",
          message_id: ackId, object_type: "text", object_text: PROMPT, model_type: "V6" }] },
        { id: "suno-operation-bot-message-1299", chat_id: 9002, author_id: -1,
          message_object: audioObjects("suno-operation-bot-message-1299") }
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
    });
    if (/^\/api\/v1\/chats\/[^/]+\/[^/]+$/u.test(url.pathname) && method === "GET") return Response.json({
      id: "suno-operation-bot-message-1299", chat_id: 9002, author_id: -1,
      message_object: audioObjects("suno-operation-bot-message-1299").map((audio) => ({
        ...audio, metadata: { payload: { clip_id: "synthetic-cover-clip-1299", task_id: "synthetic-task-1299" } }
      })), created_at: "2026-10-14T00:00:00Z", is_favorite: false
    });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const genPreparer = new OwnerSunoGenerationRequestPreparer({ binding: BINDING_A, linkService, now: () => now });
  const genPolicy = new OwnerSunoGenerationOneShotPolicy({ preparer: genPreparer, now: () => now });
  const normalizedGenerate = normalizeOwnerSunoGenerationParameters(generateParameters());
  const genCandidate = await genPreparer.prepare({ attemptId: ATTEMPT_A, normalized: normalizedGenerate });
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING_A, attemptId: ATTEMPT_A, linkService });
  const genPermit = genPolicy.createPermit({ candidate: genCandidate, attemptId: ATTEMPT_A, principal });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const native = api(client);
  const chat = await native.createOwnerSunoGenerationChat({ candidate: genCandidate, permit: genPermit,
    preparer: genPreparer, oneShotPolicy: genPolicy, principal, attemptId: ATTEMPT_A });
  await native.startSunoWithOwnedCandidate({ chat, candidate: genCandidate, permit: genPermit,
    preparer: genPreparer, oneShotPolicy: genPolicy, principal, attemptId: ATTEMPT_A });
  const history = await native.listOwnedSunoGenerationCandidates(chat);
  const resultContext = (history.contexts as unknown[])[0];
  assert.ok(isOwnerSunoGenerationResultMessageContext(resultContext, client));
  await native.getOwnedSunoGenerationResult(resultContext);
  const trackContextStore = new OwnerSunoTrackContextStore({ now: () => now,
    ...(options.trackTtlMs === undefined ? {} : { ttlMs: options.trackTtlMs }) });
  const trackHandles = audioIds.map((messageObjectId) => trackContextStore.issue({ binding: BINDING_A,
    attemptId: ATTEMPT_A, principal, client, resultContext: resultContext as never, messageObjectId }));

  function createTrackOperationPreparer(binding: AuthBinding = BINDING_A) {
    return new preparerModule.OwnerSunoTrackOperationRequestPreparer({
      binding, linkService, trackContextStore, now: () => now
    });
  }
  async function linkedPrincipal(attemptId: string, binding: AuthBinding): Promise<Readonly<GenerationPrincipalRef>> {
    return resolveOwnerReferencePrincipal({ binding, attemptId, linkService });
  }
  return {
    linkService, client, trackContextStore, trackHandles,
    get now() { return now; }, set now(value: number) { now = value; },
    createTrackOperationPreparer,
    linkedPrincipal,
    async close() {
      genPolicy.close();
      genPreparer.close();
      trackContextStore.close();
      authStore.close();
    }
  };
}

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

test("track-operation preparation is nominal, private, and bound to a genuine owner track context", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  const oneShot = new oneShotModule.OwnerSunoTrackOperationOneShotPolicy({ preparer, now: () => f.now });
  try {
    const handle = f.trackHandles[0]!;
    const input = operationParameters(handle);
    const normalized = normalizeOwnerSunoTrackOperationParameters(input);
    const candidate = await preparer.prepare({ attemptId: ATTEMPT_A, normalized });
    assert.equal(preparerModule.isOwnerSunoTrackOperationPreparedCandidate(candidate), true);
    assert.equal(preparerModule.isOwnerSunoTrackOperationPreparedCandidate({ ...candidate }), false);
    assert.equal(candidate.model_id, "V6");
    assert.equal(candidate.mode, "cover");
    assert.equal(candidate.dispatch_allowed, false);
    assert.equal(candidate.runtime_usable, false);
    assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(candidate).includes(handle), false);
    assert.equal(JSON.stringify(candidate).includes("synthetic-cover-clip-1299"), false);
    assert.equal(JSON.stringify(candidate).includes("synthetic-task-1299"), false);
    assert.equal(JSON.stringify(candidate).includes(String(input.prompt)), false);
    assert.equal(JSON.stringify(candidate).includes(BINDING_A.subject), false);
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    const context = { candidate, attemptId: ATTEMPT_A, principal };
    const permit = oneShot.createPermit(context);
    assert.equal(oneShotModule.isOwnerSunoTrackOperationOneShotPermit(permit), true);
    assert.equal(JSON.stringify(permit).includes(handle), false);
    oneShot.revalidate({ ...context, permit });
    const consumed = oneShot.consume({ ...context, permit });
    assert.deepEqual(consumed.private_request, {
      ai_name: "suno",
      prompt: "A bright cover arrangement",
      settings: {
        model_type: "V6", mode: "cover", is_custom_mode: false, is_instrumental: false,
        negative_tags: "", styles: "warm strings", title: "Cover fixture",
        source_clip_id: "synthetic-cover-clip-1299", source_task_id: "synthetic-task-1299"
      }
    });
    assert.equal(consumed.dispatch_allowed, false);
    assert.throws(() => oneShot.consume({ ...context, permit }),
      (error: unknown) => errorCode(error) === "PERMIT_ALREADY_CONSUMED");
  } finally { oneShot.close(); preparer.close(); await f.close(); }
});

test("extend preserves explicit seconds while cover cannot carry continuation", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  const oneShot = new oneShotModule.OwnerSunoTrackOperationOneShotPolicy({ preparer, now: () => f.now });
  try {
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    const extend = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!, "extend")) });
    const context = { candidate: extend, attemptId: ATTEMPT_A, principal };
    const permit = oneShot.createPermit(context);
    oneShot.revalidate({ ...context, permit });
    const result = oneShot.consume({ ...context, permit });
    assert.equal(result.private_request?.settings.mode, "extend");
    assert.equal(result.private_request?.settings.continue_at, 12.3);
    assert.throws(() => normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!, "cover", {
      continue_at: 0
    })), (error: unknown) => errorCode(error) === "INVALID_PARAMETERS");
  } finally { oneShot.close(); preparer.close(); await f.close(); }
});

test("same-mode intent fingerprint is stable across opaque handles but binds source metadata", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  try {
    const first = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!)) });
    const second = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[1]!)) });
    assert.notEqual(f.trackHandles[0], f.trackHandles[1]);
    assert.equal(first.intent_fingerprint, second.intent_fingerprint);
  } finally { preparer.close(); await f.close(); }
});

test("consumed semantic intent stays claimed across distinct genuine handles", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  const oneShot = new oneShotModule.OwnerSunoTrackOperationOneShotPolicy({ preparer, now: () => f.now });
  try {
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    const candidateA = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!)) });
    const contextA = { candidate: candidateA, attemptId: ATTEMPT_A, principal };
    const permit = oneShot.createPermit(contextA);
    oneShot.revalidate({ ...contextA, permit });
    oneShot.consume({ ...contextA, permit });
    const candidateB = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[1]!)) });
    assert.throws(() => oneShot.createPermit({ candidate: candidateB, attemptId: ATTEMPT_A, principal }),
      (error: unknown) => errorCode(error) === "INTENT_ALREADY_CLAIMED");
  } finally { oneShot.close(); preparer.close(); await f.close(); }
});

test("one-shot claims remain bounded at 128 and consumed claims are not evicted", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  const oneShot = new oneShotModule.OwnerSunoTrackOperationOneShotPolicy({ preparer, now: () => f.now });
  try {
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    for (let index = 0; index < 128; index += 1) {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT_A,
        normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!, "cover", {
          prompt: `Distinct bounded local intent ${index}`
        })) });
      const context = { candidate, attemptId: ATTEMPT_A, principal };
      const permit = oneShot.createPermit(context);
      oneShot.revalidate({ ...context, permit });
      oneShot.consume({ ...context, permit });
    }
    const overflow = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!, "cover", {
        prompt: "Distinct bounded local intent 128"
      })) });
    assert.throws(() => oneShot.createPermit({ candidate: overflow, attemptId: ATTEMPT_A, principal }),
      (error: unknown) => errorCode(error) === "CAPACITY_EXCEEDED");
  } finally { oneShot.close(); preparer.close(); await f.close(); }
});

test("rejects model mismatch, unknown handles, and handles owned by another linked principal", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  const otherPreparer = f.createTrackOperationPreparer(BINDING_B);
  try {
    await assert.rejects(preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!, "cover", { model_id: "V6_wild" })) }),
    (error: unknown) => errorCode(error) === "TRACK_MODEL_MISMATCH");
    await assert.rejects(preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters("track_00000000-0000-0000-0000-000000000000")) }),
    (error: unknown) => errorCode(error) === "TRACK_CONTEXT_UNAVAILABLE");
    await assert.rejects(otherPreparer.prepare({ attemptId: ATTEMPT_B,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!)) }),
    (error: unknown) => errorCode(error) === "TRACK_CONTEXT_UNAVAILABLE");
  } finally { otherPreparer.close(); preparer.close(); await f.close(); }
});

test("candidate lifetime never exceeds its owned track handle expiry", async () => {
  const f = await fixture({ trackTtlMs: 60_000 });
  const preparer = f.createTrackOperationPreparer();
  try {
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    const candidate = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!)) });
    assert.equal(candidate.expires_at, f.now + 60_000);
    f.now += 60_000;
    assert.throws(() => preparer.revalidateCandidate({ candidate, attemptId: ATTEMPT_A,
      principal }), (error: unknown) => errorCode(error) === "CANDIDATE_EXPIRED");
  } finally { preparer.close(); await f.close(); }
});

test("preparer close does not close its borrowed track-context store", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  try {
    preparer.close();
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    const projection = f.trackContextStore.resolve({ binding: BINDING_A, attemptId: ATTEMPT_A,
      principal, trackHandle: f.trackHandles[0]! });
    assert.equal(projection.model_id, "V6");
  } finally { await f.close(); }
});

test("one-shot rejects forged permits and does not permit proxy-backed inputs", async () => {
  const f = await fixture();
  const preparer = f.createTrackOperationPreparer();
  const oneShot = new oneShotModule.OwnerSunoTrackOperationOneShotPolicy({ preparer, now: () => f.now });
  try {
    const candidate = await preparer.prepare({ attemptId: ATTEMPT_A,
      normalized: normalizeOwnerSunoTrackOperationParameters(operationParameters(f.trackHandles[0]!)) });
    const principal = await f.linkedPrincipal(ATTEMPT_A, BINDING_A);
    const context = { candidate, attemptId: ATTEMPT_A, principal };
    const fakePermit = Object.freeze({ status: "nominal", attempt_id: ATTEMPT_A, model_id: "V6", mode: "cover",
      expires_at: candidate.expires_at, source_profile_schema_hash: candidate.source_profile_schema_hash,
      intent_fingerprint: candidate.intent_fingerprint, dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
    assert.equal(oneShotModule.isOwnerSunoTrackOperationOneShotPermit(fakePermit), false);
    assert.throws(() => oneShot.revalidate({ ...context, permit: fakePermit }),
      (error: unknown) => errorCode(error) === "PERMIT_INVALID");
    assert.throws(() => oneShot.revalidate({ ...context, permit: new Proxy(fakePermit, {}) }),
      (error: unknown) => errorCode(error) === "PERMIT_INVALID");
    assert.throws(() => oneShot.createPermit(new Proxy(context, {})),
      (error: unknown) => errorCode(error) === "INVALID_REQUEST");
  } finally { oneShot.close(); preparer.close(); await f.close(); }
});

