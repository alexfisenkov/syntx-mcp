import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApplicationCore } from "../src/application/core.js";
import { hashGenerationRequest } from "../src/application/generation-request.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";
import { SyntxUpstreamAdapter } from "../src/adapter/syntx/upstream-adapter.js";
import type { SyntxGenerationChatClient } from "../src/adapter/syntx/upstream-adapter.js";
import { SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import { ApplicationError } from "../src/errors.js";
import type { GenerationRequest, Modality } from "../src/domain/types.js";
import type { GenerationOperationRecord, GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import type {
  ChatMessageHistorySnapshot,
  MediaGenerationReceipt,
  RedactedMessageEnvelope,
  SafeArtifactMetadata,
  StartAudioRequest,
  StartImageRequest,
  StartVideoRequest
} from "../src/adapter/syntx/chat-http-client.js";
import { createTestHarness, estimateAndConfirm } from "./helpers.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createOwnerUncappedGenerationAuthority } from "../src/adapter/syntx/owner-uncapped-authority.js";
import { OWNER_UNCAPPED_APPROVED_MAX_COST } from "../src/domain/generation-operation.js";

const TENANT_ID = "tenant_test_owner";
// Explicit synthetic fixture identity, not a runtime account fallback.
const PRINCIPAL: GenerationPrincipalRef = Object.freeze({
  tenant_id: TENANT_ID,
  subject_id: TENANT_ID,
  connection_id: "connection_unscoped_single_owner_v1"
});
const OTHER_PRINCIPAL: GenerationPrincipalRef = Object.freeze({
  ...PRINCIPAL,
  tenant_id: "tenant_other_002",
  subject_id: "tenant_other_002"
});

interface FakeChatClientOptions {
  /** Always throw an ambiguous (non-SyntxHttpError) failure on createChat. */
  failCreateChat?: boolean;
  /** Throw an ambiguous failure on createChat exactly this many times, then succeed. */
  failCreateChatCount?: number;
  /** Throw a deterministic SyntxHttpError("AUTH_REQUIRED") on createChat instead of an ambiguous failure. */
  authRequiredOnCreateChat?: boolean;
  failStartMedia?: boolean;
  /** Throw a deterministic SyntxHttpError("INVALID_REQUEST") on startImage instead of an ambiguous failure. */
  invalidRequestOnStartMedia?: boolean;
  chatUuid?: string;
  messageId?: string;
}

class FakeChatClient implements SyntxGenerationChatClient {
  calls = {
    createChat: 0,
    startImage: 0,
    startVideo: 0,
    startAudio: 0,
    getMessage: 0,
    listMessageCandidates: 0,
    cancelMessage: 0
  };
  private readonly chatUuid: string;
  private readonly messageId: string;
  private readonly failCreateChat: boolean;
  private failCreateChatCount: number;
  private readonly authRequiredOnCreateChat: boolean;
  private readonly failStartMedia: boolean;
  private readonly invalidRequestOnStartMedia: boolean;
  private nextMessage: RedactedMessageEnvelope | null = null;
  private historySnapshot: ChatMessageHistorySnapshot | null = null;
  listMessageCandidates?: SyntxGenerationChatClient["listMessageCandidates"];
  private readonly messages = new Map<string, RedactedMessageEnvelope>();
  fetchedMessageIds: string[] = [];
  fetchedChatUuids: string[] = [];
  createdChatUuids: string[] = [];
  historyLookups: Array<{ chat_uuid: string; owner_echo_message_id: string }> = [];
  lastStartImageRequest: StartImageRequest | null = null;

  constructor(options: FakeChatClientOptions = {}) {
    this.chatUuid = options.chatUuid ?? "chat_test_001";
    this.messageId = options.messageId ?? "message_test_001";
    this.failCreateChat = options.failCreateChat ?? false;
    this.failCreateChatCount = options.failCreateChatCount ?? 0;
    this.authRequiredOnCreateChat = options.authRequiredOnCreateChat ?? false;
    this.failStartMedia = options.failStartMedia ?? false;
    this.invalidRequestOnStartMedia = options.invalidRequestOnStartMedia ?? false;
  }

  setNextMessage(message: RedactedMessageEnvelope): void {
    this.nextMessage = message;
  }

  setMessage(messageId: string, message: RedactedMessageEnvelope): void {
    this.messages.set(messageId, message);
  }

  setHistory(snapshot: ChatMessageHistorySnapshot): void {
    this.historySnapshot = snapshot;
    this.listMessageCandidates = async (chatUuid, ownerEchoMessageId) => {
      this.calls.listMessageCandidates += 1;
      this.historyLookups.push({ chat_uuid: chatUuid, owner_echo_message_id: ownerEchoMessageId });
      if (!this.historySnapshot) throw new Error("synthetic history unavailable");
      return this.historySnapshot;
    };
  }

  async createChat(): Promise<{ chat_uuid: string }> {
    this.calls.createChat += 1;
    if (this.authRequiredOnCreateChat) {
      throw new SyntxHttpError("AUTH_REQUIRED", "simulated auth failure");
    }
    if (this.failCreateChat) throw new Error("simulated network failure");
    if (this.failCreateChatCount > 0) {
      this.failCreateChatCount -= 1;
      throw new Error("simulated transient network failure");
    }
    this.createdChatUuids.push(this.chatUuid);
    return { chat_uuid: this.chatUuid };
  }

  async startImage(request: StartImageRequest): Promise<MediaGenerationReceipt> {
    this.calls.startImage += 1;
    this.lastStartImageRequest = request;
    if (this.invalidRequestOnStartMedia) {
      throw new SyntxHttpError("INVALID_REQUEST", "simulated invalid request");
    }
    if (this.failStartMedia) throw new Error("simulated network failure");
    return { chat_uuid: this.chatUuid, message_id: this.messageId };
  }

  async startVideo(_request: StartVideoRequest): Promise<MediaGenerationReceipt> {
    this.calls.startVideo += 1;
    if (this.failStartMedia) throw new Error("simulated network failure");
    return { chat_uuid: this.chatUuid, message_id: this.messageId };
  }

  async startAudio(_request: StartAudioRequest): Promise<MediaGenerationReceipt> {
    this.calls.startAudio += 1;
    if (this.failStartMedia) throw new Error("simulated network failure");
    return { chat_uuid: this.chatUuid, message_id: this.messageId };
  }

  async getMessage(chatUuid: string, messageId: string): Promise<RedactedMessageEnvelope> {
    this.calls.getMessage += 1;
    this.fetchedChatUuids.push(chatUuid);
    this.fetchedMessageIds.push(messageId);
    const exact = this.messages.get(messageId);
    if (exact) return exact;
    if (this.nextMessage) return this.nextMessage;
    return {
      chat_uuid: this.chatUuid,
      message_id: this.messageId,
      artifacts: []
    };
  }

  async cancelMessage(): Promise<{
    chat_uuid: string;
    message_id: string;
    accepted: true;
  }> {
    this.calls.cancelMessage += 1;
    return { chat_uuid: this.chatUuid, message_id: this.messageId, accepted: true };
  }
}

function makeAdapter(
  chatClient: FakeChatClient,
  now?: () => Date,
  store = new SqliteGenerationTransactionStore(":memory:")
) {
  const adapter = new SyntxUpstreamAdapter({
    transactionStore: store,
    resolveChatClient: () => chatClient,
    // Mirrors the real banana2 -> banana family relationship (census
    // manifest's ai_name) closely enough to prove the value is threaded
    // through, not a literal claim about SYNTX's actual mapping rule — a
    // real bridge now exists (src/catalog/generation-ai-name-bridge.ts,
    // DEBT-043) but is keyed by public-samples.json's model_id space
    // ("nano-banana-pro"), not this fixture's discovery-space model_id
    // ("banana2" — see the discoveryCatalog-vs-catalog id-space gap noted
    // in docs/проект/незакрыто.md); switching every fixture in this file
    // to public-samples ids is a separate, larger change, not made here.
    resolveAiName: (modelId) => modelId.replace(/[0-9]+$/, ""),
    // Test-only stand-in for a catalog lookup (CatalogOperation's
    // output_modality). A real resolver now exists
    // (resolveModalityFromCatalog, DEBT-043) — same id-space caveat as
    // resolveAiName above applies to using it directly in this fixture.
    resolveModality: (request): Modality =>
      (request.operation_id.split(".", 1)[0] ?? "text") as Modality,
    ...(now ? { now } : {})
  });
  return { adapter, store };
}

function imageRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    model_id: "banana2",
    operation_id: "image.generate",
    parameters: { prompt: "a red bicycle", image_size: "1024x1024" },
    catalog_version: "official-public-api-v1",
    ...overrides
  };
}

