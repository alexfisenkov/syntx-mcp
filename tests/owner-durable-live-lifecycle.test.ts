import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { openPrivateOwnerAuthProfile } from "../src/auth/private-owner-auth-profile.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerDurableLiveGenerationService } from "../src/application/owner-durable-live-generation-service.js";
import { createOwnerDurableLiveContextFactory } from "../src/runtime/owner-durable-live-context-factory.js";
import { createOwnerDurableSessionManager } from "../src/runtime/owner-durable-session-manager.js";
import { registerSyntxOwnerDurableGenerationTools, SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME, SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME } from "../src/mcp/owner-durable-live-generation-tools.js";

const ATTEMPT_ID = "link_owner_durable_live_lifecycle01";
const REGISTRY_VERSION = "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json";
const SELECTION = { model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square" } as const;

function readSafeToolError(result: unknown): { error: { code: string; job_id?: string } } {
  const response = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  assert.equal(response.isError, true);
  const text = response.content?.find((item) => item.type === "text");
  if (!text || typeof text.text !== "string") throw new Error("Expected safe tool error text.");
  return JSON.parse(text.text) as { error: { code: string; job_id?: string } };
}

test("explicit live tool starts once, then a fresh manager lifetime reads the same journal without a current registry", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-live-lifecycle-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "profile");
  const keyFilePath = join(root, "account.key");
  mkdirSync(profileDirectory, { mode: 0o700 }); chmodSync(profileDirectory, 0o700);
  writeFileSync(keyFilePath, Buffer.alloc(32, 31), { mode: 0o600 }); chmodSync(keyFilePath, 0o600);
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const counters = { generationPosts: 0, chatCreates: 0, messageReads: 0, modelReads: 0, subscriptionReads: 0 };
  let accountAccess: boolean | null = true;
  let subscriptionActive: boolean | null = true;
  let loseNextGenerationReceipt = false;
  let subscriptionResponseCancelled = false;
  let nextSubscriptionGate: { readonly signalStarted: () => void; readonly wait: Promise<void> } | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    let body: unknown;
    if (url.pathname.endsWith("/user/subscription")) {
      counters.subscriptionReads += 1;
      const gate = nextSubscriptionGate;
      if (gate !== null) { nextSubscriptionGate = null; gate.signalStarted(); await gate.wait; }
      body = { active: subscriptionActive, type: "PRO" };
      if (gate !== null) return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); },
        cancel() { subscriptionResponseCancelled = true; }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    else if (url.pathname.endsWith("/get_model_info")) { counters.modelReads += 1; body = { access: accountAccess, cost: null, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }; }
    else if (url.pathname.endsWith("/chats") && method === "POST") {
      counters.chatCreates += 1;
      body = { uuid: `chat_durable_test_${counters.chatCreates}` };
    }
    else if (url.pathname.endsWith("/design/generate") && method === "POST") {
      counters.generationPosts += 1;
      if (loseNextGenerationReceipt) { loseNextGenerationReceipt = false; throw new Error("SIMULATED_PRIVATE_UPSTREAM_FAILURE"); }
      body = { id: `message_durable_test_${counters.generationPosts}` };
    }
    else if (/^\/api\/v1\/chats\/chat_durable_test_\d+\/messages$/u.test(url.pathname) && method === "GET") {
      const chatUuid = url.pathname.split("/")[4]!;
      const receiptId = `message_durable_test_${chatUuid.slice("chat_durable_test_".length)}`;
      body = {
        messages: [
          { id: receiptId, chat_id: 77001, author_id: 139413708, message_object: [
            { id: `object_${receiptId}`, message_id: receiptId, type: "text", object_type: "text", model_type: "banana-2.1" }
          ] },
          { id: `bot_${receiptId}`, chat_id: 77001, author_id: -1, message_object: [
            { id: `object_bot_${receiptId}`, message_id: `bot_${receiptId}`, type: "image", object_type: "image", model_type: "banana-2.1" }
          ] }
        ],
        pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
      };
    }
    else if (/^\/api\/v1\/chats\/chat_durable_test_\d+\/[^/]+$/u.test(url.pathname) && method === "GET") {
      counters.messageReads += 1;
      const messageId = url.pathname.split("/")[5]!;
      body = messageId.startsWith("bot_")
        ? { id: messageId, author_id: -1, message_object: [{ type: "image", object_type: "image", object_url: "https://r2.syntx.ai/generated/result.png", completed: true, model_type: "banana-2.1" }] }
        : { id: messageId, author_id: 139413708, message_object: [{ type: "text", object_type: "text", text: "prompt echo", completed: true, model_type: "banana-2.1" }] };
    }
    else if (url.pathname.endsWith("/inprogress") && method === "GET") body = [];
    else throw new Error("UNEXPECTED_SYNTHETIC_FETCH_ROUTE");
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-owner-challenge", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION, join(process.cwd(), "catalog"));
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  let authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  let linkService = new PerUserLinkService(provider, authProfile.store, { attemptIdGenerator: () => ATTEMPT_ID });
  await linkService.createAttempt(authProfile.binding);
  await linkService.issueHandoff(authProfile.binding, ATTEMPT_ID);
  assert.equal((await linkService.checkAttempt(authProfile.binding, ATTEMPT_ID)).status, "LINKED");
  let manager = await createOwnerDurableSessionManager({ authProfile, linkService, catalog, registry, createContext: createOwnerDurableLiveContextFactory({ fetchImpl }) });
  const firstServer = new McpServer({ name: "owner-live-lifetime-one", version: "1.0.0" });
  registerSyntxOwnerDurableGenerationTools(firstServer, new OwnerDurableLiveGenerationService(manager, registry, catalogVersion));
  const firstClient = new Client({ name: "owner-live-client-one", version: "1.0.0" });
  const [firstClientTransport, firstServerTransport] = InMemoryTransport.createLinkedPair();
  await firstServer.connect(firstServerTransport); await firstClient.connect(firstClientTransport);
  await firstClient.listTools();
  let jobId = "";
  try {
    const startInput = { name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "lifecycle-test-private-prompt" }, idempotency_key: "lifecycle-key-1"
    } };
    const [started, concurrentReplay] = await Promise.all([firstClient.callTool(startInput), firstClient.callTool(startInput)]);
    assert.equal(started.isError, undefined, JSON.stringify(started));
    assert.equal(concurrentReplay.isError, undefined, JSON.stringify(concurrentReplay));
    jobId = (started.structuredContent as { job_id: string }).job_id;
    assert.equal((concurrentReplay.structuredContent as { job_id: string }).job_id, jobId);
    assert.equal(typeof jobId, "string");
    assert.equal(JSON.stringify(started).includes("lifecycle-test-private-prompt"), false);
    const replay = await firstClient.callTool({ name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "lifecycle-test-private-prompt" }, idempotency_key: "lifecycle-key-1"
    } });
    assert.equal(replay.isError, undefined);
    assert.equal((replay.structuredContent as { job_id: string }).job_id, jobId);
    const conflict = await firstClient.callTool({ name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "different-private-prompt" }, idempotency_key: "lifecycle-key-1"
    } });
    assert.equal(readSafeToolError(conflict).error.code, "IDEMPOTENCY_CONFLICT");
    for (const [index, active] of [false, null].entries()) {
      subscriptionActive = active;
      const denied = await firstClient.callTool({ name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "denied-subscription-prompt" }, idempotency_key: `denied-subscription-${index}`
      } });
      assert.equal(readSafeToolError(denied).error.code, "OWNER_SESSION_CONTEXT_UNAVAILABLE");
    }
    subscriptionActive = true;
    for (const deniedAccess of [false, null] as const) {
      accountAccess = deniedAccess;
      const denied = await firstClient.callTool({ name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
        link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "denied-private-prompt" }, idempotency_key: `denied-access-${String(deniedAccess)}`
      } });
      assert.equal(readSafeToolError(denied).error.code, "OWNER_SESSION_CONTEXT_UNAVAILABLE");
    }
    accountAccess = true;
    loseNextGenerationReceipt = true;
    const lostReceiptInput = { name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "unknown-private-prompt" }, idempotency_key: "lost-receipt-key"
    } };
    const unknown = await firstClient.callTool(lostReceiptInput);
    const unknownOutput = readSafeToolError(unknown);
    assert.equal(unknownOutput.error.code, "UPSTREAM_OUTCOME_UNKNOWN");
    assert.equal(typeof unknownOutput.error.job_id, "string");
    assert.equal(JSON.stringify(unknown).includes("SIMULATED_PRIVATE_UPSTREAM_FAILURE"), false);
    const unknownReplay = await firstClient.callTool(lostReceiptInput);
    assert.equal(readSafeToolError(unknownReplay).error.code, "UPSTREAM_OUTCOME_UNKNOWN");
    assert.equal(JSON.stringify(unknownReplay).includes("unknown-private-prompt"), false);

    let signalSubscriptionStarted!: () => void;
    let releaseSubscription!: () => void;
    const subscriptionStarted = new Promise<void>((resolve) => { signalSubscriptionStarted = resolve; });
    const subscriptionWait = new Promise<void>((resolve) => { releaseSubscription = resolve; });
    nextSubscriptionGate = { signalStarted: signalSubscriptionStarted, wait: subscriptionWait };
    const chatCreatesBeforeClose = counters.chatCreates;
    const generationPostsBeforeClose = counters.generationPosts;
    const lateStart = firstClient.callTool({ name: SYNTX_OWNER_START_DURABLE_GENERATION_TOOL_NAME, arguments: {
      link_attempt_id: ATTEMPT_ID, ...SELECTION, parameters: { prompt: "close-during-subscription" }, idempotency_key: "close-during-subscription"
    } }).catch(() => undefined);
    await subscriptionStarted;
    const closing = manager.close();
    releaseSubscription();
    await lateStart;
    await closing;
    assert.equal(subscriptionResponseCancelled, true, "close cancels the unread response body before rejecting the in-flight fetch");
    assert.equal(counters.chatCreates, chatCreatesBeforeClose, "close during subscription fetch stops before chat creation");
    assert.equal(counters.generationPosts, generationPostsBeforeClose, "close during subscription fetch stops before generation dispatch");
  } finally { await firstClient.close(); await firstServer.close(); }
  assert.equal(counters.generationPosts, 2, "one successful intent and one lost-receipt intent each make only one POST");
  assert.equal(counters.chatCreates, 2, "denied access never creates a chat");
  assert.equal(counters.subscriptionReads, 8, "pre-dispatch denials are checked; accepted/unknown replays and conflicts do no account traffic");
  assert.equal(counters.modelReads, 5, "only fresh intents perform account model access reads");
  await manager.close();

  authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  linkService = new PerUserLinkService(provider, authProfile.store);
  manager = await createOwnerDurableSessionManager({ authProfile, linkService, catalog, createContext: createOwnerDurableLiveContextFactory({ fetchImpl }) });
  const secondServer = new McpServer({ name: "owner-live-lifetime-two", version: "1.0.0" });
  registerSyntxOwnerDurableGenerationTools(secondServer, new OwnerDurableLiveGenerationService(manager, null, null));
  const secondClient = new Client({ name: "owner-live-client-two", version: "1.0.0" });
  const [secondClientTransport, secondServerTransport] = InMemoryTransport.createLinkedPair();
  await secondServer.connect(secondServerTransport); await secondClient.connect(secondClientTransport);
  await secondClient.listTools();
  try {
    const foreign = await secondClient.callTool({ name: SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME, arguments: { link_attempt_id: "link_foreign_owner_attempt01", job_id: jobId } });
    assert.equal(readSafeToolError(foreign).error.code, "OWNER_SESSION_NOT_LINKED");
    assert.equal(counters.messageReads, 0, "a foreign attempt is rejected before any upstream GET");
    const read = await secondClient.callTool({ name: SYNTX_OWNER_GET_DURABLE_JOB_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT_ID, job_id: jobId } });
    assert.equal(read.isError, undefined, JSON.stringify(read));
    assert.equal((read.structuredContent as { id: string }).id, jobId);
    assert.equal(counters.messageReads, 2, "the fresh lifetime reads the receipt, proves the unique bot result in that newly created chat, then fetches the bound result");
    assert.equal(counters.chatCreates, 2, "the result history is queried only under the fresh chat created for the accepted intent; the lost receipt is never searched");
    assert.equal(counters.generationPosts, 2);
    assert.equal(counters.subscriptionReads, 8);
    assert.equal(counters.modelReads, 5);
  } finally { await secondClient.close(); await secondServer.close(); await manager.close(); }
});
