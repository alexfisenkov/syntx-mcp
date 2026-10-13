import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION } from "../src/application/owner-elevenlabs-generation-parameters.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { OwnerElevenLabsDialogueRequestPreparer } from "../src/application/owner-elevenlabs-dialogue-request-preparer.js";
import { OwnerElevenLabsDialogueOneShotPolicy } from "../src/application/owner-elevenlabs-dialogue-one-shot-policy.js";
import { OwnerElevenLabsDialogueGenerationService } from "../src/application/owner-elevenlabs-dialogue-generation-service.js";
import { registerSyntxOwnerElevenLabsDialogueTools, SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES } from "../src/mcp/owner-elevenlabs-dialogue-tools.js";
import { decodeOwnerElevenLabsDialogueHistory, decodeOwnerElevenLabsDialogueResult } from "../src/application/owner-elevenlabs-dialogue-history-result-codec.js";

const ATTEMPT = "link_elevenlabs_dialogue_policy_0123456789";
const BINDING = Object.freeze({ tenant_id: "elevenlabs-dialogue-policy-tenant", subject: "elevenlabs-dialogue-policy-owner" });
const HASH = `sha256:${"a".repeat(64)}`;
const stores = new Set<InMemoryAuthLinkStore>();
afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

async function policyFixture() {
  let now = Date.parse("2026-10-14T01:00:00.000Z");
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-dialogue-policy", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "dialogue-policy-synthetic-credential" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => now); stores.add(store);
  const links = new PerUserLinkService(provider, store, { now: () => now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); assert.equal((await links.checkAttempt(BINDING, ATTEMPT)).status, "LINKED");
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return links.useCredential(BINDING, ATTEMPT, (credential) => operation(credential.value)); } };
  const http = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => Response.json([
    { voice_id: "dialogue_voice_private_A", name: "A" }, { voice_id: "dialogue_voice_private_B", name: "B" }
  ]) });
  const voices = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService: links, resolveClient: () => http, now: () => now });
  const listing = await voices.listVoices({ attemptId: ATTEMPT });
  const refs = listing.voices.map((voice) => voice.voice_ref);
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
  const preparer = new OwnerElevenLabsDialogueRequestPreparer({ voiceReferenceService: voices, now: () => now });
  const policy = new OwnerElevenLabsDialogueOneShotPolicy({ preparer, now: () => now });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal, request: { model_id: "eleven_v4", mode: "text_to_dialogue",
    prompt: "", inputs: [{ name: "A", text: "First line", voice_ref: refs[0] }, { name: "B", text: "Second line", voice_ref: refs[1] }],
    stability: 0.35, similarity_boost: 0.65, language_code: "auto" } });
  return { now: () => now, principal, candidate, preparer, policy, linkService: links, voiceService: voices, broker, async close() {
    policy.close(); preparer.close(); await voices.close(); } };
}