function artifact(overrides: Partial<SafeArtifactMetadata> = {}): SafeArtifactMetadata {
  return { url: "https://cdn.syntx.example/artifact.png", ...overrides };
}

test("startGeneration drives chat-create then dispatch and returns a queued job", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const job = await adapter.startGeneration(
    {
      principal: PRINCIPAL,
      idempotency_key: "idem_001",
      confirmation_id: "confirmation_001",
      approved_max_cost_tokens: 10
    },
    imageRequest()
  );
  assert.equal(job.status, "queued");
  assert.equal(job.model_id, "banana2");
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.startImage, 1);
  assert.equal(
    chatClient.lastStartImageRequest?.ai_name,
    "banana",
    "the resolved ai_name (not the raw model_id, and never a blank placeholder) must reach SYNTX"
  );
  assert.equal(chatClient.lastStartImageRequest?.prompt, "a red bicycle");
});

test("startGeneration replays the same job for a repeated idempotency key without re-dispatching", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_002",
    confirmation_id: "confirmation_002",
    approved_max_cost_tokens: 10
  };
  const first = await adapter.startGeneration(context, imageRequest());
  const second = await adapter.startGeneration(context, imageRequest());
  assert.equal(second.id, first.id);
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.startImage, 1);
});

test("startGeneration rejects a reused idempotency key bound to a different request", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_003",
    confirmation_id: "confirmation_003",
    approved_max_cost_tokens: 10
  };
  await adapter.startGeneration(context, imageRequest());
  await assert.rejects(
    adapter.startGeneration(context, imageRequest({ model_id: "different_model" })),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("startGeneration rejects text generation as not yet researched, without any chat call", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  await assert.rejects(
    adapter.startGeneration(
      {
        principal: PRINCIPAL,
        idempotency_key: "idem_004",
        confirmation_id: "confirmation_004",
        approved_max_cost_tokens: 10
      },
      {
        model_id: "chatgpt",
        operation_id: "text.generate",
        parameters: { prompt: "hello" },
        catalog_version: "official-public-api-v1"
      }
    ),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "UPSTREAM_CAPABILITY_NOT_RESEARCHED"
  );
  assert.equal(chatClient.calls.createChat, 0);
});

test("startGeneration rejects a request with no prompt parameter before touching the network", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  await assert.rejects(
    adapter.startGeneration(
      {
        principal: PRINCIPAL,
        idempotency_key: "idem_005",
        confirmation_id: "confirmation_005",
        approved_max_cost_tokens: 10
      },
      imageRequest({ parameters: { image_size: "1024x1024" } })
    ),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "INVALID_PARAMETERS"
  );
  assert.equal(chatClient.calls.createChat, 0);
});

test("a parameter key the durable store cannot record surfaces as INVALID_PARAMETERS, not a raw storage error", async () => {
  // GenerationTransactionStore's SAFE_PARAMETER_KEY_PATTERN rejects keys
  // starting with a digit or containing non-Latin characters — critic-code
  // found this GenerationTransactionStoreError("INVALID_RECORD") was
  // leaking past the UpstreamAdapter port boundary uncaught.
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  await assert.rejects(
    adapter.startGeneration(
      {
        principal: PRINCIPAL,
        idempotency_key: "idem_005b",
        confirmation_id: "confirmation_005b",
        approved_max_cost_tokens: 10
      },
      imageRequest({ parameters: { prompt: "x", "2d_style": true } })
    ),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "INVALID_PARAMETERS"
  );
  assert.equal(chatClient.calls.createChat, 0);
});

test("a lost chat-create response surfaces as UPSTREAM_OUTCOME_UNKNOWN, never as a fabricated job", async () => {
  const chatClient = new FakeChatClient({ failCreateChat: true });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_006",
    confirmation_id: "confirmation_006",
    approved_max_cost_tokens: 10
  };
  await assert.rejects(
    adapter.startGeneration(context, imageRequest()),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN"
  );
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_006"
  );
  assert.equal(record?.state, "CHAT_CREATE_OUTCOME_UNKNOWN");
});

test("a lost dispatch response surfaces as UPSTREAM_OUTCOME_UNKNOWN and records the chat that was created", async () => {
  const chatClient = new FakeChatClient({ failStartMedia: true });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_007",
    confirmation_id: "confirmation_007",
    approved_max_cost_tokens: 10
  };
  await assert.rejects(
    adapter.startGeneration(context, imageRequest()),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN"
  );
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_007"
  );
  assert.equal(record?.state, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(record?.receipt?.chat_uuid, "chat_test_001");
});

test("reconcileStart retries a lost chat-create once; a transient failure is recovered without a second chat or a burned confirmation", async () => {
  // createChat fails once (the original startGeneration attempt), then
  // succeeds on the reconcileStart retry.
  const chatClient = new FakeChatClient({ failCreateChatCount: 1 });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_008",
    confirmation_id: "confirmation_008",
    approved_max_cost_tokens: 10
  };
  await assert.rejects(
    adapter.startGeneration(context, imageRequest()),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN"
  );

  const resolved = await adapter.reconcileStart({
    principal: PRINCIPAL,
    idempotency_key: "idem_008",
    request_hash: hashGenerationRequest(imageRequest())
  });
  assert.equal(
    resolved,
    null,
    "reconcileStart cannot finish dispatch itself (no access to the original prompt) — the caller must retry startGeneration"
  );
  assert.equal(chatClient.calls.createChat, 2, "the retry must actually attempt createChat again");

  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_008"
  );
  assert.equal(record?.state, "CHAT_READY", "the retry succeeded and advanced the durable record");

  // A caller retry with a fresh confirmation completes the operation,
  // reusing the already-created chat rather than creating a second one.
  const finished = await adapter.startGeneration(
    { ...context, confirmation_id: "confirmation_008_retry" },
    imageRequest()
  );
  assert.equal(finished.status, "queued");
  assert.equal(chatClient.calls.createChat, 2, "must not create a second chat on the completing retry");
  assert.equal(chatClient.calls.startImage, 1);
});

test("reconcileStart returns null (not a throw) when the chat-create retry is itself ambiguous again", async () => {
  const chatClient = new FakeChatClient({ failCreateChat: true });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_008b",
    confirmation_id: "confirmation_008b",
    approved_max_cost_tokens: 10
  };
  await assert.rejects(adapter.startGeneration(context, imageRequest()));
  const resolved = await adapter.reconcileStart({
    principal: PRINCIPAL,
    idempotency_key: "idem_008b",
    request_hash: hashGenerationRequest(imageRequest())
  });
  assert.equal(resolved, null);
  assert.equal(chatClient.calls.createChat, 2, "one original attempt plus one retry, both ambiguous");
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_008b"
  );
  assert.equal(record?.state, "CHAT_CREATE_OUTCOME_UNKNOWN");
});

