import assert from "node:assert/strict";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerWanT2iGenerationService, OwnerWanT2iGenerationServiceError, type OwnerWanT2iGenerationResult } from "../src/application/owner-wan-t2i-generation-service.js";
import { OwnerWanT2iRequestPreparer } from "../src/application/owner-wan-t2i-request-preparer.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { join } from "node:path";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import type { OwnerWanT2iParametersInput } from "../src/application/owner-wan-t2i-parameters.js";

const NOW = Date.parse("2026-10-16T08:00:00.000Z");
const ATTEMPTS = ["link_wan_t2i_cache_a_000000000001", "link_wan_t2i_cache_b_000000000002"] as const;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "synthetic-t2i-tenant", subject: "synthetic-mcp-binding" });
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, CATALOG_DIRECTORY));
const INPUT: OwnerWanT2iParametersInput = Object.freeze({ model_id: "wan_26_t2i", prompt: "Synthetic prompt for cache isolation.",
  parameters: Object.freeze({ aspect_ratio: "1:1", resolution: "720P", batch_size: 1, prompt_extend: false, seed: null,
    color_palette: null, bbox_list: Object.freeze([] as const) }) });

interface Job { readonly actor: string; readonly chat_uuid: string; readonly model_id: string; readonly batch_size: number; readonly ack_id: string; readonly bot_id: string; readonly artifact_url: string }

async function linkedAttempts(): Promise<{ readonly linkService: PerUserLinkService; readonly store: InMemoryAuthLinkStore }> {
  let nextId = 0;
  const store = new InMemoryAuthLinkStore(() => NOW);
  const linkService = new PerUserLinkService({} as never, store, { now: () => NOW, attemptIdGenerator: () => ATTEMPTS[nextId++]! });
  for (const [index, attemptId] of ATTEMPTS.entries()) {
    await linkService.createAttempt(BINDING);
    await store.beginHandoff(BINDING, attemptId);
    await store.attachChallenge(BINDING, attemptId, `synthetic-upstream-${index}`);
    await store.beginPoll(BINDING, attemptId);
    await store.markLinked(BINDING, attemptId, Object.freeze({ scheme: "Bearer", value: `synthetic-t2i-account-${index}` }));
  }
  const first = await store.useCredential(BINDING, ATTEMPTS[0], (credential) => credential.value);
  const second = await store.useCredential(BINDING, ATTEMPTS[1], (credential) => credential.value);
  assert.notEqual(first, second);
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[0])).status, "LINKED");
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[1])).status, "LINKED");
  return { linkService, store };
}

