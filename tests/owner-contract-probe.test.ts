import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { GenerationContractExecutorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import { OwnerContractMediaError, OwnerContractMediaService, type OwnerContractMediaClient, type OwnerContractMediaContractContext } from "../src/application/owner-contract-media.js";
import type { ChatMessageHistorySnapshot } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerContractMediaRecoveryStore } from "../src/application/owner-contract-media-recovery.js";
import { createOwnerReviewedContractProbePolicy, getOwnerReviewedContractProbeBinding, getOwnerReviewedContractProbeContract, OwnerContractProbePolicyError, prepareOwnerReviewedContractProbe, type OwnerReviewedContractProbePolicy } from "../src/application/owner-contract-probe-policy.js";
import { registerSyntxOwnerContractProbeTool, SYNTX_OWNER_CONTRACT_PROBE_RECONCILE_TOOL_NAME, SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME } from "../src/mcp/owner-contract-probe-tool.js";
import { createMcpServer } from "../src/mcp/server.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const REGISTRY_VERSION = "sha256-075b0789c11c9fef6efd241ba51386e22eb6116f18b2870c04af5a78a0b850ac.json";
const ATTEMPT = "link_owner_probe_test_attempt01";
const PROMPT = "A simple blue square on a plain white background.";

function reviewedContractFixture() {
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const executor = new GenerationContractExecutorV2(registry, catalog);
  const contract = executor.getContract("banana", "generate-image", "legacy-image-banana-default");
  assert.ok(contract);
  assert.equal(contract.status, "reviewed");
  const prepared = executor.prepare({
    model_id: contract.model_id,
    operation_id: contract.operation_id,
    catalog_version: registry.catalog_version,
    variant_id: contract.variant_id,
    parameters: { prompt: PROMPT }
  });
  const context: OwnerContractMediaContractContext = {
    model_id: contract.model_id,
    operation_id: "generate-image",
    modality: "image",
    ai_name: contract.ai_name,
    model_type: contract.model_type,
    variant_id: contract.variant_id,
    schema_hash: contract.schema_hash,
    status: contract.status,
    mime_types: contract.output.mime_types
  };
  return { registry, catalog, executor, contract, prepared, context };
}

function fakeClient(calls: string[]): OwnerContractMediaClient {
  return {
    async createChat() { calls.push("createChat"); return { chat_uuid: "probe-chat" }; },
    async startImage() { calls.push("startImage"); return { chat_uuid: "probe-chat", message_id: "echo" }; },
    async startVideo() { calls.push("startVideo"); return { chat_uuid: "probe-chat", message_id: "echo" }; },
    async listInProgress() { return []; },
    async getMessage(chat_uuid, message_id) { return { chat_uuid, message_id, object_type: "image", model_type: "banana", artifacts: [] }; }
  };
}

function probeClient(calls: string[], rejectStart = false): OwnerContractMediaClient {
  return {
    async createChat(scope) { calls.push(`createChat:${scope}`); return { chat_uuid: "probe-private-chat" }; },
    async startImage(request) {
      calls.push("startImage");
      if (rejectStart) throw new Error("private upstream failure with chat probe-private-chat");
      return { chat_uuid: request.chat_uuid, message_id: "echo" };
    },
    async startVideo(request) { calls.push("startVideo"); return { chat_uuid: request.chat_id, message_id: "echo" }; },
    async listInProgress(_chatUuid) { calls.push("listInProgress"); return [{ message_id: "bot-message", message_object_id: "object", object_type: "image", model_type: "banana" }]; },
    async getMessage(chatUuid, messageId) {
      calls.push(`getMessage:${messageId}`);
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana", artifacts: [{ url: "https://r2.syntx.ai/probe.png", mime_type: "image/png" }] };
    }
  };
}