test("a deterministic rejection (SyntxHttpError AUTH_REQUIRED) on createChat closes the operation cleanly as REJECTED_NO_COMMIT, not as an ambiguous outcome", async () => {
  const chatClient = new FakeChatClient({ authRequiredOnCreateChat: true });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_009b",
    confirmation_id: "confirmation_009b",
    approved_max_cost_tokens: 10
  };
  const job = await adapter.startGeneration(context, imageRequest());
  assert.equal(job.status, "failed", "a clean rejection must not throw or leave the caller uncertain");
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_009b"
  );
  assert.equal(record?.state, "REJECTED_NO_COMMIT");
  assert.equal(record?.failure_code, "SYNTX_REJECTED_AUTH_REQUIRED");
});

test("a deterministic rejection (SyntxHttpError INVALID_REQUEST) on the dispatch call also closes as REJECTED_NO_COMMIT", async () => {
  const chatClient = new FakeChatClient({ invalidRequestOnStartMedia: true });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_009c",
    confirmation_id: "confirmation_009c",
    approved_max_cost_tokens: 10
  };
  const job = await adapter.startGeneration(context, imageRequest());
  assert.equal(job.status, "failed");
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_009c"
  );
  assert.equal(record?.state, "REJECTED_NO_COMMIT");
  assert.equal(record?.failure_code, "SYNTX_REJECTED_INVALID_REQUEST");
  assert.equal(chatClient.calls.createChat, 1, "the chat was created before the deterministic dispatch rejection");
});

test("reconcileStart returns null for an idempotency key it has never seen", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const resolved = await adapter.reconcileStart({
    principal: PRINCIPAL,
    idempotency_key: "idem_never_seen",
    request_hash: "sha256:whatever"
  });
  assert.equal(resolved, null);
});

test("getJob keeps accepted state when the echo has no result evidence, then succeeds from exact artifacts", async () => {
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_009",
    confirmation_id: "confirmation_009",
    approved_max_cost_tokens: 10
  };
  const started = await adapter.startGeneration(context, imageRequest());
  assert.equal(started.status, "queued");

  // The recorded receipt is the owner's echo. Missing status is not provider
  // evidence, so repeated polls preserve the known accepted state.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assert.equal((await adapter.getJob({ principal: PRINCIPAL, job_id: started.id })).status, "queued");
    assert.equal((store.getById({ tenant_id: TENANT_ID, subject_id: TENANT_ID }, started.id))?.state, "PROVIDER_ACCEPTED");
  }

  chatClient.setNextMessage({
    chat_uuid: "chat_test_001",
    message_id: "message_test_001",
    status: "completed",
    artifacts: [artifact()]
  });
  const succeeded = await adapter.getJob({ principal: PRINCIPAL, job_id: started.id });
  assert.equal(succeeded.status, "succeeded");

  const stable = await adapter.getJob({ principal: PRINCIPAL, job_id: started.id });
  assert.equal(stable.status, "succeeded");
  assert.equal(chatClient.calls.getMessage, 3, "the terminal job must not be polled again");
});

test("durably binds the unique dedicated-chat bot result before fetching it and preserves the echo receipt", async (t) => {
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  t.after(() => store.close());
  const started = await adapter.startGeneration({
    principal: PRINCIPAL, idempotency_key: "durable_echo_result_binding",
    confirmation_id: "durable_echo_result_binding_confirm", approved_max_cost_tokens: 10
  }, imageRequest());
  chatClient.setNextMessage({ chat_uuid: "chat_test_001", message_id: "message_test_001", object_type: "text", model_type: "banana2", artifacts: [] });
  chatClient.setHistory({
    complete: true, page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false, provider_chat_id: "7751939",
    messages: [
      { message_id: "message_test_001", provider_chat_id: "7751939", author_role: "owner", objects: [{ message_object_id: "object_echo_001", object_type: "text", model_type: "banana2" }] },
      { message_id: "message_bot_001", provider_chat_id: "7751939", author_role: "bot", objects: [{ message_object_id: "object_bot_001", object_type: "image", model_type: "banana2" }] }
    ]
  });
  chatClient.setMessage("message_bot_001", { chat_uuid: "chat_test_001", message_id: "message_bot_001", status: "completed", artifacts: [artifact()] });

  const completed = await adapter.getJob({ principal: PRINCIPAL, job_id: started.id });
  const record = store.getById({ tenant_id: TENANT_ID, subject_id: TENANT_ID }, started.id)!;
  assert.equal(completed.status, "succeeded");
  assert.equal(record.receipt?.message_id, "message_test_001");
  assert.equal(record.result_message_id, "message_bot_001");
  assert.deepEqual(chatClient.fetchedMessageIds, ["message_test_001", "message_bot_001"]);
  assert.deepEqual(chatClient.createdChatUuids, ["chat_test_001"]);
  assert.deepEqual(chatClient.historyLookups, [{ chat_uuid: chatClient.createdChatUuids[0], owner_echo_message_id: "message_test_001" }]);
  assert.deepEqual(chatClient.fetchedChatUuids, [chatClient.createdChatUuids[0], chatClient.createdChatUuids[0]]);
  assert.equal(store.listEvents({ tenant_id: TENANT_ID, subject_id: TENANT_ID }, started.id).at(-2)?.reason_code, "DEDICATED_CHAT_UNIQUE_RESULT");
  const result = await adapter.getResult({ principal: PRINCIPAL, job_id: started.id });
  assert.equal(result.artifacts.length, 1);
  assert.equal(chatClient.fetchedMessageIds.at(-1), "message_bot_001", "restart/result reads use the bound exact bot ID");
  assert.equal(chatClient.calls.startImage, 1, "result binding never repeats the paid dispatch");
});

test("a status token that merely sounds terminal never closes a still-running, already-paid job", async () => {
  // An earlier version of mapMessageStatusToOperationState guessed FAILED/
  // CANCELED from substrings like "fail"/"cancel" — critic-risk and
  // critic-code both flagged this as a severe bug: FAILED/CANCELED are
  // dead ends (ALLOWED_TRANSITIONS has no way out), so one false-positive
  // real-but-unobserved token (e.g. "cancelable", "failover") on a
  // generation that is actually still running would lose it permanently.
  // Fixed by removing all guessed terminal-failure detection.
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_010",
    confirmation_id: "confirmation_010",
    approved_max_cost_tokens: 10
  };
  const started = await adapter.startGeneration(context, imageRequest());
  for (const token of ["failed_content_policy", "cancelable", "error_free", "queued_for_review"]) {
    chatClient.setNextMessage({
      chat_uuid: "chat_test_001",
      message_id: "message_test_001",
      status: token,
      artifacts: []
    });
    assert.equal((await adapter.getJob({ principal: PRINCIPAL, job_id: started.id })).status, "queued",
      `unverified echo status "${token}" must not determine provider state`);
  }
  // Once real artifacts show up, it still reaches SUCCEEDED normally.
  chatClient.setNextMessage({
    chat_uuid: "chat_test_001",
    message_id: "message_test_001",
    status: "completed",
    artifacts: [artifact()]
  });
  const succeeded = await adapter.getJob({ principal: PRINCIPAL, job_id: started.id });
  assert.equal(succeeded.status, "succeeded");
});

