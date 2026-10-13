import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { openPrivateOwnerAuthProfile } from "../src/auth/private-owner-auth-profile.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createPrivateOwnerGenerationProfile } from "../src/runtime/private-owner-generation-profile.js";
import { createDurableOwnerReadOnlyMcp } from "../src/runtime/durable-owner-readonly-mcp.js";

const NOW = Date.now();
const ATTEMPT_ID = "link_readonly_restart_attempt_0001";
const KEY_BYTES = Buffer.alloc(32, 53);
const FAKE_CREDENTIAL = "synthetic-readonly-restart-credential";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "syntx-owner-readonly-mcp-"));
  chmodSync(root, 0o700);
  const profileDirectory = join(root, "profile");
  mkdirSync(profileDirectory, { mode: 0o700 });
  chmodSync(profileDirectory, 0o700);
  const keyFilePath = join(root, "profile.key");
  writeFileSync(keyFilePath, KEY_BYTES, { mode: 0o600 });
  chmodSync(keyFilePath, 0o600);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { profileDirectory, keyFilePath };
}

function fakeAuthProvider(): AuthLinkProvider {
  return {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      return { upstream_attempt_id: "synthetic-readonly-challenge", approval_url: "https://t.me/syntxaibot" };
    },
    async pollChallenge(_upstreamAttemptId, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: FAKE_CREDENTIAL });
      return { state: "LINKED" };
    }
  };
}

async function withClient<T>(server: McpServer, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "durable-owner-readonly-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await work(client); }
  finally {
    await client.close();
    await server.close();
  }
}