function registerProbe(
  server: Parameters<typeof registerSyntxOwnerContractProbeTool>[0],
  policy: OwnerReviewedContractProbePolicy,
  calls: string[],
  client: OwnerContractMediaClient,
  modelAccess: boolean | null = true,
  planType = "Elite",
  serviceOptions: { imageTimeoutMs?: number; wait?: (milliseconds: number) => Promise<void> } = {}
): OwnerContractMediaRecoveryStore {
  const recoveryStore = new OwnerContractMediaRecoveryStore();
  registerSyntxOwnerContractProbeTool(server, {
    policy,
    service: new OwnerContractMediaService({ recoveryStore, ...serviceOptions, wait: serviceOptions.wait ?? (async () => undefined) }),
    resolveSubscription: async () => {
      calls.push("subscription");
      return { active: true, plan_type: planType, end_date: null, end_date_kind: null };
    },
    resolveModelAccess: async (attemptId, modelId) => {
      calls.push("model-access");
      const binding = getOwnerReviewedContractProbeBinding(policy)!;
      assert.equal(attemptId, binding.attempt_id);
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: binding.catalog_version,
        model_id: modelId,
        ai_name: binding.ai_name,
        model_type: binding.model_type,
        account_read_live: true,
        parameter_keys: [],
        parameters_redacted: true,
        access: modelAccess,
        cost: null,
        discount_cost: null,
        free_remaining_generations: null,
        limit: null,
        show_warning: null,
        observed_at: new Date().toISOString()
      };
    },
    resolveChatClient: (attemptId) => {
      calls.push(`resolve-client:${attemptId}`);
      return client;
    }
  });
  return recoveryStore;
}

async function withMcpClient(server: McpServer, run: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "owner-probe-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); }
  finally { await client.close(); await server.close(); }
}

function createProbePolicy(expiresInMs?: number): OwnerReviewedContractProbePolicy {
  return createOwnerReviewedContractProbePolicy({
    registryVersion: REGISTRY_VERSION,
    attemptId: ATTEMPT,
    modelId: "banana",
    operationId: "generate-image",
    variantId: "legacy-image-banana-default",
    schemaHash: "sha256:e227750458c935d7b8a7ce1eff809f87f8bed5a1acd52246ae51121e660de4ed",
    parameters: { prompt: PROMPT },
    ...(expiresInMs === undefined ? {} : { expiresInMs })
  });
}

