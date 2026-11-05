import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createOwnerExpandedT2vCurrentSeedProfile, OWNER_EXPANDED_CURRENT_SEED_MODELS, type OwnerExpandedCurrentSeedModel } from "../src/application/owner-expanded-t2v-current-seed-profile.js";
import { createOwnerExpandedT2vProfiles } from "../src/application/owner-expanded-t2v-profile.js";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { OwnerExpandedT2vGenerationService } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { registerSyntxOwnerExpandedT2vTools } from "../src/mcp/owner-expanded-t2v-tools.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
const ATTEMPT = "link_expanded_current_seed_0123456789";
const directory = resolve(process.cwd(), "catalog");
const inputs = { happy_horse_t2v: { resolution: "1080P", video_duration: 15, aspect_ratio: "3:4" },
  "text2video-4.5": { video_duration: "8.0", aspect_ratio: "916" } };
const prompt = "A source-backed synthetic seed test scene";

test("current expanded seed profiles preserve legacy registries and bind null/zero/max to exact wire values", () => {
  const legacy = createOwnerExpandedT2vProfiles(directory);
  for (const model of OWNER_EXPANDED_CURRENT_SEED_MODELS) {
    const current = createOwnerExpandedT2vCurrentSeedProfile(model, directory), executor = new GenerationContractExecutorV2(current.registry, current.catalog);
    assert.notEqual(current.registryVersion, legacy.get(model)!.registryVersion);
    assert.equal(current.source.current_controls.provider_acceptance, "UNPROVEN");
    assert.equal(current.registry.contracts[0]!.provenance.references.some(ref => ref.kind === "frontend_static" && ref.sha256 === current.source.current_controls.random_seed_sha256), true);
    for (const seed of [null, 0, 123, 2147483647]) {
      const normalized = current.normalizeGenerationInput({ attemptId: ATTEMPT, model_id: model, prompt, ...inputs[model], seed });
      const prepared = executor.prepare({ model_id: model, operation_id: "generate-video", variant_id: current.variantId,
        catalog_version: current.registry.catalog_version, parameters: normalized.parameters });
      assert.equal(prepared.settings.seed, seed);
      assert.deepEqual(prepared.settings.file_urls, []);
    }
    for (const seed of [-1, 2147483648, NaN, Infinity, 0.5, "123"]) assert.throws(() => current.normalizeGenerationInput({ attemptId: ATTEMPT, model_id: model, prompt, ...inputs[model], seed }));
    assert.throws(() => current.normalizeGenerationInput({ attemptId: ATTEMPT, model_id: model, prompt, ...inputs[model] }));
  }
});

async function fixture(model: OwnerExpandedCurrentSeedModel, seed: number | null | undefined, pending = false, duration?: number) {
  let now = Date.parse("2026-11-06T00:00:00.000Z"), dispatched = false, ready = !pending;
  const binding = { tenant_id: "expanded-current-seed", subject: "synthetic-owner" };
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "expanded-seed", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-expanded-seed" }); return { state: "LINKED" }; }
  }, new InMemoryAuthLinkStore(() => now), { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(binding); await links.issueHandoff(binding, ATTEMPT); await links.checkAttempt(binding, ATTEMPT);
  const selected = { ...inputs[model], ...(duration === undefined ? {} : { video_duration: duration }) };
  const current = createOwnerExpandedT2vCurrentSeedProfile(model, directory), legacy = createOwnerExpandedT2vProfiles(directory);
  const counts = { post: 0, quote: 0, detail: 0 };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname === "/api/v1/chats") return Response.json({ uuid: "expanded-seed-chat" });
    if (url.pathname === "/api/v1/video/generate") {
      counts.post++; dispatched = true;
      assert.equal(url.searchParams.get("ai_name"), current.aiName);
      assert.deepEqual(JSON.parse(String(init.body)), { chat_id: "expanded-seed-chat", prompt,
        settings: { file_urls: [], model_type: model, ...selected, seed: seed ?? null } });
      return Response.json({ id: "expanded-seed-echo" });
    }
    const owner = { id: "expanded-seed-echo", chat_id: 801, author_id: 17, message_object: [] };
    const bot = { id: "expanded-seed-bot", chat_id: 801, author_id: -1, message_object: [{ id: "expanded-seed-video", message_id: "expanded-seed-bot",
      object_type: "video", model_type: model, completed: true, object_url: "https://r2.syntx.ai/expanded-current/result.mp4" }] };
    if (url.pathname.endsWith("/messages")) { const messages = dispatched && ready ? [owner, bot] : [owner];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } }); }
    if (url.pathname.endsWith("/inprogress")) return Response.json(dispatched && ready ? [{ message_id: bot.id, object_type: "video", model_type: model }] : []);
    if (url.pathname.endsWith("/expanded-seed-echo")) return Response.json(owner);
    if (url.pathname.endsWith("/expanded-seed-bot")) { counts.detail++; return Response.json(bot); }
    throw new Error("Unexpected synthetic native route");
  };
  const access = (currentBranch: boolean) => async (_attempt: string, requested: string, fields: Readonly<Record<string, unknown>>): Promise<ModelAccessResult> => {
    assert.equal(requested, model); counts.quote++; now++;
    assert.deepEqual({ ...fields }, Object.fromEntries(current.costParameterFields.map(key => [key, (selected as Record<string, unknown>)[key]])));
    return { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: currentBranch ? current.registry.catalog_version : legacy.get(model)!.registry.catalog_version,
      model_id: model, ai_name: current.aiName, model_type: model, account_read_live: true, parameter_keys: Object.keys(fields).sort(), parameters_redacted: true,
      access: true, cost: null, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString() };
  };
  const service = new OwnerExpandedT2vGenerationService({ profiles: legacy, binding, linkService: links,
    currentCatalogDirectory: directory, resolveCurrentModelAccess: access(true), resolveModelAccess: access(false),
    resolveSubscription: async () => ({ active: true, plan_type: "PAID", end_date: null, end_date_kind: null }),
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: { async useCredential(use) { return use("synthetic-expanded-seed"); } }, fetchImpl }),
    now: () => now, wait: async () => { now++; }, videoTimeoutMs: pending ? 20 : 1000 });
  return { service, current, counts, ready() { ready = true; } };
}