test("WAN T2I success cache rejects another linked attempt but remains readable by its owner", async () => {
  const { linkService, store } = await linkedAttempts();
  const jobs = new Map<string, Job>(), clients = new Map<string, SyntxChatHttpClient>(), requests: Array<{ actor: string; method: string; path: string }> = [];
  const postsByAttempt = new Map<string, number>(); let chatSequence = 0, jobSequence = 0;
  const fetchFor = (actor: string): typeof fetch => async (requestInput, init) => {
    const url = new URL(requestInput instanceof Request ? requestInput.url : String(requestInput));
    const method = init?.method ?? "GET";
    requests.push({ actor, method, path: url.pathname });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T08:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 3, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatSequence += 1;
      const actorKey = actor === ATTEMPTS[0] ? "a" : "b";
      return Response.json({ uuid: `wan-t2i-cache-chat-${actorKey}-${chatSequence}` });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      jobSequence += 1;
      const input = body as { chat_uuid: string; settings: { model_type: string; batch_size: number } };
      const job: Job = { actor, chat_uuid: input.chat_uuid, model_id: input.settings.model_type, batch_size: input.settings.batch_size,
        ack_id: `wan-t2i-cache-owner-ack-${jobSequence}`, bot_id: `wan-t2i-cache-bot-${jobSequence}`,
        artifact_url: `https://r2.syntx.ai/wan-t2i-cache1931/${actor}-${jobSequence}.png` };
      jobs.set(job.chat_uuid, job);
      postsByAttempt.set(actor, (postsByAttempt.get(actor) ?? 0) + 1);
      return Response.json({ id: job.ack_id });
    }
    const historyMatch = /^\/api\/v1\/chats\/(wan-t2i-cache-chat-[a-z]-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      const job = jobs.get(historyMatch[1]!); assert.ok(job);
      return Response.json({ messages: [
        { id: job.ack_id, chat_id: 9101, author_id: 41, message_object: [] },
        { id: job.bot_id, chat_id: 9101, author_id: -1, message_object: Array.from({ length: job.batch_size }, (_, index) => ({
          id: 9300 + index, message_id: job.bot_id, object_type: "image", model_type: job.model_id
        })) }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(wan-t2i-cache-chat-[a-z]-\d+)\/(wan-t2i-cache-bot-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      const job = jobs.get(resultMatch[1]!); assert.ok(job); assert.equal(resultMatch[2], job.bot_id);
      return Response.json({ id: job.bot_id, chat_id: 9101, author_id: -1, message_object: Array.from({ length: job.batch_size }, (_, index) => ({
        id: 9300 + index, message_id: job.bot_id, object_type: "image", model_type: job.model_id,
        completed: true, object_url: job.artifact_url
      })) });
    }
    throw new Error(`Unexpected synthetic T2I request ${method} ${url.pathname} actor=${actor}`);
  };
  for (const attemptId of ATTEMPTS) {
    const credentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      const value = await store.useCredential(BINDING, attemptId, (credential) => credential.value);
      return operation(value);
    } };
    clients.set(attemptId, new SyntxChatHttpClient({ credentialBroker, fetchImpl: fetchFor(attemptId), maxResponseBytes: 1024 * 1024 }));
  }
  const httpFor = (attemptId: string) => {
    const credentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      const value = await store.useCredential(BINDING, attemptId, (credential) => credential.value);
      return operation(value);
    } };
    return new SyntxHttpClient({ credentialBroker, fetchImpl: fetchFor(attemptId) });
  };
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW });
  const service = new OwnerWanT2iGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, preparer,
    resolveChatClient: (attemptId: string) => clients.get(attemptId),
    createAccountStatusService: (attemptId: string) => new AccountStatusService(httpFor(attemptId), () => NOW),
    createModelAccessService: (attemptId: string) => new ModelAccessService(CATALOG, httpFor(attemptId), () => NOW), now: () => NOW,
    pollDelayMs: 0, maxPollAttempts: 1 });
  try {
    assert.notEqual(clients.get(ATTEMPTS[0]), clients.get(ATTEMPTS[1]));
    const resultA = await service.generate({ attemptId: ATTEMPTS[0], input: INPUT });
    assert.equal(resultA.status, "result_observed");
    assert.equal(resultA.artifacts.length, 1);
    assert.equal(postsByAttempt.get(ATTEMPTS[0]), 1);
    assert.equal(postsByAttempt.get(ATTEMPTS[1]) ?? 0, 0);

    let foreignResult: OwnerWanT2iGenerationResult | undefined, foreignError: unknown;
    try { foreignResult = await service.generate({ attemptId: ATTEMPTS[1], input: INPUT }); } catch (error) { foreignError = error; }
    assert.ok(foreignError instanceof OwnerWanT2iGenerationServiceError && foreignError.code === "INTENT_ALREADY_CLAIMED",
      foreignResult ? `attempt B received attempt A artifact_url=${foreignResult.artifacts[0]?.url}` : `unexpected error ${String(foreignError)}`);
    const claimError = foreignError as OwnerWanT2iGenerationServiceError;
    assert.equal(claimError.recovery_id, undefined);
    assert.equal(claimError.diagnostic, undefined);
    assert.equal(postsByAttempt.get(ATTEMPTS[1]) ?? 0, 0);
    assert.equal(requests.some((request) => request.actor === ATTEMPTS[1] && request.path === "/api/v1/design/generate"), false);

    const ownCachedResult = await service.generate({ attemptId: ATTEMPTS[0], input: INPUT });
    assert.equal(ownCachedResult.artifacts[0]?.url, resultA.artifacts[0]?.url);
    assert.equal(postsByAttempt.get(ATTEMPTS[0]), 1);
  } finally { await service.close(); }
});