test("reviewed contracts remain denied by generic owner service and recovery store without an explicit probe policy", async () => {
  const fixture = reviewedContractFixture();
  const calls: string[] = [];
  const store = new OwnerContractMediaRecoveryStore();
  const service = new OwnerContractMediaService({ recoveryStore: store, wait: async () => undefined });
  await assert.rejects(service.generate({
    client: fakeClient(calls),
    attemptId: ATTEMPT,
    contract: fixture.context,
    prepared: fixture.prepared
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH");
  const policy = createProbePolicy();
  await assert.rejects(service.generate({
    client: fakeClient(calls),
    attemptId: "link_foreign_probe_attempt01",
    contract: fixture.context,
    prepared: fixture.prepared,
    probePolicy: policy
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH");
  assert.deepEqual(calls, []);
  assert.throws(() => store.create({
    attemptId: ATTEMPT,
    chatUuid: "probe-chat",
    messageId: null,
    contract: fixture.context
  }), /OWNER_CONTRACT_MEDIA_RECOVERY_CONTRACT_INVALID/u);
  assert.throws(() => store.create({
    attemptId: ATTEMPT,
    chatUuid: "probe-chat",
    messageId: null,
    contract: fixture.context,
    probePolicy: policy
  }), /OWNER_CONTRACT_MEDIA_RECOVERY_CONTRACT_INVALID/u);
});

test("operator probe factory binds one reviewed tuple and orders prepare, subscription, then current model access", async () => {
  const policy = createProbePolicy();
  const binding = getOwnerReviewedContractProbeBinding(policy);
  assert.deepEqual({
    attempt_id: binding?.attempt_id,
    model_id: binding?.model_id,
    operation_id: binding?.operation_id,
    variant_id: binding?.variant_id,
    schema_hash: binding?.schema_hash,
    status: binding?.status
  }, {
    attempt_id: ATTEMPT,
    model_id: "banana",
    operation_id: "generate-image",
    variant_id: "legacy-image-banana-default",
    schema_hash: "sha256:e227750458c935d7b8a7ce1eff809f87f8bed5a1acd52246ae51121e660de4ed",
    status: "reviewed"
  });
  const calls: string[] = [];
  const prepared = await prepareOwnerReviewedContractProbe(
    policy,
    ATTEMPT,
    async () => {
      calls.push("subscription");
      return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null };
    },
    async (_attemptId, modelId) => {
      calls.push("model-access");
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: binding!.catalog_version,
        model_id: modelId,
        ai_name: "banana",
        model_type: "banana",
        account_read_live: true,
        parameter_keys: [],
        parameters_redacted: true,
        access: true,
        cost: null,
        discount_cost: null,
        free_remaining_generations: null,
        limit: null,
        show_warning: null,
        observed_at: new Date().toISOString()
      };
    }
  );
  assert.deepEqual(calls, ["subscription", "model-access"]);
  assert.equal(prepared.prompt, PROMPT);
  assert.equal(prepared.schema_hash, binding?.schema_hash);
});

test("forged, foreign-attempt, and expired reviewed probe policies fail before reads", async () => {
  const policy = createProbePolicy();
  const expired = createProbePolicy(1);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const calls: string[] = [];
  const reads = async () => { calls.push("read"); return { active: true, plan_type: "Elite", end_date: null, end_date_kind: null }; };
  await assert.rejects(prepareOwnerReviewedContractProbe({} as OwnerReviewedContractProbePolicy, ATTEMPT, reads, async () => { throw new Error("not called"); }),
    (error: unknown) => error instanceof OwnerContractProbePolicyError && error.code === "PROBE_AUTHORIZATION_UNAVAILABLE");
  await assert.rejects(prepareOwnerReviewedContractProbe(policy, "link_foreign_probe_attempt01", reads, async () => { throw new Error("not called"); }),
    (error: unknown) => error instanceof OwnerContractProbePolicyError && error.code === "PROBE_AUTHORIZATION_UNAVAILABLE");
  await assert.rejects(prepareOwnerReviewedContractProbe(expired, ATTEMPT, reads, async () => { throw new Error("not called"); }),
    (error: unknown) => error instanceof OwnerContractProbePolicyError && error.code === "PROBE_AUTHORIZATION_UNAVAILABLE");
  assert.deepEqual(calls, []);
  assert.throws(() => createOwnerReviewedContractProbePolicy({
    registryVersion: REGISTRY_VERSION,
    attemptId: ATTEMPT,
    modelId: "banana",
    operationId: "generate-image",
    variantId: "legacy-image-banana-default",
    schemaHash: "sha256:" + "0".repeat(64),
    parameters: { prompt: PROMPT }
  }), (error: unknown) => error instanceof OwnerContractProbePolicyError);
  assert.throws(() => createOwnerReviewedContractProbePolicy({
    registryVersion: REGISTRY_VERSION,
    attemptId: ATTEMPT,
    modelId: "banana-2.1",
    operationId: "generate-image",
    variantId: "banana21-image-1k-minimal-square",
    schemaHash: "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d",
    parameters: { prompt: PROMPT, file_urls: [] }
  }), (error: unknown) => error instanceof OwnerContractProbePolicyError && error.code === "PROBE_CONTRACT_NOT_REVIEWED");
});

test("Ideogram landscape reviewed policy accepts only the frozen 16:9 owner case", () => {
  const landscapeInput = {
    registryVersion: "sha256-a4d42d4b977836face88a757a5632cc6096997b37e3749b7a31a80cb24cdfa2e.json",
    attemptId: ATTEMPT,
    modelId: "ideogram",
    operationId: "generate-image" as const,
    variantId: "ideogram-image-generate-aspect-ratio-source-reviewed",
    schemaHash: "sha256:31e1603ba0668f57860b1d688b7c74bd3b8c54da117180a779f67f4a6363320c",
    parameters: { prompt: "A quiet rolling green landscape at golden hour, distant blue hills beneath a wide open sky, simple watercolor illustration, no text.", aspect_ratio: "16:9" }
  };
  const policy = createOwnerReviewedContractProbePolicy(landscapeInput);
  assert.equal(getOwnerReviewedContractProbeBinding(policy)?.variant_id, landscapeInput.variantId);
  assert.throws(() => createOwnerReviewedContractProbePolicy({
    ...landscapeInput, parameters: { ...landscapeInput.parameters, aspect_ratio: "1:1" }
  }), (error: unknown) => error instanceof OwnerContractProbePolicyError && error.code === "PROBE_CONTRACT_NOT_REVIEWED");
  assert.throws(() => createOwnerReviewedContractProbePolicy({
    ...landscapeInput, parameters: { ...landscapeInput.parameters, prompt: "A different owner prompt." }
  }), (error: unknown) => error instanceof OwnerContractProbePolicyError && error.code === "PROBE_CONTRACT_NOT_REVIEWED");
});

test("factory permit reaches one exact reviewed service dispatch and leaves status reviewed", async () => {
  const policy = createProbePolicy();
  const binding = getOwnerReviewedContractProbeBinding(policy)!;
  const prepared = await prepareOwnerReviewedContractProbe(
    policy,
    ATTEMPT,
    async () => ({ active: true, plan_type: "Elite", end_date: null, end_date_kind: null }),
    async () => ({
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: binding.catalog_version,
      model_id: binding.model_id,
      ai_name: binding.ai_name,
      model_type: binding.model_type,
      account_read_live: true,
      parameter_keys: [],
      parameters_redacted: true,
      access: true,
      cost: null,
      discount_cost: null,
      free_remaining_generations: null,
      limit: null,
      show_warning: null,
      observed_at: new Date().toISOString()
    })
  );
  const calls: string[] = [];
  const store = new OwnerContractMediaRecoveryStore();
  const service = new OwnerContractMediaService({ recoveryStore: store, wait: async () => undefined });
  const client: OwnerContractMediaClient = {
    async createChat() { calls.push("createChat"); return { chat_uuid: "probe-chat" }; },
    async startImage(request) { calls.push("startImage"); return { chat_uuid: request.chat_uuid, message_id: "echo" }; },
    async startVideo() { calls.push("unexpected-video"); return { chat_uuid: "probe-chat", message_id: "echo" }; },
    async listInProgress() { calls.push("list"); return []; },
    async getMessage(chat_uuid, message_id) {
      calls.push("get");
      return { chat_uuid, message_id, object_type: "image", model_type: "banana", artifacts: [{ url: "https://r2.syntx.ai/probe.png", mime_type: "image/png" }] };
    }
  };
  const result = await service.generate({
    client,
    attemptId: ATTEMPT,
    contract: getOwnerReviewedContractProbeContract(policy)!,
    prepared,
    probePolicy: policy
  } as never);
  assert.equal(result.model_id, "banana");
  assert.equal(result.operation_id, "generate-image");
  assert.deepEqual(result.artifacts, [{ url: "https://r2.syntx.ai/probe.png", mime_type: "image/png" }]);
  assert.deepEqual(calls, ["createChat", "startImage", "get"]);
  assert.equal(store.size(), 0);
});

test("default MCP surface does not register the reviewed probe", async () => {
  const server = createMcpServer(createDefaultApplication());
  await withMcpClient(server, async (client) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes(SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME), false);
    assert.equal(names.includes(SYNTX_OWNER_CONTRACT_PROBE_RECONCILE_TOOL_NAME), false);
  });
});

test("explicit operator registration exposes only attempt id, preflights, and returns reviewed scope without prompt", async () => {
  const policy = createProbePolicy();
  const calls: string[] = [];
  const server = new McpServer({ name: "explicit-owner-probe", version: "1" });
  const store = registerProbe(server, policy, calls, probeClient(calls));
  await withMcpClient(server, async (client) => {
    const tool = (await client.listTools()).tools.find((candidate) => candidate.name === SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME);
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ["link_attempt_id"]);
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ["link_attempt_id"]);

    const extraChoice = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, model_id: "other-model" } });
    assert.equal(extraChoice.isError, true);
    assert.deepEqual(calls, []);

    const result = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, undefined);
    const output = result.structuredContent as Record<string, unknown>;
    assert.deepEqual({ model_id: output.model_id, operation_id: output.operation_id, variant_id: output.variant_id, status: output.status, confidence_scope: output.confidence_scope }, {
      model_id: "banana", operation_id: "generate-image", variant_id: "legacy-image-banana-default", status: "reviewed", confidence_scope: "exact_result_only"
    });
    assert.equal(JSON.stringify(result).includes(PROMPT), false);
    assert.equal(JSON.stringify(result).includes("live_verified"), false);
    assert.deepEqual(calls, ["subscription", "model-access", `resolve-client:${ATTEMPT}`, "createChat:image", "startImage", "getMessage:echo"]);
    assert.equal(store.size(), 0);

    const replay = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(replay.isError, true);
    assert.deepEqual(calls, ["subscription", "model-access", `resolve-client:${ATTEMPT}`, "createChat:image", "startImage", "getMessage:echo"]);
  });
});