test("actual expanded SDK drives both seeded models through current cost, sealed native POST and owned GET", async () => {
  for (const model of OWNER_EXPANDED_CURRENT_SEED_MODELS) for (const seed of [null, 0, 2147483647]) {
    const f = await fixture(model, seed), server = new McpServer({ name: "expanded-current-seed", version: "1" });
    registerSyntxOwnerExpandedT2vTools(server, { service: f.service });
    const client = new Client({ name: "expanded-current-seed", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(host); await client.connect(caller);
      const tools = await client.listTools(), tool = tools.tools.find(tool => tool.name === "syntx_owner_generate_expanded_t2v");
      assert.ok(tool?.inputSchema.properties?.seed); assert.ok(tool.inputSchema.anyOf || tool.inputSchema.oneOf);
      const result = await client.callTool({ name: "syntx_owner_generate_expanded_t2v", arguments: { link_attempt_id: ATTEMPT, model_id: model, prompt, ...inputs[model], seed } });
      assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal((result.structuredContent as { variant_id: string }).variant_id, f.current.variantId);
      assert.deepEqual(f.counts, { post: 1, quote: 2, detail: 1 });
    } finally { await client.close(); await server.close(); await f.service.close(); }
  }
});

test("seeded expanded recovery mux keeps current handles and performs GET only", async () => {
  for (const model of OWNER_EXPANDED_CURRENT_SEED_MODELS) {
    const f = await fixture(model, 123, true);
    try {
      const error = await f.service.generate({ attemptId: ATTEMPT, model_id: model, prompt, ...inputs[model], seed: 123 }).catch(error => error as { code: string; recovery_id: string });
      assert.ok("code" in error && error.code === "OUTCOME_UNKNOWN", JSON.stringify({ error, counts: f.counts })); if (!("recovery_id" in error)) throw new Error("Missing recovery");
      assert.equal(f.service.listRecoveries(model, ATTEMPT)[0]?.variant_id, f.current.variantId); f.ready();
      assert.equal((await f.service.reconcile({ attemptId: ATTEMPT, model_id: model, recovery_id: error.recovery_id })).variant_id, f.current.variantId);
      assert.equal(f.counts.post, 1);
    } finally { await f.service.close(); }
  }
});


test("HappyHorse T2V actual SDK preserves fractional manual duration without explicit seed in current native wire and quote", async () => {
  const f = await fixture("happy_horse_t2v", undefined, false, 3.375), server = new McpServer({ name: "happy-current-duration", version: "1" });
  registerSyntxOwnerExpandedT2vTools(server, { service: f.service });
  const client = new Client({ name: "happy-current-duration", version: "1" }), [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const result = await client.callTool({ name: "syntx_owner_generate_expanded_t2v", arguments: { link_attempt_id: ATTEMPT,
      model_id: "happy_horse_t2v", prompt, ...inputs.happy_horse_t2v, video_duration: 3.375 } });
    assert.equal(result.isError, undefined, JSON.stringify(result)); assert.equal((result.structuredContent as { variant_id: string }).variant_id, f.current.variantId);
    assert.deepEqual(f.counts, { post: 1, quote: 2, detail: 1 });
    for (const video_duration of [2.999, 15.001, NaN, Infinity]) assert.throws(() => f.current.normalizeGenerationInput({ attemptId: ATTEMPT,
      model_id: "happy_horse_t2v", prompt, ...inputs.happy_horse_t2v, video_duration, seed: null }));
  } finally { await client.close(); await server.close(); await f.service.close(); }
});