test("reopened owner composition serves persisted job/result with MCP GET-only reads", async (t) => {
  const { profileDirectory, keyFilePath } = fixture(t);
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
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
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    join(process.cwd(), "catalog")
  );
  const requestMethods: string[] = [];
  const chatId = "synthetic-readonly-chat";
  const messageId = "synthetic-readonly-message";
  const artifactUrl = "https://r2.syntx.ai/synthetic-readonly-result.jpg";
  let subscriptionReads = 0;
  const offlineFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    requestMethods.push(`${method} ${url.pathname}`);
    if (method === "POST" && url.pathname === "/api/v1/chats") return json({ uuid: chatId });
    if (method === "POST" && url.pathname === "/api/v1/design/generate") return json({ id: messageId });
    if (method === "GET" && url.pathname === `/api/v1/chats/${chatId}/${messageId}`) {
      return json({
        id: messageId,
        author_id: -1,
        message_object: [{ id: "synthetic-readonly-object", object_type: "image", model_type: "banana-2.1", completed: true, object_url: artifactUrl }]
      });
    }
    throw new Error("Unexpected synthetic request.");
  };
  const openGenerationProfile = async () => {
    const authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
    const linkService = new PerUserLinkService(fakeAuthProvider(), authProfile.store, { now: () => NOW, attemptIdGenerator: () => ATTEMPT_ID });
    return createPrivateOwnerGenerationProfile({
      authProfile,
      linkService,
      attemptId: ATTEMPT_ID,
      catalog: selectedCatalog,
      registry,
      v2VariantSelections: [{ model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square" }],
      offlineSubscriptionReader: async () => {
        subscriptionReads += 1;
        return { active: true, plan_type: "Synthetic", end_date: null, end_date_kind: null };
      },
      offlineFetchImpl: offlineFetch,
      now: () => new Date(NOW),
      createOperationId: () => "generation_00000000-0000-4000-8000-000000000001"
    });
  };

  const linkedAuthProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  const setupLinkService = new PerUserLinkService(fakeAuthProvider(), linkedAuthProfile.store, {
    now: () => NOW,
    attemptIdGenerator: () => ATTEMPT_ID
  });
  await setupLinkService.createAttempt(linkedAuthProfile.binding);
  await setupLinkService.issueHandoff(linkedAuthProfile.binding, ATTEMPT_ID);
  assert.equal((await setupLinkService.checkAttempt(linkedAuthProfile.binding, ATTEMPT_ID)).status, "LINKED");
  linkedAuthProfile.close();

  const firstProfile = await openGenerationProfile();
  const request = {
    model_id: "banana-2.1",
    operation_id: "generate-image",
    parameters: { prompt: "synthetic restart-only fixture" },
    catalog_version: registry.catalog_version
  };
  const started = await firstProfile.generationRuntime.adapter.startGeneration({
    principal: firstProfile.generationRuntime.principal,
    idempotency_key: "durable-readonly-restart-key",
    confirmation_id: "synthetic-confirmation",
    approved_max_cost_tokens: 8
  }, request);
  assert.equal(started.id, "generation_00000000-0000-4000-8000-000000000001");
  assert.equal(requestMethods.filter((item) => item.startsWith("POST ")).length, 2);
  assert.equal(subscriptionReads, 1);
  firstProfile.close();

  const reopenedProfile = await openGenerationProfile();
  const modelCountBeforeRead = requestMethods.length;
  const baseApplication = createDefaultApplication({ discoveryCatalog: selectedCatalog, runtimeCapabilities: null });
  await assert.rejects(baseApplication.getBalance(),
    (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "COMPLIANCE_GATE_BLOCKED");
  const composition = createDurableOwnerReadOnlyMcp({
    profile: reopenedProfile,
    baseApplication,
    selectedCatalog
  });
  const modelLookupsBeforeRead = modelLookups;
  const compositionToolNames = await withClient(composition.server, async (client) => {
    const listed = await client.listTools();
    const job = await client.callTool({ name: "syntx_get_job", arguments: { job_id: started.id } });
    assert.notEqual(job.isError, true, JSON.stringify(job.content));
    assert.equal(parseTextResult(job.content).status, "succeeded");
    const result = await client.callTool({ name: "syntx_get_result", arguments: { job_id: started.id } });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assert.equal((parseTextResult(result.content).artifacts as unknown[]).length, 1);
    const denied = await client.callTool({
      name: "syntx_start_generation",
      arguments: {
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: "must not dispatch" },
        idempotency_key: "readonly-denial-key",
        confirmation_id: "confirm_synthetic_readonly"
      }
    });
    assert.equal(denied.isError, true);
    return listed.tools.map((tool) => tool.name).sort();
  });
  assert.equal(requestMethods.filter((item) => item.startsWith("POST ")).length, 2, "restart performs no new write/dispatch POST");
  assert.ok(requestMethods.length > modelCountBeforeRead, "SDK read tools query the persisted receipt upstream");
  assert.ok(requestMethods.slice(modelCountBeforeRead).every((item) => item.startsWith("GET ")),
    "the reopened MCP reads use only GET requests");
  assert.equal(subscriptionReads, 1, "GET recovery does not check subscription or current model eligibility");
  assert.equal(modelLookups, modelLookupsBeforeRead, "GET recovery does not consult current model lookup/variant preparation");
  const requestsBeforeDirectDenials = requestMethods.length;
  const profilePrincipal = reopenedProfile.generationRuntime.principal;
  await assert.rejects(composition.adapter.getJob({
    principal: { ...profilePrincipal, connection_id: "link_another_session_attempt01" },
    job_id: started.id
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "JOB_NOT_FOUND");
  await assert.rejects(composition.adapter.getBalance(profilePrincipal), isCapabilityDenied);
  await assert.rejects(composition.adapter.estimateGeneration(profilePrincipal, request), isCapabilityDenied);
  await assert.rejects(composition.adapter.reconcileStart({
    principal: profilePrincipal, idempotency_key: "unused-readonly-key", request_hash: `sha256:${"0".repeat(64)}`
  }), isCapabilityDenied);
  await assert.rejects(composition.adapter.reconcileCancel({
    principal: profilePrincipal, job_id: started.id, idempotency_key: "unused-readonly-cancel"
  }), isCapabilityDenied);
  await assert.rejects(composition.adapter.cancelJob({
    principal: profilePrincipal, job_id: started.id, idempotency_key: "unused-readonly-cancel", confirmation_id: "confirm_unused_readonly"
  }), isCapabilityDenied);
  assert.equal(requestMethods.length, requestsBeforeDirectDenials, "wrong-principal and denied adapter ports do not reach network");
  const defaultToolNames = await withClient(createMcpServer(baseApplication), async (client) =>
    (await client.listTools()).tools.map((tool) => tool.name).sort());
  assert.deepEqual(compositionToolNames, defaultToolNames, "explicit read-only composition keeps the default tool set and adds no owner flags/tools");
  reopenedProfile.close();
});

test("unknown dispatch without a receipt remains unresolved through SDK and never guesses a GET or retry", async (t) => {
  const { profileDirectory, keyFilePath } = fixture(t);
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
  const registry = loadGenerationContractRegistryV2(
    "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json",
    join(process.cwd(), "catalog")
  );
  const requestMethods: string[] = [];
  const operationId = "generation_00000000-0000-4000-8000-000000000002";
  let subscriptionReads = 0;
  const offlineFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    requestMethods.push(`${method} ${url.pathname}`);
    if (method === "POST" && url.pathname === "/api/v1/chats") return json({ uuid: "synthetic-unknown-chat" });
    if (method === "POST" && url.pathname === "/api/v1/design/generate") throw new Error("synthetic accepted-or-lost dispatch receipt");
    throw new Error("Unknown-receipt flow must not make guessed reads.");
  };
  const linkedAuthProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
  const setupLink = new PerUserLinkService(fakeAuthProvider(), linkedAuthProfile.store, {
    now: () => NOW, attemptIdGenerator: () => ATTEMPT_ID
  });
  await setupLink.createAttempt(linkedAuthProfile.binding);
  await setupLink.issueHandoff(linkedAuthProfile.binding, ATTEMPT_ID);
  assert.equal((await setupLink.checkAttempt(linkedAuthProfile.binding, ATTEMPT_ID)).status, "LINKED");
  linkedAuthProfile.close();

  const openProfile = async () => {
    const authProfile = openPrivateOwnerAuthProfile({ profileDirectory, keyFilePath });
    const linkService = new PerUserLinkService(fakeAuthProvider(), authProfile.store, { now: () => NOW });
    return createPrivateOwnerGenerationProfile({
      authProfile, linkService, attemptId: ATTEMPT_ID, catalog, registry,
      v2VariantSelections: [{ model_id: "banana-2.1", operation_id: "generate-image", variant_id: "banana21-image-1k-minimal-square" }],
      offlineSubscriptionReader: async () => {
        subscriptionReads += 1;
        return { active: true, plan_type: "Synthetic", end_date: null, end_date_kind: null };
      },
      offlineFetchImpl: offlineFetch,
      now: () => new Date(NOW),
      createOperationId: () => operationId
    });
  };
  const first = await openProfile();
  await assert.rejects(first.generationRuntime.adapter.startGeneration({
    principal: first.generationRuntime.principal,
    idempotency_key: "durable-readonly-unknown-key",
    confirmation_id: "synthetic-confirmation",
    approved_max_cost_tokens: 8
  }, {
    model_id: "banana-2.1", operation_id: "generate-image",
    parameters: { prompt: "synthetic unknown fixture" }, catalog_version: registry.catalog_version
  }), (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "UPSTREAM_OUTCOME_UNKNOWN");
  assert.deepEqual(requestMethods, ["POST /api/v1/chats", "POST /api/v1/design/generate"]);
  first.close();

  const reopened = await openProfile();
  const composition = createDurableOwnerReadOnlyMcp({
    profile: reopened,
    baseApplication: createDefaultApplication({ discoveryCatalog: catalog, runtimeCapabilities: null }),
    selectedCatalog: catalog
  });
  await withClient(composition.server, async (client) => {
    const response = await client.callTool({ name: "syntx_get_job", arguments: { job_id: operationId } });
    assert.equal(response.isError, true);
    assert.match(readTextContent(response.content).join(" "), /unknown/u);
  });
  assert.deepEqual(requestMethods, ["POST /api/v1/chats", "POST /api/v1/design/generate"],
    "unknown receipt stays local and causes neither a guessed GET nor a repeated POST");
  assert.equal(subscriptionReads, 1, "unknown recovery does not re-read plan eligibility");
  reopened.close();
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function readTextContent(content: unknown): string[] {
  assert.ok(Array.isArray(content));
  return content.flatMap((item: unknown) =>
    item !== null && typeof item === "object" && "type" in item && item.type === "text" &&
    "text" in item && typeof item.text === "string" ? [item.text] : []);
}

function parseTextResult(content: unknown): Record<string, unknown> {
  const text = readTextContent(content)[0];
  assert.equal(typeof text, "string");
  return JSON.parse(text as string) as Record<string, unknown>;
}

function isCapabilityDenied(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error &&
    error.code === "UPSTREAM_CAPABILITY_NOT_RESEARCHED";
}
