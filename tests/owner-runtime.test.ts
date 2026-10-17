import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SYNTX_AUTH_TOOL_NAMES } from "../src/mcp/auth-tools.js";
import { SYNTX_MODEL_ACCESS_TOOL_NAME } from "../src/mcp/model-access-tool.js";
import { SYNTX_ACCOUNT_STATUS_TOOL_NAME } from "../src/mcp/account-status-tool.js";
import { SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME } from "../src/mcp/reconcile-uploaded-file-tool.js";
import { createMcpServer, TOOL_NAMES } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { loadGenerationContractRegistry } from "../src/catalog/generation-contract-history.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";

const UPSTREAM_UUID = "018f2f60-91c4-7c3d-8e52-0f7d0e21b581";
const SECRET = ["runtime", "test", "credential", "never", "output"].join("-");

test("owner runtime preserves an explicitly injected auth store", () => {
  const injected = new InMemoryAuthLinkStore();
  const runtime = createObservedOwnerRuntime({ authStore: injected });
  assert.equal(runtime.authStore, injected);
});

test("owner runtime uses the explicitly selected persistent-profile principal", () => {
  const binding = { tenant_id: "tenant_owner_profile_fixture", subject: "subject_owner_profile_fixture" };
  const runtime = createObservedOwnerRuntime({
    authStore: new InMemoryAuthLinkStore(),
    authBinding: binding
  });
  assert.deepEqual(runtime.serverOptions.auth?.binding, binding);
});

test("owner HTTP/default runtime does not activate either generation-contract schema", async () => {
  const runtime = createObservedOwnerRuntime();
  assert.ok(runtime.authStore instanceof InMemoryAuthLinkStore, "the default owner runtime stays process-local");
  assert.equal(runtime.serverOptions.ownerContractMedia, undefined);
  assert.equal(runtime.serverOptions.generationContractRegistry, undefined);
  assert.equal(runtime.serverOptions.generationContractRegistryV2, undefined);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-default-contract-runtime-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.equal(names.includes("syntx_owner_generate_media"), false);
    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana-2.1", operation_id: "generate-image" }
    });
    assert.equal((schema.structuredContent as Record<string, unknown>).schema_status, "NOT_AVAILABLE");
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP composition rejects two simultaneous generation-contract registries", () => {
  const registryV1 = loadGenerationContractRegistry("sha256-78c65766ddf4149de0f63dc730d86b1dc0d45ec7adef9da0bf38b89095e47216.json");
  const registryV2 = loadGenerationContractRegistryV2("sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json");
  assert.throws(
    () => createMcpServer(createObservedOwnerRuntime().application, {
      generationContractRegistry: registryV1,
      generationContractRegistryV2: registryV2
    }),
    /GENERATION_CONTRACT_REGISTRY_SELECTION_AMBIGUOUS/u
  );
});

test("owner runtime preserves an explicitly injected video recovery store", () => {
  const recoveryStore = { create: () => { throw new Error("not called"); }, get: () => undefined };
  const runtime = createObservedOwnerRuntime({ generateVideoEnabled: true, videoRecoveryStore: recoveryStore });
  assert.equal(runtime.serverOptions.ownerGenerateVideo?.recoveryStore, recoveryStore);
});

