import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerUniImageGenerationService, OwnerUniImageGenerationServiceError,
  type OwnerUniImageGenerationPreflightInput } from "../src/application/owner-uni-image-generation-service.js";
import { OwnerUniImageRequestPreparer } from "../src/application/owner-uni-image-request-preparer.js";
import { OwnerUniImageUploadService } from "../src/application/owner-uni-image-upload-service.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"))));
const BINDING = Object.freeze({ tenant_id: "uni-cache-tenant", subject: "uni-cache-subject" });
const ATTEMPT_A = "link_uni_cache_attempt_a_000000000001";
const ATTEMPT_B = "link_uni_cache_attempt_b_000000000002";
const INPUT = Object.freeze({ variant: "uni-1" as const, prompt: "same explicit semantic image intent",
  parameters: Object.freeze({ aspect_ratio: "16:9" as const, seed: null, mode: "auto" as const }),
  image_reference_handles: Object.freeze([] as const), main_image_reference_handle: null });
const RESULT_URL_A = "https://r2.syntx.ai/uni-cache/attempt-a-result.png";

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createRig() {
  type AttemptClient = { readonly chat: SyntxChatHttpClient; readonly read: SyntxHttpClient;
    readonly events: Array<{ method: string; path: string; authorization: string | null }>;
    posts: number; chats: number };
  const attempts = new Map<string, AttemptClient>();
  const transactions = new Map<string, { readonly attemptId: string; readonly ack: string; readonly resultMessage: string }>();
  const createAttemptClient = (attemptId: string, credential: string): AttemptClient => {
    const events: AttemptClient["events"] = [];
    const state = { events, posts: 0, chats: 0 };
    const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (value: string) => Promise<T>) {
      return operation(credential);
    } };
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = new URL(String(request));
      const method = init?.method ?? "GET";
      const authorization = new Headers(init?.headers).get("authorization");
      events.push({ method, path: url.pathname, authorization });
      if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
      if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: null });
      if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 1,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
      if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
        const file = (init?.body as FormData | undefined)?.get("files");
        assert.ok(file instanceof File);
        return Response.json({ files: [{ id: `${attemptId}-upload`, url: `https://r2.syntx.ai/uni-cache/${attemptId}-input.jpg`,
          mime_type: file.type, size: file.size, model_type: "uni-1" }] });
      }
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        state.chats += 1;
        return Response.json({ uuid: `uni-cache-${attemptId}-chat-${state.chats}` });
      }
      if (url.pathname === "/api/v1/design/generate" && method === "POST") {
        state.posts += 1;
        const body = JSON.parse(String(init?.body)) as { chat_uuid: string; settings: { model_type: string } };
        const ack = `uni-cache-${attemptId}-ack-${state.posts}`;
        transactions.set(body.chat_uuid, { attemptId, ack, resultMessage: `uni-cache-${attemptId}-result-${state.posts}` });
        return Response.json({ id: ack });
      }
      const history = /^\/api\/v1\/chats\/(uni-cache-.+-chat-\d+)\/messages$/u.exec(url.pathname);
      if (history) {
        const transaction = transactions.get(history[1]!);
        assert.ok(transaction);
        return Response.json({ messages: [
          { id: transaction.ack, chat_id: 8101, author_id: 100, message_object: [] },
          { id: transaction.resultMessage, chat_id: 8101, author_id: -1, message_object: [{
            id: `uni-cache-${transaction.attemptId}-result-object`, message_id: transaction.resultMessage,
            object_type: "image", model_type: "uni-1" }] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const result = /^\/api\/v1\/chats\/(uni-cache-.+-chat-\d+)\/(uni-cache-.+-result-\d+)$/u.exec(url.pathname);
      if (result && method === "GET") {
        const transaction = transactions.get(result[1]!);
        assert.ok(transaction);
        assert.equal(result[2], transaction.resultMessage);
        return Response.json({ id: transaction.resultMessage, chat_id: 8101, author_id: -1, message_object: [{
          id: `uni-cache-${transaction.attemptId}-result-object`, message_id: transaction.resultMessage,
          object_type: "image", model_type: "uni-1", completed: true,
          object_url: transaction.attemptId === ATTEMPT_A ? RESULT_URL_A : `https://r2.syntx.ai/uni-cache/${transaction.attemptId}-result.png`
        }] });
      }
      throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
    };
    return Object.assign(state, {
      chat: new SyntxChatHttpClient({ credentialBroker, fetchImpl }),
      read: new SyntxHttpClient({ credentialBroker, fetchImpl })
    }) as AttemptClient;
  };
  attempts.set(ATTEMPT_A, createAttemptClient(ATTEMPT_A, "synthetic-credential-A"));
  attempts.set(ATTEMPT_B, createAttemptClient(ATTEMPT_B, "synthetic-credential-B"));
  const clientFor = (attemptId: string) => {
    const client = attempts.get(attemptId);
    if (!client) throw new Error("Synthetic attempt has no client");
    return client;
  };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: (attemptId: string) => clientFor(attemptId).chat });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION });
  const accountByAttempt = new Map([...attempts].map(([attemptId, client]) => [attemptId, new AccountStatusService(client.read)]));
  const accessByAttempt = new Map([...attempts].map(([attemptId, client]) => [attemptId, new ModelAccessService(CATALOG, client.read)]));
  const service = new OwnerUniImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, resolveChatClient: (attemptId: string) => clientFor(attemptId).chat,
    preflight: async (input: Readonly<OwnerUniImageGenerationPreflightInput>) => {
      const account = accountByAttempt.get(input.attemptId);
      const access = accessByAttempt.get(input.attemptId);
      assert.ok(account && access);
      return { account: await account.getAccountStatus(input.signal), model_access: await access.getModelAccess({
        model_id: input.model_id, cost_parameters: input.cost_inputs }, input.signal) };
    }, pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });
  return { attempts, service, async close() { await service.close(); await preparer.close(); await uploadService.close(); } };
}

