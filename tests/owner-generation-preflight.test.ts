import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerGenerationPreflight,
  OwnerGenerationPreflightError,
  type OwnerGenerationPreflightCatalogPort
} from "../src/application/owner-generation-preflight.js";
import { SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import type { OwnerGenerationPreflight } from "../src/application/owner-generation-preflight.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME, type RegisterSyntxOwnerGenerateImageToolOptions } from "../src/mcp/owner-generate-image-tool.js";
import { SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, type RegisterSyntxOwnerGenerateVideoToolOptions } from "../src/mcp/owner-generate-video-tool.js";
import { SYNTX_OWNER_RECONCILE_VIDEO_TOOL_NAME } from "../src/mcp/owner-generate-video-tool.js";
import { OwnerVideoRecoveryStore } from "../src/application/owner-video-recovery.js";
import type { OwnerVideoChatClient } from "../src/application/owner-generate-video.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const paidActiveSubscription = {
  active: true,
  plan_type: "Elite",
  end_date: null,
  end_date_kind: null
} as const;

function activeBananaCatalog(): OwnerGenerationPreflightCatalogPort {
  return {
    getModel(modelId) {
      if (modelId !== "banana") throw new Error("MODEL_NOT_FOUND");
      return {
        id: "banana",
        active: true,
        ai_name: "banana",
        operations: [{ id: "generate-image", output_modality: "image" }]
      };
    }
  };
}

test("owner preflight allows only a supported active model with a verified paid subscription", async () => {
  const calls: string[] = [];
  const preflight = createOwnerGenerationPreflight({
    catalog: activeBananaCatalog(),
    resolveSubscription: async (attemptId) => {
      calls.push(attemptId);
      return paidActiveSubscription;
    }
  });
  await preflight("link_exact_attempt", "banana");
  assert.deepEqual(calls, ["link_exact_attempt"]);
});

test("owner preflight blocks an inactive or FREE subscription", async () => {
  for (const subscription of [
    { ...paidActiveSubscription, active: false },
    { ...paidActiveSubscription, active: false, plan_type: null },
    { ...paidActiveSubscription, plan_type: "FREE" },
    { ...paidActiveSubscription, active: true, plan_type: " free " }
  ]) {
    const preflight = createOwnerGenerationPreflight({
      catalog: activeBananaCatalog(),
      resolveSubscription: async () => subscription
    });
    await assert.rejects(
      () => preflight("link_exact_attempt", "banana"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SUBSCRIPTION_REQUIRED"
    );
  }
});

test("owner preflight blocks unknown subscription status instead of assuming entitlement", async () => {
  for (const resolveSubscription of [
    async () => ({ active: null, plan_type: "Elite", end_date: null, end_date_kind: null }),
    async () => ({ active: true, plan_type: null, end_date: null, end_date_kind: null }),
    async () => { throw new Error("account read unavailable"); }
  ]) {
    const preflight = createOwnerGenerationPreflight({ catalog: activeBananaCatalog(), resolveSubscription });
    await assert.rejects(
      () => preflight("link_exact_attempt", "banana"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SUBSCRIPTION_STATUS_UNVERIFIED"
    );
  }
});

test("owner preflight preserves the linked-account requirement separately from unknown subscription status", async () => {
  const authRequired = new SyntxHttpError("AUTH_REQUIRED", "A linked SYNTX account is required.");
  const preflight = createOwnerGenerationPreflight({
    catalog: activeBananaCatalog(),
    resolveSubscription: async () => { throw authRequired; }
  });
  await assert.rejects(
    () => preflight("link_missing_attempt", "banana"),
    (error: unknown) => error === authRequired && error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED"
  );
});

test("owner preflight does not accept inherited or accessor subscription fields", async () => {
  let getterReads = 0;
  const inherited = Object.create({ active: true, plan_type: "Elite" }) as unknown;
  const accessor = Object.defineProperty({ plan_type: "Elite" }, "active", {
    enumerable: true,
    get() { getterReads += 1; return true; }
  });
  for (const subscription of [inherited, accessor]) {
    const preflight = createOwnerGenerationPreflight({
      catalog: activeBananaCatalog(),
      resolveSubscription: async () => subscription as SyntxSubscription
    });
    await assert.rejects(
      () => preflight("link_exact_attempt", "banana"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SUBSCRIPTION_STATUS_UNVERIFIED"
    );
  }
  assert.equal(getterReads, 0);
});

test("owner preflight canonicalizes the legacy Banana alias", async () => {
  const requested: string[] = [];
  const preflight = createOwnerGenerationPreflight({
    catalog: {
      getModel(modelId) {
        requested.push(modelId);
        return activeBananaCatalog().getModel(modelId);
      }
    },
    resolveSubscription: async () => paidActiveSubscription
  });
  await preflight("link_exact_attempt", "nano-banana-pro");
  assert.deepEqual(requested, ["banana"]);
});

test("owner preflight blocks inactive and removed models before account reads", async () => {
  let accountReads = 0;
  for (const catalog of [
    { getModel: () => ({ ...activeBananaCatalog().getModel("banana"), active: false }) },
    { getModel: () => { throw new Error("MODEL_NOT_FOUND"); } }
  ]) {
    const preflight = createOwnerGenerationPreflight({
      catalog,
      resolveSubscription: async () => { accountReads += 1; return paidActiveSubscription; }
    });
    await assert.rejects(
      () => preflight("link_exact_attempt", "banana"),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "MODEL_UNAVAILABLE"
    );
  }
  assert.equal(accountReads, 0);
});

test("owner image tool runs the preflight before resolving a chat client", async () => {
  let resolveCalls = 0;
  let preflightCalls = 0;
  const assertGenerationAllowed: OwnerGenerationPreflight = async (attemptId, modelId) => {
    assert.equal(attemptId, "link_exact_attempt_123456");
    assert.equal(modelId, "banana");
    preflightCalls += 1;
    throw new OwnerGenerationPreflightError("SUBSCRIPTION_REQUIRED");
  };
  const options = {
    resolveChatClient: () => { resolveCalls += 1; throw new Error("must not resolve"); },
    assertGenerationAllowed
  } as RegisterSyntxOwnerGenerateImageToolOptions & { assertGenerationAllowed: OwnerGenerationPreflight };
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateImage: options });
  const client = new Client({ name: "image-preflight-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_exact_attempt_123456", prompt: "a lighthouse"
    } });
    assert.equal(result.isError, true);
    assert.equal(preflightCalls, 1);
    assert.equal(resolveCalls, 0);
    const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as { error: { code: string } };
    assert.equal(payload.error.code, "SUBSCRIPTION_REQUIRED");
  } finally { await client.close(); await server.close(); }
});

