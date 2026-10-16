import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerGrokT2iImageUploadService } from "../src/application/owner-grok-t2i-image-upload-service.js";
import { OwnerGrokT2iGenerationService, OwnerGrokT2iGenerationServiceError } from "../src/application/owner-grok-t2i-generation-service.js";
import { createOwnerGrokT2iRequestPreparer } from "../src/application/owner-grok-t2i-request-preparer.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";

const NOW = Date.parse("2026-10-16T08:00:00.000Z");
const ATTEMPTS = ["link_grok_cache_a_000000000001", "link_grok_cache_b_000000000002"] as const;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "synthetic-grok-cache-tenant", subject: "synthetic-grok-cache-owner" });
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"))));
const REQUEST = Object.freeze({ model_id: "grok_t2i" as const, parameters: Object.freeze({
  aspect_ratio: "1:1" as const, resolution: "1k" as const, batch_size: 1 as const
}), prompt: "Synthetic identical intent for Grok T2I cache isolation.", reference_handles: Object.freeze([] as string[]) });

interface SyntheticJob {
  readonly attemptId: string;
  readonly chatUuid: string;
  readonly modelId: string;
  readonly ownerMessageId: string;
  readonly resultMessageId: string;
  readonly objectId: string;
  readonly providerChatId: number;
  readonly objectUrl: string;
}

function freshPreflight(modelId: string, parameterKeys: string[]) {
  return { account: { balance: { unit: "tokens" as const, available: "100" },
    subscription: { active: true, plan_type: "PRO", end_date: null, end_date_kind: null },
    contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: new Date(NOW).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: modelId, ai_name: "grok_image", model_type: modelId, account_read_live: true as const,
      parameter_keys: parameterKeys, parameters_redacted: true as const, access: true, cost: 1, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(NOW).toISOString() } };
}

async function linkedAttempts() {
  let next = 0;
  const store = new InMemoryAuthLinkStore(() => NOW);
  const linkService = new PerUserLinkService({} as never, store, { now: () => NOW, attemptIdGenerator: () => ATTEMPTS[next++]! });
  for (const [index, attemptId] of ATTEMPTS.entries()) {
    await linkService.createAttempt(BINDING);
    await store.beginHandoff(BINDING, attemptId);
    await store.attachChallenge(BINDING, attemptId, `synthetic-grok-cache-upstream-${index}`);
    await store.beginPoll(BINDING, attemptId);
    await store.markLinked(BINDING, attemptId, Object.freeze({ scheme: "Bearer", value: `synthetic-grok-cache-account-${index}` }));
  }
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[0])).status, "LINKED");
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[1])).status, "LINKED");
  const firstCredential = await store.useCredential(BINDING, ATTEMPTS[0], (credential) => credential.value);
  const secondCredential = await store.useCredential(BINDING, ATTEMPTS[1], (credential) => credential.value);
  assert.notEqual(firstCredential, secondCredential);
  return { linkService, store };
}