test("Uni successful semantic cache is isolated to its linked attempt, principal, and native client", async () => {
  const rig = createRig();
  try {
    const request = (attemptId: string) => ({ attemptId, ...INPUT });
    const first = await rig.service.generate(request(ATTEMPT_A));
    assert.equal(first.status, "result_observed");
    assert.equal(first.artifacts[0]?.url, RESULT_URL_A);
    assert.equal(rig.attempts.get(ATTEMPT_A)?.posts, 1);
    assert.notStrictEqual(rig.attempts.get(ATTEMPT_A)?.chat, rig.attempts.get(ATTEMPT_B)?.chat);
    assert.ok(rig.attempts.get(ATTEMPT_A)?.events.some((event) => event.authorization === "Bearer synthetic-credential-A"));

    await assert.rejects(rig.service.generate(request(ATTEMPT_B)), (error: unknown) => {
      assert.ok(error instanceof OwnerUniImageGenerationServiceError);
      assert.equal(error.code, "REFERENCE_ALREADY_CLAIMED");
      assert.equal(error.message.includes(RESULT_URL_A), false);
      return true;
    });
    assert.equal(rig.attempts.get(ATTEMPT_B)?.posts, 0, "a foreign cached result must not start B's generation");
    assert.equal(rig.attempts.get(ATTEMPT_B)?.events.some((event) => event.authorization === "Bearer synthetic-credential-A"), false);

    const cachedA = await rig.service.generate(request(ATTEMPT_A));
    assert.strictEqual(cachedA, first, "A can still reuse its own completed result after B is rejected");
    assert.equal(rig.attempts.get(ATTEMPT_A)?.posts, 1);
    assert.equal(rig.attempts.get(ATTEMPT_B)?.posts, 0);
  } finally { await rig.close(); }
});