test("owner video tool runs the preflight before resolving a chat client", async () => {
  let resolveCalls = 0;
  let preflightCalls = 0;
  const assertGenerationAllowed: OwnerGenerationPreflight = async (attemptId, modelId) => {
    assert.equal(attemptId, "link_exact_attempt_123456");
    assert.equal(modelId, "seedance-2.0");
    preflightCalls += 1;
    throw new OwnerGenerationPreflightError("SUBSCRIPTION_REQUIRED");
  };
  const options = {
    resolveChatClient: () => { resolveCalls += 1; throw new Error("must not resolve"); },
    assertGenerationAllowed
  } as RegisterSyntxOwnerGenerateVideoToolOptions & { assertGenerationAllowed: OwnerGenerationPreflight };
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: options });
  const client = new Client({ name: "video-preflight-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_exact_attempt_123456", prompt: "a lighthouse"
    } });
    assert.equal(result.isError, true);
    assert.equal(preflightCalls, 1);
    assert.equal(resolveCalls, 0);
    const payload = JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as { error: { code: string } };
    assert.equal(payload.error.code, "SUBSCRIPTION_REQUIRED");
  } finally { await client.close(); await server.close(); }
});

test("video reconciliation remains read-only and available when generation preflight would block", async () => {
  const attemptId = "link_exact_attempt_123456";
  const recoveryStore = new OwnerVideoRecoveryStore();
  const recovery = recoveryStore.create({
    attempt_id: attemptId,
    chat_uuid: "reconcile-chat",
    model_id: "seedance-2.0",
    message_id: "message-1"
  });
  let preflightCalls = 0;
  let messageReads = 0;
  const client: OwnerVideoChatClient = {
    async createChat() { throw new Error("reconciliation must not create chats"); },
    async deleteChat() { throw new Error("reconciliation must not delete chats"); },
    async startVideo() { throw new Error("reconciliation must not dispatch generation"); },
    async listInProgress() { throw new Error("message id should use direct read"); },
    async getMessage(chatUuid, messageId) {
      messageReads += 1;
      return {
        chat_uuid: chatUuid, message_id: messageId,
        object_type: "video", model_type: "seedance-2.0",
        artifacts: [{ url: "https://r2.syntx.ai/recovered/seedance.mp4", mime_type: "video/mp4" }]
      };
    }
  };
  const assertGenerationAllowed: OwnerGenerationPreflight = async () => {
    preflightCalls += 1;
    throw new OwnerGenerationPreflightError("SUBSCRIPTION_REQUIRED");
  };
  const options = {
    recoveryStore,
    resolveChatClient: () => client,
    assertGenerationAllowed
  } as RegisterSyntxOwnerGenerateVideoToolOptions & { assertGenerationAllowed: OwnerGenerationPreflight };
  const server = createMcpServer(createDefaultApplication(), { ownerGenerateVideo: options });
  const mcpClient = new Client({ name: "video-reconcile-preflight-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  try {
    const result = await mcpClient.callTool({ name: SYNTX_OWNER_RECONCILE_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: attemptId, recovery_id: recovery.recovery_id
    } });
    assert.equal(result.isError, undefined);
    assert.equal(preflightCalls, 0);
    assert.equal(messageReads, 1);
    assert.deepEqual((result.structuredContent as { videos: Array<{ url: string }> }).videos, [
      { url: "https://r2.syntx.ai/recovered/seedance.mp4", mime_type: "video/mp4" }
    ]);
  } finally { await mcpClient.close(); await server.close(); }
});
