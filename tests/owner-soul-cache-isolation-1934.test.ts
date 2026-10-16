import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerSoulCharacterOptionsService } from "../src/application/owner-soul-character-options-service.js";
import { OwnerSoulImageGenerationService, OwnerSoulImageGenerationServiceError, type OwnerSoulImageGenerationResult } from "../src/application/owner-soul-image-generation-service.js";
import { OwnerSoulImageRequestPreparer } from "../src/application/owner-soul-image-request-preparer.js";
import { OwnerSoulStyleOptionsService } from "../src/application/owner-soul-style-options-service.js";
import { OwnerSoulCharacterCatalogHttpClient } from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";
import { OwnerSoulStyleCatalogHttpClient } from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import type { OwnerSoulGenerationParametersInput } from "../src/application/owner-soul-generation-parameters.js";

const NOW = Date.parse("2026-10-16T08:00:00.000Z");
const ATTEMPTS = ["link_soul_cache_a_000000000001", "link_soul_cache_b_000000000002"] as const;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "synthetic-soul-tenant", subject: "synthetic-mcp-binding" });
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(
  readFileSync(join(process.cwd(), "catalog/public", VERSION), "utf8"))));
const INPUT: OwnerSoulGenerationParametersInput = Object.freeze({ prompt: "Synthetic portrait for cache isolation.", quality: "720p",
  resolution: "2048x1152", batch_size: 1, enhance_prompt: false, seed: null,
  style: Object.freeze({ kind: "none" }), character: Object.freeze({ kind: "none" }) });

interface Job { readonly chat_uuid: string; readonly model_id: string; readonly batch_size: number; readonly ack_id: string; readonly bot_id: string; readonly artifact_url: string }

async function createLinkedAttempts(): Promise<{ readonly linkService: PerUserLinkService; readonly store: InMemoryAuthLinkStore }> {
  let nextAttempt = 0;
  const store = new InMemoryAuthLinkStore(() => NOW);
  const linkService = new PerUserLinkService({} as never, store, { now: () => NOW, attemptIdGenerator: () => ATTEMPTS[nextAttempt++]! });
  for (const [index, attemptId] of ATTEMPTS.entries()) {
    await linkService.createAttempt(BINDING);
    await store.beginHandoff(BINDING, attemptId);
    await store.attachChallenge(BINDING, attemptId, `synthetic-soul-upstream-${index}`);
    await store.beginPoll(BINDING, attemptId);
    await store.markLinked(BINDING, attemptId, Object.freeze({ scheme: "Bearer", value: `synthetic-soul-account-${index}` }));
  }
  const firstCredential = await store.useCredential(BINDING, ATTEMPTS[0], (credential) => credential.value);
  const secondCredential = await store.useCredential(BINDING, ATTEMPTS[1], (credential) => credential.value);
  assert.notEqual(firstCredential, secondCredential);
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[0])).status, "LINKED");
  assert.equal((await linkService.getStatus(BINDING, ATTEMPTS[1])).status, "LINKED");
  return { linkService, store };
}