test("ambiguous or wrong-model history never binds a result or fetches a bot message", async (t) => {
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  t.after(() => store.close());
  const started = await adapter.startGeneration({
    principal: PRINCIPAL, idempotency_key: "durable_result_reject_ambiguous",
    confirmation_id: "durable_result_reject_ambiguous_confirm", approved_max_cost_tokens: 10
  }, imageRequest());
  chatClient.setNextMessage({ chat_uuid: "chat_test_001", message_id: "message_test_001", object_type: "text", model_type: "banana2", artifacts: [] });
  chatClient.setHistory({
    complete: true, page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false, provider_chat_id: "7751939",
    messages: [
      { message_id: "message_test_001", provider_chat_id: "7751939", author_role: "owner", objects: [{ message_object_id: "object_echo_002", object_type: "text", model_type: "banana2" }] },
      { message_id: "message_bot_wrong_model", provider_chat_id: "7751939", author_role: "bot", objects: [{ message_object_id: "object_bot_002", object_type: "image", model_type: "banana3" }] }
    ]
  });
  await assert.rejects(adapter.getJob({ principal: PRINCIPAL, job_id: started.id }),
    (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN" && error.details?.reason_code === "RESULT_NOT_UNIQUELY_ATTRIBUTABLE");
  const record = store.getById({ tenant_id: TENANT_ID, subject_id: TENANT_ID }, started.id)!;
  assert.equal(record.state, "PROVIDER_ACCEPTED");
  assert.equal(record.receipt?.message_id, "message_test_001");
  assert.equal(record.result_message_id, null);
  assert.deepEqual(chatClient.fetchedMessageIds, ["message_test_001"]);
  assert.equal(chatClient.calls.startImage, 1);
});

test("getJob throws JOB_NOT_FOUND for an unknown job id", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  await assert.rejects(
    adapter.getJob({ principal: PRINCIPAL, job_id: "job_does_not_exist" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "JOB_NOT_FOUND"
  );
});

test("cancelJob records ACK without claiming cancellation and replays only the original key", async () => {
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_011",
    confirmation_id: "confirmation_011",
    approved_max_cost_tokens: 10
  };
  const started = await adapter.startGeneration(context, imageRequest());
  const canceled = await adapter.cancelJob({
    principal: PRINCIPAL,
    job_id: started.id,
    idempotency_key: "cancel_idem_011",
    confirmation_id: "cancel_confirmation_011"
  });
  assert.equal(canceled.status, "queued");
  assert.equal(chatClient.calls.cancelMessage, 1);
  assert.equal(store.getCancelAttempt({ tenant_id: TENANT_ID, subject_id: TENANT_ID }, started.id)?.state, "ACKNOWLEDGED");

  const reconciled = await adapter.reconcileCancel({
    principal: PRINCIPAL,
    job_id: started.id,
    idempotency_key: "cancel_idem_011"
  });
  assert.equal(reconciled?.status, "queued");

  const secondCancel = await adapter.cancelJob({
    principal: PRINCIPAL,
    job_id: started.id,
    idempotency_key: "cancel_idem_011",
    confirmation_id: "cancel_confirmation_011_retry"
  });
  assert.equal(secondCancel.status, "queued");
  await assert.rejects(adapter.cancelJob({
    principal: PRINCIPAL, job_id: started.id,
    idempotency_key: "cancel_idem_011_other", confirmation_id: "cancel_confirmation_other"
  }), (error: unknown) => error instanceof ApplicationError && error.code === "JOB_NOT_CANCELABLE");
  assert.equal(chatClient.calls.cancelMessage, 1, "an acknowledged cancellation must not be sent twice");
});

test("cancelJob refuses a job that has not been accepted by the provider yet", async () => {
  const chatClient = new FakeChatClient({ failStartMedia: true });
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_012",
    confirmation_id: "confirmation_012",
    approved_max_cost_tokens: 10
  };
  await assert.rejects(adapter.startGeneration(context, imageRequest()));
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_012"
  );
  assert.ok(record);
  await assert.rejects(
    adapter.cancelJob({
      principal: PRINCIPAL,
      job_id: record!.id,
      idempotency_key: "cancel_idem_012",
      confirmation_id: "cancel_confirmation_012"
    }),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "JOB_NOT_CANCELABLE"
  );
});

test("getResult returns mapped artifacts only after SUCCEEDED, and rejects earlier", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_013",
    confirmation_id: "confirmation_013",
    approved_max_cost_tokens: 10
  };
  const started = await adapter.startGeneration(context, imageRequest());
  await assert.rejects(
    adapter.getResult({ principal: PRINCIPAL, job_id: started.id }),
    (error: unknown) => error instanceof ApplicationError && error.code === "JOB_NOT_READY"
  );

  chatClient.setNextMessage({
    chat_uuid: "chat_test_001",
    message_id: "message_test_001",
    status: "completed",
    artifacts: [artifact({ mime_type: "image/png", byte_size: 12345 })]
  });
  await adapter.getJob({ principal: PRINCIPAL, job_id: started.id });

  const result = await adapter.getResult({ principal: PRINCIPAL, job_id: started.id });
  assert.equal(result.job_id, started.id);
  assert.equal(result.artifacts.length, 1);
  assert.equal(result.artifacts[0]?.mime_type, "image/png");
  assert.equal(result.artifacts[0]?.size_bytes, 12345);
  assert.equal(result.artifacts[0]?.kind, "image");
});

test("getResult never returns a synthetic empty-artifact success if the fresh getMessage call comes back empty", async () => {
  // The durable record can only reach SUCCEEDED via
  // mapMessageStatusToOperationState, which itself requires a non-empty
  // artifacts list — but getResult re-fetches the message live rather than
  // trusting a cached copy (so a signed URL is fresh, not stale). If that
  // live fetch comes back empty (expired, or chat-http-client.ts's
  // DEBT-010 fail-closed artifact gate), silently returning
  // GenerationResult with zero artifacts would look like a valid, empty
  // success — critic-code flagged this as silent corruption.
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_013b",
    confirmation_id: "confirmation_013b",
    approved_max_cost_tokens: 10
  };
  const started = await adapter.startGeneration(context, imageRequest());
  chatClient.setNextMessage({
    chat_uuid: "chat_test_001",
    message_id: "message_test_001",
    status: "completed",
    artifacts: [artifact()]
  });
  await adapter.getJob({ principal: PRINCIPAL, job_id: started.id });

  chatClient.setNextMessage({
    chat_uuid: "chat_test_001",
    message_id: "message_test_001",
    status: "completed",
    artifacts: []
  });
  await assert.rejects(
    adapter.getResult({ principal: PRINCIPAL, job_id: started.id }),
    (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN"
  );
});