test("false fresh model access denies the probe before resolving a chat client", async () => {
  const policy = createProbePolicy();
  const calls: string[] = [];
  const server = new McpServer({ name: "owner-probe-access-denied", version: "1" });
  registerProbe(server, policy, calls, probeClient(calls), false);
  await withMcpClient(server, async (client) => {
    const result = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, true);
    assert.deepEqual(calls, ["subscription", "model-access"]);
  });
});

test("FREE subscription denies the probe before model-access lookup or chat resolution", async () => {
  const policy = createProbePolicy();
  const calls: string[] = [];
  const server = new McpServer({ name: "owner-probe-subscription-denied", version: "1" });
  registerProbe(server, policy, calls, probeClient(calls), true, "FREE");
  await withMcpClient(server, async (client) => {
    const result = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(result.isError, true);
    assert.deepEqual(calls, ["subscription"]);
  });
});

test("two concurrent calls with one trusted permit produce at most one chat and one paid dispatch", async () => {
  const policy = createProbePolicy();
  const calls: string[] = [];
  const server = new McpServer({ name: "owner-probe-race", version: "1" });
  registerProbe(server, policy, calls, probeClient(calls));
  await withMcpClient(server, async (client) => {
    const [first, second] = await Promise.all([
      client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } }),
      client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } })
    ]);
    assert.equal([first, second].filter((result) => result.isError === undefined).length, 1);
    assert.equal([first, second].filter((result) => result.isError === true).length, 1);
    assert.equal(calls.filter((call) => call.startsWith("createChat:")).length, 1);
    assert.equal(calls.filter((call) => call === "startImage").length, 1);
  });
});