test("owner runtime registers uploaded-file reconciliation only with its explicit operator flag", async () => {
  const runtime = createObservedOwnerRuntime({ reconcileUploadedFileEnabled: true });
  assert.ok(runtime.serverOptions.reconcileUploadedFile);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-reconcile-runtime-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME));
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner runtime leaves account status unregistered by default and cannot enable it via tool input", async () => {
  let fetches = 0;
  const runtime = createObservedOwnerRuntime({ fetchImpl: async () => {
    fetches += 1;
    throw new Error("Default account-status test must not perform I/O.");
  } });
  assert.equal(runtime.serverOptions.accountStatus, undefined);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-default-runtime-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 19);
    assert.equal(listed.tools.some((tool) => tool.name === SYNTX_ACCOUNT_STATUS_TOOL_NAME), false);
    const result = await client.callTool({ name: SYNTX_ACCOUNT_STATUS_TOOL_NAME, arguments: {
      link_attempt_id: "link_account_attempt_0000000001", accountStatusEnabled: true
    } });
    assert.equal(result.isError, true);
    assert.equal(runtime.serverOptions.accountStatus, undefined);
    assert.equal(fetches, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("owner runtime links, reads catalog access, and unlinks without leaking credential", async () => {
  const requests: string[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/api/v1/auth/startauth") {
      return json({ uuid: UPSTREAM_UUID });
    }
    if (url.pathname === `/api/v1/auth/token/${UPSTREAM_UUID}`) {
      return json({
        valid: true,
        complete: true,
        token: SECRET,
        is_new_user: false
      });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        `Bearer ${SECRET}`
      );
      assert.equal(url.searchParams.get("ai_name"), "banana");
      assert.equal(url.searchParams.get("model_type"), "banana2");
      return json({
        access: true,
        cost: 3,
        discount_cost: null,
        free_remaining_generations: 0,
        limit: 10,
        show_warning: false
      });
    }
    if (url.pathname === "/api/v1/user/balance" || url.pathname === "/api/v1/user/subscription") {
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
      assert.equal(init?.method, "GET");
      if (url.pathname.endsWith("balance")) return json({ balance: "10.25" });
      assert.equal(url.search, "?ref=false");
      return json({ active: true, type: "basic", end_date: "2026-10-02" });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      assert.equal(
        new Headers(init.headers).get("authorization"),
        `Bearer ${SECRET}`
      );
      assert.deepEqual(JSON.parse(String(init.body)), {
        title: "mcp-owner-runtime-empty-chat",
        scope: "text"
      });
      return json({
        uuid: "owner-runtime-chat-1",
        title: "mcp-owner-runtime-empty-chat",
        ignored_private_value: SECRET
      });
    }
    if (
      url.pathname === "/api/v1/chats/owner-runtime-chat-1" &&
      init?.method === "DELETE"
    ) {
      assert.equal(
        new Headers(init.headers).get("authorization"),
        `Bearer ${SECRET}`
      );
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected mock URL.");
  }) as typeof fetch;

  const runtime = createObservedOwnerRuntime({
    accountStatusEnabled: true,
    fetchImpl,
    now: () => Date.parse("2026-09-02T12:00:00.000Z")
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "owner-runtime-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      ...TOOL_NAMES,
      ...SYNTX_AUTH_TOOL_NAMES,
      SYNTX_MODEL_ACCESS_TOOL_NAME,
      SYNTX_ACCOUNT_STATUS_TOOL_NAME
    ]);

    const search = requireResult(
      await client.callTool({
        name: "syntx_search_models",
        arguments: { query: "banana2", limit: 10 }
      })
    );
    assert.equal(search.structuredContent?.catalog_kind, "OFFICIAL_PUBLIC_API_SNAPSHOT");
    assert.equal(search.structuredContent?.total, 1);

    const model = requireResult(
      await client.callTool({
        name: "syntx_get_model",
        arguments: { model_id: "banana3_light" }
      })
    );
    const modelRecord = model.structuredContent?.model as
      | { runtime_usable?: boolean; runtime_capability?: Record<string, unknown> }
      | undefined;
    assert.equal(modelRecord?.runtime_usable, false);
    assert.equal("runtime_capability" in (modelRecord ?? {}), false);

    const begun = requireResult(
      await client.callTool({ name: "syntx_begin_login", arguments: {} })
    );
    const attemptId = begun.structuredContent?.attempt_id;
    assert.ok(typeof attemptId === "string");
    assert.equal(JSON.stringify(begun).includes(SECRET), false);

    const linked = requireResult(
      await client.callTool({
        name: "syntx_check_login",
        arguments: { attempt_id: attemptId }
      })
    );
    assert.equal(linked.structuredContent?.linked, true);

    const access = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: attemptId,
          model_id: "banana2",
          cost_parameters: { image_size: "2K" }
        }
      })
    );
    assert.equal(access.isError, undefined);
    assert.equal(access.structuredContent?.access, true);
    assert.equal(access.structuredContent?.cost, 3);
    assert.deepEqual(access.structuredContent?.parameter_keys, ["image_size"]);
    assert.equal(JSON.stringify(access).includes(SECRET), false);

    const account = requireResult(await client.callTool({
      name: SYNTX_ACCOUNT_STATUS_TOOL_NAME,
      arguments: { link_attempt_id: attemptId }
    }));
    assert.equal(account.isError, undefined);
    assert.deepEqual(account.structuredContent?.balance, { unit: "tokens", available: "10.25" });
    assert.equal(account.structuredContent?.contract_evidence, "PUBLIC_FRONTEND_OBSERVED");
    assert.equal(JSON.stringify(account).includes(SECRET), false);

    const chatClient = runtime.createChatClient(attemptId);
    const createdChat = await chatClient.createChat(
      "text",
      "mcp-owner-runtime-empty-chat"
    );
    assert.deepEqual(createdChat, { chat_uuid: "owner-runtime-chat-1" });
    assert.equal(JSON.stringify(createdChat).includes(SECRET), false);
    assert.deepEqual(
      await chatClient.deleteChat(createdChat.chat_uuid),
      { chat_uuid: "owner-runtime-chat-1", accepted: true }
    );

    const unlinked = requireResult(
      await client.callTool({
        name: "syntx_unlink",
        arguments: { attempt_id: attemptId }
      })
    );
    assert.equal(unlinked.structuredContent?.status, "REVOKED");

    await assert.rejects(chatClient.listInProgress("owner-runtime-chat-1"));

    const afterUnlink = requireResult(
      await client.callTool({
        name: SYNTX_MODEL_ACCESS_TOOL_NAME,
        arguments: {
          link_attempt_id: attemptId,
          model_id: "banana2",
          cost_parameters: {}
        }
      })
    );
    assert.equal(afterUnlink.isError, true);
    assert.equal(JSON.stringify(afterUnlink).includes(SECRET), false);
    const accountAfterUnlink = requireResult(await client.callTool({
      name: SYNTX_ACCOUNT_STATUS_TOOL_NAME,
      arguments: { link_attempt_id: attemptId }
    }));
    assert.equal(accountAfterUnlink.isError, true);
    assert.deepEqual(requests, [
      "POST /api/v1/auth/startauth",
      `GET /api/v1/auth/token/${UPSTREAM_UUID}`,
      "GET /api/v2/get_model_info",
      "GET /api/v1/user/balance",
      "GET /api/v1/user/subscription",
      "POST /api/v1/chats",
      "DELETE /api/v1/chats/owner-runtime-chat-1"
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function requireResult(value: unknown): CallToolResult {
  assert.ok(value && typeof value === "object" && "content" in value);
  return value as CallToolResult;
}