test("dialogue one-shot permit is candidate-bound, revalidated and consumable only once", async () => {
  const f = await policyFixture();
  try {
    const context = { candidate: f.candidate, attemptId: ATTEMPT, principal: f.principal };
    const permit = f.policy.createPermit(context);
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.equal(f.policy.revalidate({ ...context, permit }).status, "revalidated");
    const consumed = f.policy.consume({ ...context, permit });
    assert.equal(consumed.status, "consumed");
    assert.equal(consumed.private_request?.prompt, "");
    assert.equal(consumed.private_request?.settings.mode, "text_to_dialogue");
    assert.equal(consumed.private_request?.settings.chars_count, 21);
    assert.deepEqual(consumed.private_request?.settings.inputs?.map((line) => line.name), ["A", "B"]);
    assert.equal(JSON.stringify(permit).includes("dialogue_voice_private"), false);
    assert.throws(() => f.policy.consume({ ...context, permit }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.throws(() => f.policy.createPermit(context), (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
  } finally { await f.close(); }
});

function context(): Readonly<Record<string, unknown>> {
  return Object.freeze({ chat_uuid: "dialogue-chat-1", message_id: "dialogue-bot-msg-1", model_id: "eleven_v4",
    provider_chat_id: "9001", message_object_ids: Object.freeze(["dialogue-audio-1"]), owner_echo_message_id: "dialogue-owner-ack-1",
    attempt_id: ATTEMPT, principal: Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT }),
    voice_epoch: 1, intent_fingerprint: HASH, profile_schema_hash: HASH, source_profile_schema_hash: HASH });
}
function history(overrides: Record<string, unknown> = {}) {
  return Object.freeze({ status: "COMPLETE", owner_ack_status: "MATCHED", history_binding_status: "BOUND", history_page_status: "COMPLETE",
    history_get_calls: 1, provider_chat_id: "9001", owner_echo_message_id: "dialogue-owner-ack-1", contexts: Object.freeze([context()]),
    gaps: Object.freeze([]), backend_acceptance: "UNPROVEN", ...overrides });
}
function expected() {
  return Object.freeze({ chat_uuid: "dialogue-chat-1", attempt_id: ATTEMPT,
    principal: Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT }), model_id: "eleven_v4",
    owner_echo_message_id: "dialogue-owner-ack-1", voice_epoch: 1, intent_fingerprint: HASH,
    profile_schema_hash: HASH, source_profile_schema_hash: HASH });
}

test("history codec binds only the exact owned ACK, chat, model and frozen native result context", () => {
  const raw = history();
  const decoded = decodeOwnerElevenLabsDialogueHistory(raw, expected());
  assert.equal(decoded.availability, "BOUND");
  assert.equal(decoded.owner_ack_status, "MATCHED");
  assert.equal(decoded.contexts[0], (raw.contexts as readonly unknown[])[0], "native result-context identity is retained for the GET-only reader");
  const unknownAck = decodeOwnerElevenLabsDialogueHistory(history({ owner_ack_status: "UNKNOWN" }), expected());
  assert.equal(unknownAck.availability, "UNVERIFIED");
  assert.equal(unknownAck.contexts.length, 0);
  const wrongChat = decodeOwnerElevenLabsDialogueHistory(history({ contexts: Object.freeze([Object.freeze({ ...context(), chat_uuid: "other-chat" })]) }), expected());
  assert.equal(wrongChat.availability, "UNVERIFIED");
});

test("dialogue result codec returns observed URLs without provider terminal status or inferred MIME", () => {
  const decoded = decodeOwnerElevenLabsDialogueResult(Object.freeze({ message_binding: "BOUND", model_echo: "UNKNOWN",
    objects: Object.freeze([{ object_index: 0, message_object_id: "dialogue-audio-1", object_type: "audio",
      object_url: "https://r2.syntx.ai/audio/dialogue.mp3" }]), gaps: Object.freeze([]), backend_acceptance: "UNPROVEN" }), context());
  assert.equal(decoded.availability, "OBSERVED");
  assert.equal(decoded.artifacts[0]?.mime_type, null);
  assert.equal(decoded.artifacts[0]?.mime_source, "UNKNOWN");
  assert.equal(decoded.provider_terminal_status, "UNPROVEN");
  const unsafe = decodeOwnerElevenLabsDialogueResult(Object.freeze({ message_binding: "BOUND", model_echo: "MATCHED",
    objects: Object.freeze([{ object_index: 0, message_object_id: "dialogue-audio-1", object_type: "audio", object_url: "https://example.com/audio.mp3" }]),
    gaps: Object.freeze([]), backend_acceptance: "UNPROVEN" }), context());
  assert.equal(unsafe.availability, "UNVERIFIED");
  assert.equal(unsafe.artifacts.length, 0);
});

