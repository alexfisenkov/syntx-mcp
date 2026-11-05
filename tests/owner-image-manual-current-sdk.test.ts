import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { schemaHash } from "../src/domain/generation-contract.js";
import { getOwnerClarityUpscaleSourceProfile } from "../src/application/owner-clarity-upscale-request-preparer.js";
import { getOwnerMagnificUpscaleSourceProfile } from "../src/application/owner-magnific-upscale-request-preparer.js";
import { getOwnerImageManualCurrentControls, ownerImageManualCurrentProfileHash } from "../src/application/owner-image-manual-current-controls.js";

const ATTEMPT = "link_image_manual_current_0123456789";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
let serial = 0;
async function fixture() {
  const now = Date.now(), binding = { tenant_id: "current-image-manual", subject: `synthetic-owner-${++serial}` }, store = new InMemoryAuthLinkStore(() => now);
  const linker = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-manual", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-image-manual" }); return { state: "LINKED" }; }
  }, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await linker.createAttempt(binding); await linker.issueHandoff(binding, ATTEMPT); await linker.checkAttempt(binding, ATTEMPT);
  const counts = { quotes: 0, balances: 0, subscriptions: 0, uploads: 0, chats: 0, posts: 0, history: 0, details: 0 };
  const quotes: Array<Record<string, string>> = [], posted: Array<{ chat_uuid: string; settings: Record<string, unknown>; prompt?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname.endsWith("user/balance")) { counts.balances++; return Response.json({ balance: "1000" }); }
    if (url.pathname.endsWith("user/subscription")) { counts.subscriptions++; return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00Z" }); }
    if (url.pathname.endsWith("get_model_info")) { counts.quotes++; quotes.push(Object.fromEntries(url.searchParams));
      return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false }); }
    if (url.pathname.endsWith("hf/lora/styles")) return Response.json({ items: [{ style_id: "owned-style-source-id", name: "Synthetic Style", image: "https://images.invalid/style.png" }], total: 1 });
    if (url.pathname.endsWith("chats/upload-files")) { counts.uploads++; const file = (init.body as FormData).get("files"); assert.ok(file instanceof File);
      return Response.json({ files: [{ url: "https://r2.syntx.ai/current-manual/owned-input.png", mime_type: file.type, filename: file.name, size: file.size, status: "success" }] }); }
    if (url.pathname === "/api/v1/chats") { counts.chats++; return Response.json({ uuid: `manual-chat-${counts.chats}` }); }
    if (url.pathname.endsWith("design/generate")) { counts.posts++; posted.push(JSON.parse(String(init.body)) as typeof posted[number]); return Response.json({ id: "manual-owner" }); }
    const op = posted.at(-1), model = op?.settings.model_type;
    const owner = { id: "manual-owner", chat_id: 997, author_id: 42,
      message_object: model === "clarity" ? [{ id: "manual-input", message_id: "manual-owner", object_type: "image", model_type: null }] : [] };
    const bot = { id: "manual-bot", chat_id: 997, author_id: -1, message_object: [{ id: "manual-output", message_id: "manual-bot", object_type: "image", model_type: model }] };
    if (url.pathname.endsWith("/messages")) { counts.history++; return Response.json({ messages: [owner, bot],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } }); }
    if (url.pathname.endsWith("/inprogress")) return Response.json([]);
    if (url.pathname.endsWith("/manual-owner")) return Response.json(owner);
    if (url.pathname.endsWith("/manual-bot")) { counts.details++; return Response.json({ ...bot, message_object: [{ ...bot.message_object[0], completed: true,
      object_url: "https://r2.syntx.ai/current-manual/result.png" }] }); }
    throw new Error("Unexpected synthetic native route");
  };
  const runtime = createObservedOwnerRuntime({ authStore: store, authBinding: binding, now: () => now, fetchImpl,
    ownerClarityUpscaleEnabled: true, ownerMagnificUpscaleEnabled: true, ownerSoulImageReferencesEnabled: true });
  const server = createMcpServer(runtime.application, runtime.serverOptions), client = new Client({ name: "current-image-manual", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair(); await server.connect(host); await client.connect(caller);
  return { client, counts, posted, quotes, async close() { await client.close(); await server.close();
    await runtime.serverOptions.ownerClarityUpscale?.generationService.close(); await runtime.serverOptions.ownerMagnificUpscale?.generationService.close();
    await runtime.serverOptions.ownerSoulImageReferences?.generationService.close(); store.close(); } };
}
function success(value: Awaited<ReturnType<Client["callTool"]>>) { assert.equal(value.isError, undefined, JSON.stringify(value)); return value.structuredContent as Record<string, unknown>; }

test("Current image manual overlays preserve historical lattice hashes and expose bounded readonly source getters", async () => {
  const clarityHash = schemaHash(getOwnerClarityUpscaleSourceProfile()), magnHash = getOwnerMagnificUpscaleSourceProfile("creative").profile_schema_hash;
  assert.equal(ownerImageManualCurrentProfileHash("clarity", clarityHash, { strength: 0.5, cfg: 4, denoise: 0.3 }), clarityHash);
  assert.notEqual(ownerImageManualCurrentProfileHash("clarity", clarityHash, { strength: 0.375, cfg: 4.375, denoise: 0.375 }), clarityHash);
  assert.equal(ownerImageManualCurrentProfileHash("magnific", magnHash, { creativity: 0, hdr: 0, resemblance: 0, fractality: 0, sharpen: 0, smart_grain: 0, ultra_detail: 0 }), magnHash);
  assert.equal(ownerImageManualCurrentProfileHash("soul", "legacy", { style: { kind: "selected", strength: 0.7 } }), "legacy");
  assert.notEqual(ownerImageManualCurrentProfileHash("soul", "legacy", { style: { kind: "selected", strength: 0.375 } }), "legacy");
  const f = await fixture(); try {
    const listed = (await f.client.listTools()).tools;
    const claritySchema = listed.find(tool => tool.name === "syntx_owner_generate_clarity_upscale_image")!.inputSchema;
    const magnificSchema = listed.find(tool => tool.name === "syntx_owner_generate_magnific_upscale_image")!.inputSchema;
    for (const [schema, fields] of [[claritySchema, ["strength", "cfg", "denoise"]], [magnificSchema,
      ["creativity", "hdr", "resemblance", "fractality", "sharpen", "smart_grain", "ultra_detail"]]] as const) {
      const parameters = schema.properties!.parameters as { properties: Record<string, { type: string }> };
      for (const field of fields) assert.equal(parameters.properties[field]!.type, "number");
    }
    const soulStyle = listed.find(tool => tool.name === "syntx_owner_generate_soul_image")!.inputSchema.properties!.style as {
      anyOf?: Array<{ properties?: { strength?: { type: string } } }>;
      oneOf?: Array<{ properties?: { strength?: { type: string } } }>;
    };
    assert.equal((soulStyle.anyOf ?? soulStyle.oneOf)!.find(branch => branch.properties?.strength)!.properties!.strength!.type, "number");
    for (const family of ["clarity", "magnific", "soul"] as const) {
      const value = success(await f.client.callTool({ name: `syntx_owner_get_${family}_current_manual_source`, arguments: {} }));
      assert.deepEqual(value.source, getOwnerImageManualCurrentControls(family));
    }
    assert.deepEqual(f.counts, { quotes: 0, balances: 0, subscriptions: 0, uploads: 0, chats: 0, posts: 0, history: 0, details: 0 });
  } finally { await f.close(); }
});

test("Current Clarity actual SDK preserves all three manual fractions through two fresh pricing gates native POST and owned GET", async () => {
  const f = await fixture(); try {
    const receipt = success(await f.client.callTool({ name: "syntx_upload_clarity_upscale_image", arguments: { link_attempt_id: ATTEMPT, content_base64: PNG, filename: "input.png", mime_type: "image/png" } }));
    const parameters = { professional_mode: false, scale_factor: 2, strength: 0.375, cfg: 4.375, denoise: 0.375 };
    const args = { link_attempt_id: ATTEMPT, image_handle: receipt.image_handle, prompt: "Synthetic current clarity", parameters };
    const before = { ...f.counts };
    assert.equal((await f.client.callTool({ name: "syntx_owner_generate_clarity_upscale_image", arguments: { ...args, parameters: { ...parameters, cfg: 9.001 } } })).isError, true);
    assert.deepEqual(f.counts, before);
    const result = success(await f.client.callTool({ name: "syntx_owner_generate_clarity_upscale_image", arguments: args }));
    assert.equal(result.status, "result_observed"); assert.equal(f.counts.quotes, 2); assert.equal(f.counts.balances, 2); assert.equal(f.counts.posts, 1);
    for (const field of ["strength", "cfg", "denoise"] as const) assert.equal(f.posted[0]!.settings[field], parameters[field]);
    assert.notEqual(result.profile_schema_hash, schemaHash(getOwnerClarityUpscaleSourceProfile()));
  } finally { await f.close(); }
});

test("Current Magnific actual SDK preserves seven manual fractions in all three source branches through two gates native POST and GET", async () => {
  for (const variant of ["creative", "precision_v1", "precision_v2"] as const) {
    const f = await fixture(); try {
      const receipt = success(await f.client.callTool({ name: "syntx_upload_magnific_upscale_image", arguments: { link_attempt_id: ATTEMPT, variant, content_base64: PNG, filename: "input.png", mime_type: "image/png" } }));
      const parameters = { scale_factor: "2x", optimized_for: "films_n_photography", engine: "magnific_sparkle", creativity: 2.375, hdr: -3.375,
        resemblance: 4.375, fractality: 1.375, sharpen: 37.375, smart_grain: 28.375, ultra_detail: 61.375, flavor: "sublime" };
      const args = { link_attempt_id: ATTEMPT, variant, image_handle: receipt.image_handle, parameters };
      const before = { ...f.counts };
      assert.equal((await f.client.callTool({ name: "syntx_owner_generate_magnific_upscale_image", arguments: { ...args, parameters: { ...parameters, hdr: -10.001 } } })).isError, true); assert.deepEqual(f.counts, before);
      const result = success(await f.client.callTool({ name: "syntx_owner_generate_magnific_upscale_image", arguments: args }));
      assert.equal(result.status, "result_observed"); assert.equal(f.counts.quotes, 2); assert.equal(f.counts.posts, 1);
      for (const field of ["creativity", "hdr", "resemblance", "fractality", "sharpen", "smart_grain", "ultra_detail"] as const) assert.equal(f.posted[0]!.settings[field], parameters[field]);
      assert.notEqual(result.profile_schema_hash, getOwnerMagnificUpscaleSourceProfile(variant).profile_schema_hash);
    } finally { await f.close(); }
  }
});

test("Current Soul actual SDK preserves selected style manual fraction through two fresh account gates native POST and owned GET", async () => {
  const f = await fixture(); try {
    const styles = success(await f.client.callTool({ name: "syntx_list_owner_soul_style_options", arguments: { link_attempt_id: ATTEMPT } }));
    const options = styles.options as Array<{ style_handle: string }>;
    const args = { link_attempt_id: ATTEMPT, prompt: "Synthetic current style", quality: "720p", resolution: "2048x1152", batch_size: 1, enhance_prompt: true,
      seed: null, style: { kind: "selected", style_handle: options[0]!.style_handle, strength: 0.375 }, character: { kind: "none" } };
    const before = { ...f.counts };
    assert.equal((await f.client.callTool({ name: "syntx_owner_generate_soul_image", arguments: { ...args, style: { ...args.style, strength: 1.001 } } })).isError, true); assert.deepEqual(f.counts, before);
    const result = success(await f.client.callTool({ name: "syntx_owner_generate_soul_image", arguments: args }));
    assert.equal(result.status, "result_observed"); assert.equal(f.counts.quotes, 2); assert.equal(f.counts.posts, 1); assert.equal(f.counts.balances, 2);
    assert.equal(f.posted[0]!.settings.style_strength, 0.375); assert.equal(Object.hasOwn(f.posted[0]!.settings, "reference_strength"), false);
  } finally { await f.close(); }
});