test("owner uncapped authority binds exact principal and live V2 schema, then replays without current-model preparation", async () => {
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    join(process.cwd(), "catalog")
  );
  let modelLookups = 0;
  const selectedCatalog = new Proxy(catalog, {
    get(target, property) {
      if (property === "getModel") return (modelId: string) => {
        modelLookups += 1;
        return target.getModel(modelId);
      };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const authority = createOwnerUncappedGenerationAuthority({
    principal: PRINCIPAL,
    registry,
    selectedCatalog,
    model_id: "banana-2.1",
    operation_id: "generate-image",
    variant_id: "banana21-image-1k-minimal-square"
  });
  assert.throws(() => createOwnerUncappedGenerationAuthority({
    principal: PRINCIPAL,
    registry,
    selectedCatalog,
    model_id: "banana-2.1",
    operation_id: "generate-image",
    variant_id: "banana-ui-reviewed-banana-2.1"
  }), (error: unknown) => error instanceof ApplicationError && error.code === "GENERATION_CONTRACT_UNAVAILABLE");
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  const request: GenerationRequest = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    parameters: { prompt: "synthetic uncapped owner fixture" },
    catalog_version: registry.catalog_version
  };
  const context = { principal: PRINCIPAL, idempotency_key: "owner-uncapped-idem-0001", authority };

  await assert.rejects(adapter.startOwnerGeneration({ ...context, principal: OTHER_PRINCIPAL }, request),
    (error: unknown) => error instanceof ApplicationError && error.code === "INVALID_PARAMETERS");
  await assert.rejects(adapter.startOwnerGeneration({ ...context, authority: {} as typeof authority }, request),
    (error: unknown) => error instanceof ApplicationError && error.code === "INVALID_PARAMETERS");
  await assert.rejects(adapter.startOwnerGeneration(context, { ...request, operation_id: "generate-video" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "INVALID_PARAMETERS");
  assert.equal(chatClient.calls.createChat, 0);

  const [job, concurrentReplay] = await Promise.all([
    adapter.startOwnerGeneration(context, request),
    adapter.startOwnerGeneration(context, request)
  ]);
  assert.equal(job.status, "queued");
  assert.equal(concurrentReplay.id, job.id);
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.startImage, 1);
  assert.equal(chatClient.calls.getMessage, 0);
  const stored = store.getById({ tenant_id: PRINCIPAL.tenant_id, subject_id: PRINCIPAL.subject_id }, job.id);
  assert.equal(stored?.approved_max_cost, OWNER_UNCAPPED_APPROVED_MAX_COST);
  assert.equal(stored?.cost.cap_enforcement, "UNENFORCEABLE");
  assert.equal(stored?.cost.effective_cost, null);
  assert.equal(stored?.schema_hash, "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d");
  assert.equal(JSON.stringify(stored).includes("synthetic uncapped owner fixture"), false);
  const lookupsAfterStart = modelLookups;

  const replay = await adapter.startOwnerGeneration(context, request);
  assert.equal(replay.id, job.id);
  assert.equal(modelLookups, lookupsAfterStart, "accepted receipt replay must not revalidate against the current model catalog");
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.startImage, 1);
  await adapter.getJob({ principal: PRINCIPAL, job_id: job.id });
  assert.equal(chatClient.calls.getMessage, 1, "known job recovery uses the existing GET path");
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.startImage, 1, "known job recovery never creates another dispatch");

  const alternateAuthority = createOwnerUncappedGenerationAuthority({
    principal: PRINCIPAL,
    registry,
    selectedCatalog,
    model_id: "banana-2.1",
    operation_id: "generate-image",
    variant_id: "banana21-image-2k-medium-landscape"
  });
  await assert.rejects(adapter.startOwnerGeneration({ ...context, authority: alternateAuthority }, request),
    (error: unknown) => error instanceof ApplicationError && error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(chatClient.calls.startImage, 1, "a different selected schema conflicts before another POST");

  await assert.rejects(adapter.startGeneration({
    principal: PRINCIPAL,
    idempotency_key: "generic-nan-cap-0001",
    confirmation_id: "synthetic-confirmation",
    approved_max_cost_tokens: Number.NaN
  }, imageRequest()), (error: unknown) => error instanceof ApplicationError && error.code === "COST_CAP_EXCEEDED");
  assert.equal(chatClient.calls.startImage, 1, "generic numeric-cap validation remains in force");
});

test("cap_enforcement is honestly UNENFORCEABLE, not a false PRE_DISPATCH_ONLY claim, since no real cost check happens", async () => {
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_014",
    confirmation_id: "confirmation_014",
    approved_max_cost_tokens: 10
  };
  await adapter.startGeneration(context, imageRequest());
  const record = store.getByIdempotencyKey(
    { tenant_id: TENANT_ID, subject_id: TENANT_ID },
    "idem_014"
  );
  assert.equal(record?.cost.cap_enforcement, "UNENFORCEABLE");
  // approved_max_cost is recorded for audit but never compared against
  // anything — a request with an absurdly low cap must still dispatch,
  // proving there is truly no check (not just a lenient one).
  const lowCapContext = { ...context, idempotency_key: "idem_014b", approved_max_cost_tokens: 0 };
  const job = await adapter.startGeneration(lowCapContext, imageRequest());
  assert.equal(job.status, "queued");
});

test("getBalance and estimateGeneration are honest not-researched stubs, not silent guesses", async () => {
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient);
  await assert.rejects(
    adapter.getBalance(PRINCIPAL),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "UPSTREAM_CAPABILITY_NOT_RESEARCHED"
  );
  await assert.rejects(
    adapter.estimateGeneration(PRINCIPAL, imageRequest()),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "UPSTREAM_CAPABILITY_NOT_RESEARCHED"
  );
});

// ---------------------------------------------------------------------------
// Regression tests for a real bug critic-code found and reproduced: an
// earlier version of safeTransition() silently swallowed REVISION_CONFLICT
// and returned the concurrently-written record as if THIS caller's own
// transition had gone through. driveStartSaga then proceeded to dispatch
// (or cancelJob to report success) based on that false assumption — a real,
// reproduced double-dispatch / lost-cancellation bug. There is no natural
// way to trigger this via Promise.all in a single JS thread: the read
// (createOrReplay/getById) and the critical write (safeTransition) inside
// one driveStartSaga call have no await between them, so one caller's whole
// read-then-write sequence always completes before a second same-process
// caller's synchronous prefix even starts — exactly why a raw multi-process
// SQLite race was needed to prove the bug in the first place. These two
// tests reproduce that race deterministically, each with its own technique:
// the double-dispatch test intercepts store.transition() itself (exact
// regardless of how many now() calls precede it — see its own comment for
// why that replaced an earlier, now()-call-counting version); the
// lost-cancellation test uses a now() hook that performs the "other
// writer's" transition in the exact window between this caller capturing
// expected_revision and safeTransition's own store.transition() call
// actually executing.
// ---------------------------------------------------------------------------

test("REGRESSION: a concurrent writer that wins CHAT_READY -> GENERATION_DISPATCHING stops this caller from also dispatching", async () => {
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const chatClient = new FakeChatClient({ failCreateChatCount: 1 });
  const built = makeAdapter(chatClient);
  const store = built.store;
  const adapter = built.adapter;
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_race_001",
    confirmation_id: "confirmation_race_001",
    approved_max_cost_tokens: 10
  };

  // Setup: reach durable CHAT_READY via the same recovered-retry path as
  // the earlier reconcileStart test (chat-create fails once, then the
  // reconcileStart retry succeeds).
  await assert.rejects(adapter.startGeneration(context, imageRequest()));
  await adapter.reconcileStart({
    principal: PRINCIPAL,
    idempotency_key: "idem_race_001",
    request_hash: hashGenerationRequest(imageRequest())
  });
  const parked = store.getByIdempotencyKey(owner, "idem_race_001");
  assert.equal(parked?.state, "CHAT_READY", "setup must reach CHAT_READY before the race is armed");
  assert.equal(chatClient.calls.startImage, 0, "no dispatch during setup");

  // Arm the race on the exact store.transition() call this adapter's own
  // CHAT_READY -> GENERATION_DISPATCHING attempt makes, instead of
  // counting now() calls: counting is fragile to any unrelated now() call
  // added elsewhere in startGeneration before this point (e.g. a future
  // dispatch_deadline computation) — the test would keep passing while
  // silently no longer exercising the applied-check it claims to test
  // (critic-code, round 3). Hooking the transition call itself is exact
  // regardless of how many now() calls precede it.
  const realTransition = store.transition.bind(store);
  let raced = false;
  store.transition = (input) => {
    if (!raced && input.to_state === "GENERATION_DISPATCHING") {
      raced = true;
      const record = store.getByIdempotencyKey(owner, "idem_race_001");
      if (record !== null) {
        realTransition({
          owner,
          id: record.id,
          expected_revision: record.revision,
          to_state: "GENERATION_DISPATCHING",
          updated_at: new Date().toISOString()
        });
      }
    }
    return realTransition(input);
  };

  const job = await adapter.startGeneration(
    { ...context, confirmation_id: "confirmation_race_001_retry" },
    imageRequest()
  );
  assert.ok(raced, "the race hook must actually have fired on this adapter's own dispatch-gate transition attempt");
  assert.equal(
    chatClient.calls.startImage,
    0,
    "this caller must NOT dispatch — the concurrent writer already claimed GENERATION_DISPATCHING"
  );
  // GENERATION_DISPATCHING is not in toJobStatus's "queued" case list, so it
  // correctly falls through to "running" — a paid dispatch attempt genuinely
  // in flight is more accurately "running" than merely "queued".
  assert.equal(job.status, "running");
  const record = store.getByIdempotencyKey(owner, "idem_race_001");
  assert.equal(record?.state, "GENERATION_DISPATCHING", "the durable record reflects the winning writer's state, not this caller's");
});