test("unknown probe outcome cannot retry and uses only GET recovery for the same attempt", async () => {
  const policy = createProbePolicy();
  const calls: string[] = [];
  const server = new McpServer({ name: "owner-probe-recovery", version: "1" });
  const store = registerProbe(server, policy, calls, probeClient(calls, true));
  await withMcpClient(server, async (client) => {
    const unknown = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(unknown.isError, true);
    const payload = JSON.parse((unknown.content as { text: string }[])[0]!.text) as { error: { code: string; recovery_id: string } };
    assert.equal(payload.error.code, "OUTCOME_UNKNOWN");
    assert.match(payload.error.recovery_id, /^recovery_[0-9a-f-]{36}$/u);
    assert.equal(JSON.stringify(unknown).includes(PROMPT), false);
    assert.equal(JSON.stringify(unknown).includes("probe-private-chat"), false);
    assert.equal(JSON.stringify(unknown).includes("private upstream failure"), false);
    const recovery = store.get(payload.error.recovery_id, ATTEMPT);
    assert.equal(recovery?.status, "reviewed");
    assert.equal(recovery?.registry_version, REGISTRY_VERSION);
    assert.equal(recovery?.catalog_version, getOwnerReviewedContractProbeBinding(policy)?.catalog_version);

    const retry = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(retry.isError, true);
    assert.equal(calls.filter((call) => call === "startImage").length, 1);

    const recovered = await client.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_RECONCILE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT, recovery_id: payload.error.recovery_id } });
    assert.equal(recovered.isError, undefined);
    assert.equal((recovered.structuredContent as Record<string, unknown>).status, "reviewed");
    assert.equal(calls.filter((call) => call === "startImage").length, 1);
    assert.equal(calls.filter((call) => call === "listInProgress").length, 1);
    assert.equal(calls.filter((call) => call.startsWith("getMessage:")).length, 1);
  });
});

