import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SyntxHttpClient } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { OwnerElevenLabsVoiceDiscoveryCursors, normalizeOwnerElevenLabsVoiceDiscovery } from "../src/application/owner-elevenlabs-voice-discovery.js";
import { registerSyntxOwnerElevenLabsVoiceTools } from "../src/mcp/owner-elevenlabs-voice-tools.js";

const attempt = "link_elevenlabs_discovery_owner_0123456789";
const binding = { tenant_id: "discovery-tenant", subject: "discovery-owner" };
const principal = Object.freeze({ tenant_id: binding.tenant_id, subject_id: binding.subject, connection_id: attempt });
test("ElevenLabs discovery cursor binds owner/attempt/epoch/query and expires without exposing query", () => {
  const cursors = new OwnerElevenLabsVoiceDiscoveryCursors(), query = { page: 1, page_size: 20 as const, search: "specific voice", gender: "female" };
  const id = cursors.next(query, 45, principal, 0, 1000)!;
  assert.match(id, /^owner_elevenlabs_cursor_/u); assert.equal(id.includes("specific"), false);
  assert.deepEqual(cursors.resolve(id, principal, 0, 1001), { ...query, page: 2 });
  assert.equal(cursors.resolve(id, { ...principal, subject_id: "foreign-owner" }, 0, 1001), undefined);
  assert.equal(cursors.resolve(id, { ...principal, connection_id: "link_foreign_attempt_012345678901" }, 0, 1001), undefined);
  assert.equal(cursors.resolve(id, principal, 1, 1001), undefined);
  assert.equal(cursors.resolve(id, principal, 0, 901001), undefined);
});
test("ElevenLabs discovery preserves legacy request and rejects cursor/filter mixing, arbitrary page and malformed strings", () => {
  assert.deepEqual(normalizeOwnerElevenLabsVoiceDiscovery({}), { page: 1, page_size: 10 });
  assert.deepEqual(normalizeOwnerElevenLabsVoiceDiscovery({ page_size: 20, search: "" }), { page: 1, page_size: 20 });
  for (const fields of [{ page: 2 }, { page_size: 100 }, { cursor: "forged" }, { search: "bad\u0000search" },
    { cursor: "owner_elevenlabs_cursor_00000000-0000-4000-8000-000000000000", search: "changed" }]) assert.throws(() => normalizeOwnerElevenLabsVoiceDiscovery(fields));
});
test("ElevenLabs SDK explicitly follows three filtered pages with opaque expiring references and no automatic crawl", async () => {
  let now = 1_000_000, reads = 0;
  const store = new InMemoryAuthLinkStore(() => now);
  const links = new PerUserLinkService({ authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-discovery", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-discovery-only" }); return { state: "LINKED" }; }
  }, store, { now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attempt });
  await links.createAttempt(binding); await links.issueHandoff(binding, attempt); await links.checkAttempt(binding, attempt);
  const filters = { search: "Ирина & calm", gender: "female", age: "adult", use_case: "narration", accent: "neutral", language: "ru", sort_by: "name", sort_direction: "asc" };
  const native = new SyntxHttpClient({ credentialBroker: { async useCredential(operation) { return await operation("synthetic-discovery-only"); } },
    fetchImpl: async (input) => {
      reads++; const url = new URL(String(input)); assert.equal(url.pathname, "/api/v1/audio/elevenlabs/voice_examples");
      assert.equal(url.searchParams.get("page_size"), "20"); for (const [key, value] of Object.entries(filters)) assert.equal(url.searchParams.get(key), value);
      const page = Number(url.searchParams.get("page")), count = page < 3 ? 20 : 5;
      return new Response(JSON.stringify({ page, total: 45, facets: { gender: ["female"], language: [{ value: "ru", private: "discard" }], private: "not-for-output" },
        results: Array.from({ length: count }, (_, i) => ({ voice_id: `synthetic_voice_${(page - 1) * 20 + i}`, name: `Voice ${(page - 1) * 20 + i}`,
          preview_uri: "https://signed.invalid/private", private_description: "x".repeat(5000) })) }), { headers: { "Content-Type": "application/json" } });
    } });
  const service = new OwnerElevenLabsVoiceReferenceService({ binding, linkService: links, resolveClient: () => native, now: () => now });
  const server = new McpServer({ name: "voice-discovery", version: "1" }); registerSyntxOwnerElevenLabsVoiceTools(server, service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "voice-discovery", version: "1" });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const list = async (args: Record<string, unknown>) => await client.callTool({ name: "syntx_owner_list_elevenlabs_voice_references", arguments: { link_attempt_id: attempt, ...args } });
    const firstResponse = await list({ page_size: 20, ...filters }); assert.notEqual(firstResponse.isError, true);
    const first = firstResponse.structuredContent as Record<string, any>; assert.equal(first.page, 1); assert.equal(first.voices.length, 20); assert.equal(reads, 1);
    assert.equal(first.coverage, "PARTIAL_PAGE_ONLY"); assert.ok(first.next_cursor);
    assert.deepEqual(first.filter_options, { gender: ["female"], language: ["ru"] });
    assert.equal(JSON.stringify(first).includes("synthetic_voice_"), false); assert.equal(JSON.stringify(first).includes("signed.invalid"), false);
    assert.equal((await list({ cursor: "owner_elevenlabs_cursor_00000000-0000-4000-8000-000000000000" })).isError, true); assert.equal(reads, 1);
    assert.equal((await list({ cursor: first.next_cursor, search: "changed" })).isError, true); assert.equal(reads, 1);
    const second = (await list({ cursor: first.next_cursor })).structuredContent as Record<string, any>;
    assert.equal(second.page, 2); assert.equal(reads, 2); assert.ok(second.next_cursor);
    const third = (await list({ cursor: second.next_cursor })).structuredContent as Record<string, any>;
    assert.equal(third.page, 3); assert.equal(third.voices.length, 5); assert.equal(third.next_cursor, null); assert.equal(third.has_more, false); assert.equal(reads, 3);
    const selected = await service.resolveVoice({ attemptId: attempt, voice_ref: third.voices[4].voice_ref }); assert.equal(selected.voice_id, "synthetic_voice_44");
    now += 900001; assert.equal((await list({ cursor: first.next_cursor })).isError, true); assert.equal(reads, 3);
    await assert.rejects(service.resolveVoice({ attemptId: attempt, voice_ref: third.voices[4].voice_ref }));
  } finally { await client.close(); await server.close(); await service.close(); store.close(); }
});