for (const modality of ["image", "video", "audio"] as const) {
  test(`DEBT-047: ${modality} receipt survives recovery winning the acceptance write`, async (t) => {
    const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
    const chatClient = new FakeChatClient();
    const { adapter, store } = makeAdapter(chatClient);
    t.after(() => store.close());
    const context = {
      principal: PRINCIPAL, idempotency_key: `receipt_recovery_${modality}`,
      confirmation_id: `confirm_recovery_${modality}`, approved_max_cost_tokens: 1
    };
    const request = imageRequest({ operation_id: `${modality}.generate` });
    const transition = store.transition.bind(store);
    let recovered = false;
    store.transition = (input) => {
      if (!recovered && input.to_state === "PROVIDER_ACCEPTED") {
        recovered = true;
        assert.equal(store.getById(owner, input.id)?.state, "GENERATION_DISPATCHING");
        assert.equal(store.recoverInterruptedOperations().recovered_count, 1);
      }
      return transition(input);
    };

    const job = await adapter.startGeneration(context, request);
    assert.ok(recovered, "the recovery must run after dispatch and before receipt persistence");
    assert.equal(job.status, "queued");
    const stored = store.getById(owner, job.id);
    assert.equal(stored?.state, "PROVIDER_ACCEPTED");
    assert.deepEqual(stored?.receipt, {
      chat_uuid: "chat_test_001", provider_job_id: null,
      message_id: "message_test_001", message_object_id: null
    });
    assert.deepEqual(store.listEvents(owner, job.id).map((event) => event.to_state), [
      "PREPARED", "CHAT_CREATING", "CHAT_READY", "GENERATION_DISPATCHING",
      "GENERATION_OUTCOME_UNKNOWN", "PROVIDER_ACCEPTED"
    ]);
    assert.equal((await adapter.startGeneration(context, request)).id, job.id);
    await adapter.getJob({ principal: PRINCIPAL, job_id: job.id });
    assert.equal(chatClient.calls.getMessage, 1, "the rescued message remains pollable");
    assert.equal(chatClient.calls.createChat, 1);
    assert.equal(chatClient.calls.startImage + chatClient.calls.startVideo + chatClient.calls.startAudio, 1);
  });
}