test("Soul image success cache rejects another linked account but preserves its owner's cached result", async () => {
  const { linkService, store } = await createLinkedAttempts();
  const events: Array<{ actor: string; method: string; path: string }> = [], jobs = new Map<string, Job>();
  const chatClients = new Map<string, SyntxChatHttpClient>();
  let chatSequence = 0, jobSequence = 0;
  const fetchFor = (actor: string): typeof fetch => async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    events.push({ actor, method, path: url.pathname });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T08:00:00.000Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 2, discount_cost: null,
      free_remaining_generations: null, limit: 0.5, show_warning: null });
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatSequence += 1;
      const key = actor === ATTEMPTS[0] ? "a" : "b";
      return Response.json({ uuid: `soul-cache-chat-${key}-${chatSequence}` });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      jobSequence += 1;
      const input = body as { chat_uuid: string; settings: { model_type: string; batch_size: number } };
      const job: Job = { chat_uuid: input.chat_uuid, model_id: input.settings.model_type, batch_size: input.settings.batch_size,
        ack_id: `soul-cache-owner-ack-${jobSequence}`, bot_id: `soul-cache-bot-${jobSequence}`,
        artifact_url: `https://r2.syntx.ai/soul-cache1934/${actor}-${jobSequence}.png` };
      jobs.set(job.chat_uuid, job);
      return Response.json({ id: job.ack_id });
    }
    const historyMatch = /^\/api\/v1\/chats\/(soul-cache-chat-[ab]-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      const job = jobs.get(historyMatch[1]!); assert.ok(job);
      return Response.json({ messages: [
        { id: job.ack_id, chat_id: 9201, author_id: 52, message_object: [] },
        { id: job.bot_id, chat_id: 9201, author_id: -1, message_object: Array.from({ length: job.batch_size }, (_, index) => ({
          id: 9400 + index, message_id: job.bot_id, object_type: "image", model_type: job.model_id
        })) }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(soul-cache-chat-[ab]-\d+)\/(soul-cache-bot-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      const job = jobs.get(resultMatch[1]!); assert.ok(job); assert.equal(resultMatch[2], job.bot_id);
      return Response.json({ id: job.bot_id, chat_id: 9201, author_id: -1, message_object: Array.from({ length: job.batch_size }, (_, index) => ({
        id: 9400 + index, message_id: job.bot_id, object_type: "image", model_type: job.model_id,
        completed: true, object_url: job.artifact_url
      })) });
    }
    throw new Error(`Unexpected synthetic Soul request ${method} ${url.pathname} actor=${actor}`);
  };
  const brokerFor = (attemptId: string) => ({ async useCredential<T>(operation: (credential: string) => Promise<T>) {
    const credential = await store.useCredential(BINDING, attemptId, (value) => value.value);
    return operation(credential);
  } });
  for (const attemptId of ATTEMPTS) chatClients.set(attemptId,
    new SyntxChatHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl: fetchFor(attemptId), maxResponseBytes: 1024 * 1024 }));
  const readClient = (attemptId: string) => new SyntxHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl: fetchFor(attemptId) });
  const styleClients = new Map<string, OwnerSoulStyleCatalogHttpClient>(ATTEMPTS.map((attemptId) => [attemptId,
    new OwnerSoulStyleCatalogHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl: fetchFor(attemptId) })]));
  const characterClients = new Map<string, OwnerSoulCharacterCatalogHttpClient>(ATTEMPTS.map((attemptId) => [attemptId,
    new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: brokerFor(attemptId), fetchImpl: fetchFor(attemptId) })]));
  const styleOptionsService = new OwnerSoulStyleOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalogVersion: VERSION, resolveClient: (attemptId: string) => styleClients.get(attemptId)!, now: () => NOW });
  const characterOptionsService = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: VERSION, resolveClient: (attemptId: string) => characterClients.get(attemptId)!, now: () => NOW });
  const preparer = new OwnerSoulImageRequestPreparer({ binding: BINDING, linkService, styleOptionsService, characterOptionsService,
    catalog: CATALOG, catalog_version: VERSION, now: () => NOW });
  const service = new OwnerSoulImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG, catalog_version: VERSION,
    preparer, styleOptionsService, characterOptionsService, resolveChatClient: (attemptId: string) => chatClients.get(attemptId),
    createAccountStatusService: (attemptId: string) => new AccountStatusService(readClient(attemptId), () => NOW),
    createModelAccessService: (attemptId: string) => new ModelAccessService(CATALOG, readClient(attemptId), () => NOW),
    now: () => NOW, pollDelayMs: 0, maxPollAttempts: 1 });
  try {
    assert.notEqual(chatClients.get(ATTEMPTS[0]), chatClients.get(ATTEMPTS[1]));
    const resultA = await service.generate({ attemptId: ATTEMPTS[0], input: INPUT });
    assert.equal(resultA.status, "result_observed");
    assert.equal(resultA.artifacts.length, 1);
    assert.equal(events.filter((event) => event.actor === ATTEMPTS[0] && event.path === "/api/v1/design/generate").length, 1);
    assert.equal(events.filter((event) => event.actor === ATTEMPTS[1] && event.path === "/api/v1/design/generate").length, 0);

    let foreignResult: OwnerSoulImageGenerationResult | undefined, foreignError: unknown;
    try { foreignResult = await service.generate({ attemptId: ATTEMPTS[1], input: INPUT }); } catch (error) { foreignError = error; }
    assert.ok(foreignError instanceof OwnerSoulImageGenerationServiceError && foreignError.code === "INTENT_ALREADY_CLAIMED",
      foreignResult ? `attempt B received attempt A artifact_url=${foreignResult.artifacts[0]?.url}` : `unexpected error ${String(foreignError)}`);
    const claimError = foreignError as OwnerSoulImageGenerationServiceError;
    assert.equal(claimError.recovery_id, undefined);
    assert.equal(claimError.diagnostic, undefined);
    assert.equal(events.filter((event) => event.actor === ATTEMPTS[1] && event.path === "/api/v1/design/generate").length, 0);

    const ownCachedResult = await service.generate({ attemptId: ATTEMPTS[0], input: INPUT });
    assert.equal(ownCachedResult.artifacts[0]?.url, resultA.artifacts[0]?.url);
    assert.equal(events.filter((event) => event.actor === ATTEMPTS[0] && event.path === "/api/v1/design/generate").length, 1);
  } finally {
    await service.close();
    await preparer.close(); await styleOptionsService.close(); await characterOptionsService.close();
  }
});