test("completed Grok T2I cache rejects a different linked attempt and remains reusable by its owner", async () => {
  const { linkService, store } = await linkedAttempts();
  const calls = new Map<string, { chats: number; posts: number; histories: number; results: number; credentials: string[] }>(
    ATTEMPTS.map((attemptId) => [attemptId, { chats: 0, posts: 0, histories: 0, results: 0, credentials: [] }] as const));
  const jobs = new Map<string, SyntheticJob>();
  const clients = new Map<string, SyntxChatHttpClient>();
  let sequence = 0;

  for (const attemptId of ATTEMPTS) {
    const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      const credential = await store.useCredential(BINDING, attemptId, (record) => record.value);
      calls.get(attemptId)!.credentials.push(credential);
      return operation(credential);
    } };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (url.pathname === "/api/v1/chats" && method === "POST") {
        sequence += 1;
        const chatUuid = `grok-cache-chat-${attemptId.endsWith("1") ? "a" : "b"}-${sequence}`;
        calls.get(attemptId)!.chats += 1;
        return Response.json({ uuid: chatUuid });
      }
      if (url.pathname === "/api/v1/design/generate" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as { chat_uuid: string; settings: { model_type: string; batch_size: number } };
        const ownerMessageId = `grok-cache-owner-${sequence}`;
        const resultMessageId = `grok-cache-result-${sequence}`;
        const providerChatId = 9300 + sequence;
        const objectId = `grok-cache-object-${sequence}`;
        const job: SyntheticJob = Object.freeze({ attemptId, chatUuid: body.chat_uuid, modelId: body.settings.model_type,
          ownerMessageId, resultMessageId, providerChatId, objectId,
          objectUrl: `https://r2.syntx.ai/grok-cache1935/${attemptId.endsWith("1") ? "a" : "b"}-${sequence}.png` });
        jobs.set(job.chatUuid, job);
        calls.get(attemptId)!.posts += 1;
        return Response.json({ id: ownerMessageId });
      }
      const history = /^\/api\/v1\/chats\/(grok-cache-chat-[a-z]-\d+)\/messages$/u.exec(url.pathname);
      if (history) {
        const job = jobs.get(history[1]!); assert.ok(job);
        calls.get(job.attemptId)!.histories += 1;
        return Response.json({ messages: [
          { id: job.ownerMessageId, chat_id: job.providerChatId, author_id: 101, message_object: [] },
          { id: job.resultMessageId, chat_id: job.providerChatId, author_id: -1, message_object: [
            { id: job.objectId, message_id: job.resultMessageId, object_type: "image", model_type: job.modelId }
          ] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const resultPath = /^\/api\/v1\/chats\/(grok-cache-chat-[a-z]-\d+)\/(grok-cache-result-\d+)$/u.exec(url.pathname);
      if (resultPath) {
        const job = jobs.get(resultPath[1]!); assert.ok(job); assert.equal(resultPath[2], job.resultMessageId);
        calls.get(job.attemptId)!.results += 1;
        return Response.json({ id: job.resultMessageId, chat_id: job.providerChatId, author_id: -1, message_object: [
          { id: job.objectId, message_id: job.resultMessageId, object_type: "image", model_type: job.modelId,
            completed: true, object_url: job.objectUrl }
        ] });
      }
      throw new Error(`Unexpected synthetic Grok T2I request ${method} ${url.pathname}`);
    };
    clients.set(attemptId, new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 }));
  }

  const resolveClient = (attemptId: string) => {
    const client = clients.get(attemptId);
    if (!client) throw new Error("Synthetic linked attempt has no native client");
    return client;
  };
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient, now: () => NOW });
  const preparer = createOwnerGrokT2iRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  const service = new OwnerGrokT2iGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, imageUploadService: uploadService, preparer, resolveChatClient: resolveClient,
    preflight: async (input) => freshPreflight(input.model_id, Object.keys(input.cost_inputs).sort()), now: () => NOW,
    pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });

  try {
    assert.notStrictEqual(clients.get(ATTEMPTS[0]), clients.get(ATTEMPTS[1]));
    const resultA = await service.generate({ attemptId: ATTEMPTS[0], ...REQUEST });
    assert.equal(resultA.status, "result_observed");
    assert.equal(calls.get(ATTEMPTS[0])!.posts, 1);
    assert.equal(calls.get(ATTEMPTS[1])!.posts, 0);
    assert.ok(calls.get(ATTEMPTS[0])!.credentials.includes("synthetic-grok-cache-account-0"));
    assert.equal(calls.get(ATTEMPTS[1])!.credentials.length, 0);

    await assert.rejects(service.generate({ attemptId: ATTEMPTS[1], ...REQUEST }), (cause: unknown) => {
      assert.ok(cause instanceof OwnerGrokT2iGenerationServiceError);
      assert.equal(cause.code, "INTENT_ALREADY_CLAIMED");
      assert.equal(cause.recovery_id, undefined);
      assert.equal(cause.diagnostic, undefined);
      return true;
    });
    assert.equal(calls.get(ATTEMPTS[1])!.posts, 0);
    assert.equal(calls.get(ATTEMPTS[1])!.chats, 0);

    const resultAAgain = await service.generate({ attemptId: ATTEMPTS[0], ...REQUEST });
    assert.strictEqual(resultAAgain, resultA);
    assert.equal(calls.get(ATTEMPTS[0])!.posts, 1);
    assert.equal(calls.get(ATTEMPTS[0])!.chats, 1);
  } finally { await service.close(); }
});