test("DEBT-047: rescued receipt survives close and reopen after acceptance persistence", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-receipt-recovery-"));
  const databasePath = join(directory, "private", "operations.sqlite");
  const firstStore = new SqliteGenerationTransactionStore(databasePath);
  let reopened: SqliteGenerationTransactionStore | undefined;
  t.after(() => {
    firstStore.close();
    reopened?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const chatClient = new FakeChatClient();
  const { adapter } = makeAdapter(chatClient, undefined, firstStore);
  const context = {
    principal: PRINCIPAL, idempotency_key: "receipt_reopen",
    confirmation_id: "confirm_receipt_reopen", approved_max_cost_tokens: 1
  };
  const transition = firstStore.transition.bind(firstStore);
  let recovered = false;
  let interrupted = false;
  firstStore.transition = (input) => {
    if (!recovered && input.to_state === "PROVIDER_ACCEPTED") {
      recovered = true;
      firstStore.recoverInterruptedOperations();
    }
    const result = transition(input);
    if (input.to_state === "PROVIDER_ACCEPTED") {
      interrupted = true;
      throw new Error("simulated interruption after durable receipt write");
    }
    return result;
  };
  await assert.rejects(adapter.startGeneration(context, imageRequest()),
    (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.ok(interrupted, "rescue must reach its durable acceptance write before interruption");
  firstStore.close();
  reopened = new SqliteGenerationTransactionStore(databasePath);
  assert.equal(reopened.recoverInterruptedOperations().recovered_count, 0);
  assert.equal(reopened.getByIdempotencyKey(owner, context.idempotency_key)?.receipt?.message_id, "message_test_001");
  const resumed = makeAdapter(chatClient, undefined, reopened).adapter;
  await resumed.reconcileStart({
    principal: PRINCIPAL, idempotency_key: context.idempotency_key,
    request_hash: hashGenerationRequest(imageRequest())
  });
  const record = reopened.getByIdempotencyKey(owner, context.idempotency_key);
  assert.equal(record?.state, "PROVIDER_ACCEPTED");
  assert.equal((await resumed.startGeneration(context, imageRequest())).id, record?.id);
  assert.equal(chatClient.calls.startImage, 1, "restart reconciliation must never resend the paid POST");
  assert.equal(chatClient.calls.getMessage, 0, "the durable receipt is sufficient; no provider lookup is guessed");
});

test("DEBT-047: continued recovery contention is bounded without repeating the paid dispatch", async (t) => {
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const chatClient = new FakeChatClient();
  const { adapter, store } = makeAdapter(chatClient);
  t.after(() => store.close());
  const context = {
    principal: PRINCIPAL, idempotency_key: "receipt_contended",
    confirmation_id: "confirm_receipt_contended", approved_max_cost_tokens: 1
  };
  const transition = store.transition.bind(store);
  let acceptanceAttempts = 0;
  store.transition = (input) => {
    if (input.to_state === "PROVIDER_ACCEPTED") {
      acceptanceAttempts += 1;
      if (acceptanceAttempts > 10) throw new Error("unbounded acceptance retry");
      const current = store.getById(owner, input.id)!;
      if (current.state === "GENERATION_OUTCOME_UNKNOWN") {
        transition({ owner, id: input.id, expected_revision: current.revision,
          to_state: "GENERATION_RECONCILING", updated_at: new Date().toISOString() });
      }
      assert.equal(store.recoverInterruptedOperations().recovered_count, 1);
    }
    return transition(input);
  };
  await assert.rejects(adapter.startGeneration(context, imageRequest()),
    (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.equal(acceptanceAttempts, 3);
  const unknown = store.getByIdempotencyKey(owner, context.idempotency_key)!;
  assert.equal(unknown.state, "GENERATION_OUTCOME_UNKNOWN");
  await assert.rejects(adapter.getJob({ principal: PRINCIPAL, job_id: unknown.id }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "UPSTREAM_OUTCOME_UNKNOWN");
      assert.deepEqual(error.details, { operation_id: unknown.id, state: "GENERATION_OUTCOME_UNKNOWN" });
      return true;
    });
  assert.deepEqual(store.getById(owner, unknown.id), unknown, "status inspection cannot mutate the unknown operation");
  assert.equal(chatClient.calls.listMessageCandidates, 0, "a receiptless unknown dispatch is never searched in chat history");
  await assert.rejects(adapter.reconcileStart({
    principal: PRINCIPAL, idempotency_key: context.idempotency_key,
    request_hash: hashGenerationRequest(imageRequest())
  }), (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.equal(store.getById(owner, unknown.id)?.state, "TERMINAL_UNRESOLVED");
  assert.equal((await adapter.getJob({ principal: PRINCIPAL, job_id: unknown.id })).status, "failed");
  assert.equal(chatClient.calls.startImage, 1);
  assert.equal(chatClient.calls.getMessage, 0);
});

test("DEBT-047 R1: fresh ApplicationCore replays durable acceptance without consuming approval or resolving auth again", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-core-replay-"));
  const databasePath = join(directory, "private", "operations.sqlite");
  const firstStore = new SqliteGenerationTransactionStore(databasePath);
  let reopened: SqliteGenerationTransactionStore | undefined;
  t.after(() => {
    firstStore.close();
    reopened?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const request = {
    model_id: "nano-banana-pro", operation_id: "text-to-image",
    parameters: { prompt: "a red bicycle" }
  };
  // Only the out-of-band estimate fixture uses MockAdapter; both start and
  // restart paths below use the actual core, SYNTX adapter and SQLite store.
  const fixture = createTestHarness({ principal: PRINCIPAL });
  const approval = await estimateAndConfirm(fixture, request, "confirm_core_replay");
  const consume = fixture.confirmations.consumeGeneration.bind(fixture.confirmations);
  let consumptions = 0;
  fixture.confirmations.consumeGeneration = (input) => {
    consumptions += 1;
    return consume(input);
  };
  const chatClient = new FakeChatClient();
  let authLookups = 0;
  const newAdapter = (store: SqliteGenerationTransactionStore) => new SyntxUpstreamAdapter({
    transactionStore: store,
    resolveChatClient: () => { authLookups += 1; return chatClient; },
    resolveAiName: () => "banana", resolveModality: () => "image"
  });
  const input = { ...request, idempotency_key: "core_receipt_replay", confirmation_id: approval.confirmationId };
  const firstCore = new ApplicationCore(fixture.core.catalog, newAdapter(firstStore),
    fixture.confirmations, PRINCIPAL, "TEST_ONLY_MOCK");
  const transition = firstStore.transition.bind(firstStore);
  let recovered = false;
  let interrupted = false;
  firstStore.transition = (candidate) => {
    if (!recovered && candidate.to_state === "PROVIDER_ACCEPTED") {
      recovered = true;
      assert.equal(firstStore.recoverInterruptedOperations().recovered_count, 1);
    }
    const persisted = transition(candidate);
    if (candidate.to_state === "PROVIDER_ACCEPTED") {
      interrupted = true;
      throw new Error("simulated interruption after accepted receipt persistence");
    }
    return persisted;
  };
  await assert.rejects(firstCore.startGeneration(input),
    (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.ok(recovered && interrupted);
  assert.equal(consumptions, 1);
  assert.equal(authLookups, 1);
  firstStore.close();
  reopened = new SqliteGenerationTransactionStore(databasePath);
  assert.equal(reopened.recoverInterruptedOperations().recovered_count, 0);
  const accepted = reopened.getByIdempotencyKey(owner, input.idempotency_key)!;
  for (const state of ["PROVIDER_ACCEPTED", "QUEUED", "RUNNING"] as const) {
    const current: GenerationOperationRecord = reopened.getById(owner, accepted.id)!;
    if (state !== current.state) {
      reopened.transition({ owner, id: accepted.id, expected_revision: current.revision,
        to_state: state, updated_at: new Date().toISOString() });
    }
    const resumedAdapter = newAdapter(reopened);
    const freshCore = new ApplicationCore(fixture.core.catalog, resumedAdapter,
      fixture.confirmations, PRINCIPAL, "TEST_ONLY_MOCK");
    const replayed = await freshCore.startGeneration(input);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.job.id, accepted.id);
    assert.equal(replayed.job.status, state === "RUNNING" ? "running" : "queued");
    assert.equal(await resumedAdapter.reconcileStart({
      principal: OTHER_PRINCIPAL, idempotency_key: input.idempotency_key,
      request_hash: accepted.request_hash
    }), null, "another tenant cannot replay this operation");
    const conflictCore = new ApplicationCore(fixture.core.catalog, resumedAdapter,
      fixture.confirmations, PRINCIPAL, "TEST_ONLY_MOCK");
    await assert.rejects(conflictCore.startGeneration({ ...input, parameters: { prompt: "different request" } }),
      (error: unknown) => error instanceof ApplicationError && error.code === "IDEMPOTENCY_CONFLICT");
  }
  assert.equal(consumptions, 1, "a durably accepted start must not consume its one-shot approval again");
  assert.equal(authLookups, 1, "durable replay must finish before resolving provider credentials");
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.startImage, 1);
  assert.equal(chatClient.calls.getMessage, 0);
});

test("DEBT-047 R1: reconciliation returns a concurrently persisted acceptance", async (t) => {
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const chatClient = new FakeChatClient({ failStartMedia: true });
  const { adapter, store } = makeAdapter(chatClient);
  t.after(() => store.close());
  const context = {
    principal: PRINCIPAL, idempotency_key: "reconcile_concurrent_receipt",
    confirmation_id: "confirm_concurrent_receipt", approved_max_cost_tokens: 1
  };
  await assert.rejects(adapter.startGeneration(context, imageRequest()));
  const transition = store.transition.bind(store);
  let raced = false;
  store.transition = (input) => {
    if (!raced && input.to_state === "TERMINAL_UNRESOLVED") {
      raced = true;
      transition({ ...input, to_state: "PROVIDER_ACCEPTED", failure_code: null,
        receipt: { chat_uuid: "chat_test_001", message_id: "message_test_001",
          provider_job_id: null, message_object_id: null } });
    }
    return transition(input);
  };
  const result = await adapter.reconcileStart({
    principal: PRINCIPAL, idempotency_key: context.idempotency_key,
    request_hash: hashGenerationRequest(imageRequest())
  });
  assert.ok(raced);
  assert.equal(result?.id, store.getByIdempotencyKey(owner, context.idempotency_key)?.id);
  assert.equal(result?.status, "queued");
  assert.equal(chatClient.calls.startImage, 1);
});

test("DEBT-047 R1: unknown chat creation is an explicit read-only status error", async (t) => {
  const chatClient = new FakeChatClient({ failCreateChat: true });
  const { adapter, store } = makeAdapter(chatClient);
  t.after(() => store.close());
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  await assert.rejects(adapter.startGeneration({
    principal: PRINCIPAL, idempotency_key: "chat_unknown_status",
    confirmation_id: "confirm_chat_unknown_status", approved_max_cost_tokens: 1
  }, imageRequest()));
  const record = store.getByIdempotencyKey(owner, "chat_unknown_status")!;
  await assert.rejects(adapter.getJob({ principal: PRINCIPAL, job_id: record.id }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "UPSTREAM_OUTCOME_UNKNOWN");
      assert.deepEqual(error.details, { operation_id: record.id, state: "CHAT_CREATE_OUTCOME_UNKNOWN" });
      return true;
    });
  assert.deepEqual(store.getById(owner, record.id), record);
  assert.equal(chatClient.calls.createChat, 1);
  assert.equal(chatClient.calls.getMessage, 0);
  assert.equal(chatClient.calls.startImage, 0);
});

for (const invalidReceipt of ["null_message", "missing_message", "wrong_chat"] as const) {
  test(`DEBT-047: ${invalidReceipt} cannot be attributed as accepted`, async (t) => {
    const chatClient = new FakeChatClient();
    const { adapter, store } = makeAdapter(chatClient);
    t.after(() => store.close());
    const originalStart = chatClient.startImage.bind(chatClient);
    chatClient.startImage = async (request) => {
      const receipt = await originalStart(request);
      if (invalidReceipt === "wrong_chat") return { ...receipt, chat_uuid: "chat_other_002" };
      return { ...receipt, message_id: (invalidReceipt === "null_message" ? null : undefined) as unknown as string };
    };
    const context = {
      principal: PRINCIPAL, idempotency_key: `receipt_invalid_${invalidReceipt}`,
      confirmation_id: `confirm_invalid_${invalidReceipt}`, approved_max_cost_tokens: 1
    };
    await assert.rejects(adapter.startGeneration(context, imageRequest()),
      (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
    const record = store.getByIdempotencyKey({ tenant_id: TENANT_ID, subject_id: TENANT_ID }, context.idempotency_key);
    assert.equal(record?.state, "GENERATION_DISPATCHING");
    assert.equal(record?.receipt?.message_id, null);
    assert.equal(chatClient.calls.startImage, 1);
  });
}

for (const winner of ["same_receipt", "different_receipt", "terminal"] as const) {
  test(`DEBT-047: concurrent ${winner} is not overwritten or dispatched again`, async (t) => {
    const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
    const chatClient = new FakeChatClient();
    const { adapter, store } = makeAdapter(chatClient);
    t.after(() => store.close());
    const context = {
      principal: PRINCIPAL, idempotency_key: `receipt_winner_${winner}`,
      confirmation_id: `confirm_winner_${winner}`, approved_max_cost_tokens: 1
    };
    const transition = store.transition.bind(store);
    let raced = false;
    store.transition = (input) => {
      if (!raced && input.to_state === "PROVIDER_ACCEPTED") {
        raced = true;
        const recovered = store.recoverInterruptedOperations().records[0]!;
        const claim = transition({
          owner, id: input.id, expected_revision: recovered.revision,
          to_state: winner === "terminal" ? "TERMINAL_UNRESOLVED" : "GENERATION_RECONCILING",
          updated_at: new Date().toISOString(),
          ...(winner === "terminal" ? { failure_code: "GENERATION_DISPATCH_UNRECONCILABLE" } : {})
        });
        if (winner !== "terminal") {
          transition({ owner, id: input.id, expected_revision: claim.revision,
            to_state: "PROVIDER_ACCEPTED", updated_at: new Date().toISOString(),
            receipt: {
              chat_uuid: "chat_test_001", provider_job_id: null,
              message_id: winner === "same_receipt" ? "message_test_001" : "message_other_002",
              message_object_id: null
            }
          });
        }
      }
      return transition(input);
    };
    if (winner === "same_receipt") {
      assert.equal((await adapter.startGeneration(context, imageRequest())).status, "queued");
    } else {
      await assert.rejects(adapter.startGeneration(context, imageRequest()),
        (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
    }
    assert.ok(raced);
    const record = store.getByIdempotencyKey(owner, context.idempotency_key);
    assert.equal(record?.state, winner === "terminal" ? "TERMINAL_UNRESOLVED" : "PROVIDER_ACCEPTED");
    assert.equal(record?.receipt?.message_id,
      winner === "terminal" ? null : winner === "same_receipt" ? "message_test_001" : "message_other_002");
    assert.equal(chatClient.calls.startImage, 1);
  });
}

test("REGRESSION: concurrent generation polling cannot discard a cancellation ACK", async () => {
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  let fired = false;
  const chatClient = new FakeChatClient();
  const { store, adapter } = makeAdapter(chatClient);
  const context = {
    principal: PRINCIPAL,
    idempotency_key: "idem_race_002",
    confirmation_id: "confirmation_race_002",
    approved_max_cost_tokens: 10
  };
  const started = await adapter.startGeneration(context, imageRequest());

  const originalCancel = chatClient.cancelMessage.bind(chatClient);
  chatClient.cancelMessage = async () => {
    const ack = await originalCancel();
    const record = store.getById(owner, started.id)!;
    assert.equal(store.getCancelAttempt(owner, started.id)?.state, "DISPATCHING");
    store.transition({
      owner, id: record.id, expected_revision: record.revision,
      to_state: "QUEUED", updated_at: new Date().toISOString()
    });
    fired = true;
    return ack;
  };
  const result = await adapter.cancelJob({
      principal: PRINCIPAL,
      job_id: started.id,
      idempotency_key: "cancel_idem_race_002",
      confirmation_id: "cancel_confirmation_race_002"
  });
  assert.ok(fired, "the race hook must actually have fired");
  assert.equal(chatClient.calls.cancelMessage, 1);
  assert.equal(result.status, "queued");
  assert.equal(store.getCancelAttempt(owner, started.id)?.state, "ACKNOWLEDGED");
  const record = store.getByIdempotencyKey(owner, "idem_race_002");
  assert.equal(record?.state, "QUEUED");
});

test("an ambiguous cancellation durably blocks both same-key and new-key repeat POST", async (t) => {
  const chatClient = new FakeChatClient();
  const { store, adapter } = makeAdapter(chatClient);
  t.after(() => store.close());
  const job = await adapter.startGeneration({
    principal: PRINCIPAL, idempotency_key: "start_cancel_unknown",
    confirmation_id: "confirm_start_unknown", approved_max_cost_tokens: 1
  }, imageRequest());
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const before = store.getById(owner, job.id);
  chatClient.cancelMessage = async () => {
    chatClient.calls.cancelMessage++;
    assert.equal(store.getCancelAttempt(owner, job.id)?.state, "DISPATCHING");
    throw new Error("private upstream diagnostic must not escape");
  };
  const context = {
    principal: PRINCIPAL, job_id: job.id,
    idempotency_key: "cancel_unknown", confirmation_id: "confirm_cancel_unknown"
  };
  for (const action of [() => adapter.cancelJob(context), () => adapter.cancelJob(context), () => adapter.reconcileCancel(context)]) {
    await assert.rejects(action(), (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "UPSTREAM_OUTCOME_UNKNOWN");
      assert.equal(JSON.stringify(error).includes("private upstream"), false);
      return true;
    });
  }
  await assert.rejects(adapter.cancelJob({ ...context, idempotency_key: "cancel_unknown_other" }),
    (error: unknown) => error instanceof ApplicationError && error.code === "JOB_NOT_CANCELABLE");
  assert.equal(chatClient.calls.cancelMessage, 1);
  assert.equal(store.getCancelAttempt(owner, job.id)?.state, "OUTCOME_UNKNOWN");
  assert.deepEqual(store.getById(owner, job.id), before);
  chatClient.setNextMessage({ chat_uuid: "chat_test_001", message_id: "message_test_001", artifacts: [artifact()] });
  assert.equal((await adapter.getJob({ principal: PRINCIPAL, job_id: job.id })).status, "succeeded");
  assert.equal((await adapter.reconcileCancel(context))?.status, "succeeded");
  assert.equal(chatClient.calls.cancelMessage, 1);
});

test("a concurrent cancellation caller cannot pass the durable claim winner", async (t) => {
  const chatClient = new FakeChatClient();
  const { store, adapter } = makeAdapter(chatClient);
  t.after(() => store.close());
  const second = new SyntxUpstreamAdapter({
    transactionStore: store, resolveChatClient: () => chatClient,
    resolveAiName: () => "banana", resolveModality: () => "image"
  });
  const job = await adapter.startGeneration({
    principal: PRINCIPAL, idempotency_key: "start_cancel_race",
    confirmation_id: "confirm_start_race", approved_max_cost_tokens: 1
  }, imageRequest());
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  chatClient.cancelMessage = async () => {
    chatClient.calls.cancelMessage++;
    enter();
    await released;
    return { chat_uuid: "chat_test_001", message_id: "message_test_001", accepted: true };
  };
  const context = {
    principal: PRINCIPAL, job_id: job.id,
    idempotency_key: "cancel_race", confirmation_id: "confirm_cancel_race"
  };
  const first = adapter.cancelJob(context);
  await entered;
  try {
    await assert.rejects(second.cancelJob(context),
      (error: unknown) => error instanceof ApplicationError && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
    await assert.rejects(second.cancelJob({ ...context, idempotency_key: "another_cancel_race" }),
      (error: unknown) => error instanceof ApplicationError && error.code === "JOB_NOT_CANCELABLE");
  } finally { release(); }
  assert.equal((await first).status, "queued");
  assert.equal((await second.cancelJob(context)).status, "queued");
  assert.equal(chatClient.calls.cancelMessage, 1);
});

test("the original cancel ACK survives startup recovery without generation failure", async (t) => {
  const chatClient = new FakeChatClient();
  const { store, adapter } = makeAdapter(chatClient);
  t.after(() => store.close());
  const job = await adapter.startGeneration({
    principal: PRINCIPAL, idempotency_key: "start_cancel_recovery",
    confirmation_id: "confirm_start_recovery", approved_max_cost_tokens: 1
  }, imageRequest());
  const owner = { tenant_id: TENANT_ID, subject_id: TENANT_ID };
  const before = store.getById(owner, job.id);
  const originalCancel = chatClient.cancelMessage.bind(chatClient);
  chatClient.cancelMessage = async () => {
    const ack = await originalCancel();
    store.recoverInterruptedCancelAttempts();
    assert.equal(store.getCancelAttempt(owner, job.id)?.state, "OUTCOME_UNKNOWN");
    return ack;
  };
  await adapter.cancelJob({
    principal: PRINCIPAL, job_id: job.id,
    idempotency_key: "cancel_recovery", confirmation_id: "confirm_cancel_recovery"
  });
  assert.equal(store.getCancelAttempt(owner, job.id)?.state, "ACKNOWLEDGED");
  assert.deepEqual(store.getById(owner, job.id), before);
  assert.equal(chatClient.calls.cancelMessage, 1);
});