test("probe GET-only reconciliation forwards bounded history for a known ACK and never dispatches again", async () => {
  const fixture = reviewedContractFixture();
  const policy = createProbePolicy();
  const calls: string[] = [];
  const ownerOnly: ChatMessageHistorySnapshot = {
    complete: true, page: 1, page_size: 10, total_count: 1, total_pages: 1,
    has_next: false, has_previous: false, provider_chat_id: "412",
    messages: [{ message_id: "echo", provider_chat_id: "412", author_role: "owner", objects: [] }]
  };
  const completed: ChatMessageHistorySnapshot = {
    ...ownerOnly,
    total_count: 2,
    messages: [
      ownerOnly.messages[0]!,
      { message_id: "completed-image", provider_chat_id: "412", author_role: "bot", objects: [
        { message_object_id: "completed-image-object", object_type: "image", model_type: fixture.context.model_type }
      ] }
    ]
  };
  let historyReads = 0;
  const client: OwnerContractMediaClient = {
    async createChat(scope) { calls.push(`createChat:${scope}`); return { chat_uuid: "probe-private-chat" }; },
    async startImage(request) { calls.push("startImage"); return { chat_uuid: request.chat_uuid, message_id: "echo" }; },
    async startVideo(request) { calls.push("startVideo"); return { chat_uuid: request.chat_id, message_id: "echo" }; },
    async listInProgress() { calls.push("listInProgress"); return []; },
    async listMessageCandidates(chatUuid, echoId) {
      calls.push(`history:${chatUuid}:${echoId}`);
      return ++historyReads === 1 ? ownerOnly : completed;
    },
    async getMessage(chatUuid, messageId) {
      calls.push(`getMessage:${messageId}`);
      return {
        chat_uuid: chatUuid, message_id: messageId,
        object_type: messageId === "echo" ? "text" : "image",
        model_type: fixture.context.model_type,
        artifacts: messageId === "completed-image" ? [{
          url: "https://r2.syntx.ai/probe/fast-image.png", mime_type: fixture.context.mime_types[0]!
        }] : []
      };
    }
  };
  const server = new McpServer({ name: "owner-probe-history", version: "1" });
  const store = registerProbe(server, policy, calls, client, true, "Elite", {
    imageTimeoutMs: 15, wait: async () => undefined
  });

  await withMcpClient(server, async (mcpClient) => {
    const unknown = await mcpClient.callTool({ name: SYNTX_OWNER_CONTRACT_PROBE_TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(unknown.isError, true);
    const payload = JSON.parse((unknown.content as { text: string }[])[0]!.text) as { error: { code: string; recovery_id: string } };
    assert.equal(payload.error.code, "OUTCOME_UNKNOWN");
    assert.equal(store.get(payload.error.recovery_id, ATTEMPT)?.message_id, "echo");

    const recovered = await mcpClient.callTool({
      name: SYNTX_OWNER_CONTRACT_PROBE_RECONCILE_TOOL_NAME,
      arguments: { link_attempt_id: ATTEMPT, recovery_id: payload.error.recovery_id }
    });
    assert.equal(recovered.isError, undefined);
    assert.deepEqual((recovered.structuredContent as { artifacts: unknown[] }).artifacts, [{
      url: "https://r2.syntx.ai/probe/fast-image.png", mime_type: fixture.context.mime_types[0]
    }]);
    assert.equal(calls.filter((call) => call === "startImage").length, 1);
    assert.equal(calls.filter((call) => call.startsWith("history:")).length, 2);
    assert.equal(calls.filter((call) => call === "getMessage:completed-image").length, 1);
    assert.ok(!calls.some((call) => /cancel|delete/iu.test(call)));
  });
});