test("Stock MCP SDK exposes five dialogue tools and source contract without issuing generation calls", async () => {
  const f = await policyFixture();
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION));
  const noNetwork: typeof fetch = async () => { throw new Error("unexpected provider access in source and listing tools"); };
  const service = new OwnerElevenLabsDialogueGenerationService({ binding: BINDING, linkService: f.linkService,
    catalog, catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, voiceReferenceService: f.voiceService,
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: f.broker, fetchImpl: noNetwork }),
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: f.broker, fetchImpl: noNetwork })),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: f.broker, fetchImpl: noNetwork })),
    now: f.now });
  const server = new McpServer({ name: "elevenlabs-dialogue-service-test", version: "1.0.0" });
  registerSyntxOwnerElevenLabsDialogueTools(server, service);
  const client = new Client({ name: "elevenlabs-dialogue-stock-sdk-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(({ name }) => name), SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES);
    const source = await client.callTool({ name: SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[0], arguments: {} });
    assert.equal(source.isError, undefined);
    const output = source.structuredContent as { source_binding: { build_id: string }; sender: { prompt: string } };
    assert.equal(output.source_binding.build_id, "1791904852");
    assert.equal(output.sender.prompt, "EXPLICIT_COMMON_PROMPT_PASSED_THROUGH_UNCHANGED");
    const recoveries = await client.callTool({ name: SYNTX_OWNER_ELEVENLABS_DIALOGUE_TOOL_NAMES[3],
      arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(recoveries.isError, undefined);
    assert.deepEqual((recoveries.structuredContent as { recoveries: unknown[] }).recoveries, []);
  } finally { await Promise.all([client.close(), server.close()]); await service.close(); await f.close(); }
});

test("dialogue generation validates the complete native chat context and reconciles one POST through GET-only native reads", async () => {
  const f = await policyFixture();
  const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION));
  const counts = { account: 0, access: 0, chats: 0, generation: 0, history: 0, result: 0 };
  const events: Array<{ method: string; pathname: string; body?: unknown }> = [];
  const chatUuid = "elevenlabs-dialogue-service-native-chat-1";
  const ackId = "elevenlabs-dialogue-service-owner-ack-1";
  const botMessageId = "elevenlabs-dialogue-service-bot-message-1";
  const objectId = "elevenlabs-dialogue-service-audio-object-1";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    events.push({ method, pathname: url.pathname, ...(body === undefined ? {} : { body }) });
    if (method === "GET" && url.pathname === "/api/v1/user/balance") {
      counts.account += 1; return Response.json({ balance: "1000" });
    }
    if (method === "GET" && url.pathname === "/api/v1/user/subscription") {
      counts.account += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-15T00:00:00.000Z" });
    }
    if (method === "GET" && url.pathname === "/api/v2/get_model_info") {
      counts.access += 1; return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null,
        limit: null, show_warning: null });
    }
    if (method === "POST" && url.pathname === "/api/v1/chats") {
      counts.chats += 1; return Response.json({ uuid: chatUuid });
    }
    if (method === "POST" && url.pathname === "/api/v1/audio/generate") {
      counts.generation += 1; return Response.json({ id: ackId });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (method === "GET" && history) {
      assert.equal(history[1], chatUuid); counts.history += 1;
      const owner = { id: ackId, chat_id: 9001, author_id: 41,
        message_object: [{ id: `${ackId}-text`, message_id: ackId, object_type: "text", object_text: "deliberately not matched to prompt" }] };
      const bot = { id: botMessageId, chat_id: 9001, author_id: -1,
        message_object: [{ id: objectId, message_id: botMessageId, object_type: "audio", model_type: "eleven_v4" }] };
      // First read observes only the owned ACK; second read observes the bot result. Both are synthetic GETs.
      const messages = counts.history === 1 ? [owner] : [owner, bot];
      const pageNo = Number(url.searchParams.get("page"));
      const totalPages = Math.ceil(messages.length / 10);
      const pageRows = messages.slice((pageNo - 1) * 10, pageNo * 10);
      return Response.json({ messages: pageRows, pagination: { page: pageNo, page_size: 10, total_count: messages.length,
        total_pages: totalPages, has_next: pageNo < totalPages, has_previous: pageNo > 1 } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (method === "GET" && result) {
      counts.result += 1; assert.equal(result[1], chatUuid); assert.equal(result[2], botMessageId);
      return Response.json({ id: botMessageId, chat_id: 9001, author_id: -1,
        message_object: [{ id: objectId, message_id: botMessageId, object_type: "audio",
          object_url: "https://r2.syntx.ai/generated/elevenlabs-dialogue-service-test.mp3", completed: true, model_type: "eleven_v4" }] });
    }
    throw new Error(`Unexpected synthetic dialogue request: ${method} ${url.pathname}`);
  };
  const nativeClient = new SyntxChatHttpClient({ credentialBroker: f.broker, fetchImpl, maxResponseBytes: 2 * 1024 * 1024 });
  const service = new OwnerElevenLabsDialogueGenerationService({ binding: BINDING, linkService: f.linkService, catalog,
    catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, voiceReferenceService: f.voiceService,
    resolveChatClient: () => nativeClient,
    createAccountStatusService: () => new AccountStatusService(new SyntxHttpClient({ credentialBroker: f.broker, fetchImpl }), f.now),
    createModelAccessService: () => new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker: f.broker, fetchImpl }), f.now),
    now: f.now });
  try {
    const listing = await f.voiceService.listVoices({ attemptId: ATTEMPT });
    const voiceRefs = listing.voices.slice(0, 2).map((voice) => voice.voice_ref);
    let recoveryId: string | undefined;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, request: { model_id: "eleven_v4", mode: "text_to_dialogue",
      prompt: "Keep this outer prompt separate.", inputs: [
        { name: "A", text: "First line", voice_ref: voiceRefs[0] },
        { name: "B", text: "Second line", voice_ref: voiceRefs[1] }
      ], stability: 0.35, similarity_boost: 0.65, language_code: "auto" } }), (error: unknown) => {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" || !("recovery_id" in error) ||
          typeof error.recovery_id !== "string") return false;
      recoveryId = error.recovery_id; return true;
    });
    assert.ok(recoveryId);
    assert.equal(counts.generation, 1);
    const post = events.find((event) => event.pathname === "/api/v1/audio/generate");
    assert.ok(post);
    const sent = post.body as { chat_uuid: string; prompt: string; settings: { mode: string; model_type: string;
      chars_count: number; inputs: readonly { name: string; text: string; voice_id: string }[] } };
    assert.deepEqual(Object.keys(sent).sort(), ["chat_uuid", "prompt", "settings"]);
    assert.equal(sent.chat_uuid, chatUuid);
    assert.equal(sent.prompt, "Keep this outer prompt separate.");
    assert.equal(sent.settings.mode, "text_to_dialogue");
    assert.equal(sent.settings.model_type, "eleven_v4");
    assert.equal(sent.settings.chars_count, 21);
    assert.deepEqual(sent.settings.inputs.map(({ name, text }) => [name, text]), [["A", "First line"], ["B", "Second line"]]);
    assert.deepEqual(sent.settings.inputs.map(({ voice_id }) => voice_id), ["dialogue_voice_private_A", "dialogue_voice_private_B"]);

    const reconciled = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(reconciled.status, "observed_results");
    assert.equal(reconciled.artifacts.length, 1);
    assert.equal(reconciled.artifacts[0]?.mime_type, null);
    assert.equal(reconciled.provider_terminal_status, "UNPROVEN");
    const afterReconcile = { ...counts };
    const page = await service.getResultPage({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(page.artifacts[0]?.url, "https://r2.syntx.ai/generated/elevenlabs-dialogue-service-test.mp3");
    assert.deepEqual(counts, afterReconcile, "result page reads remain memory-only");
    assert.equal(counts.chats, 1); assert.equal(counts.generation, 1);
    assert.equal(counts.history, 2); assert.equal(counts.result, 1);
    assert.equal(counts.account, 4); assert.equal(counts.access, 2);
  } finally { await service.close(); await f.close(); }
});
