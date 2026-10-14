import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import type { CreateMcpServerOptions } from "../src/mcp/server.js";
import { SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES } from "../src/mcp/owner-hailuo-live-t2v-tools.js";
import { SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME } from "../src/mcp/owner-reviewed-video-recovery-diagnostic-tools.js";
import {
  OwnerHailuoLiveT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuoLiveT2vProfile } from "../src/application/owner-hailuo-live-t2v-profile.js";
import { buildOwnerReviewedVideoRecoveryDiagnostic } from "../src/application/owner-reviewed-video-recovery-diagnostic.js";

const ATTEMPT_ID = "link_video_diag_live_composition_0001";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "video-diagnostic-tenant", subject: "video-diagnostic-owner" });
const RECOVERY_ID = "recovery_00000000-0000-0000-0000-000000000001";
const DIAGNOSTIC = buildOwnerReviewedVideoRecoveryDiagnostic({
  phase: "RECOVERY_GET",
  post_disposition: "MAY_HAVE_BEEN_SENT",
  ack_observation: "NOT_OBSERVED",
  history_observation: "NOT_READ",
  result_binding_observation: "NOT_READ",
  last_safe_error_code: "OUTCOME_UNKNOWN",
  no_artifact_reason: "NOT_CAPTURED",
  poll_usage: { history_get_calls: 0, in_progress_get_calls: 0, result_get_calls: 0 }
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function errorCode(result: unknown): string | undefined {
  if (result === null || typeof result !== "object" || !("content" in result) || !Array.isArray(result.content)) return undefined;
  const content = result.content.find((entry) => entry !== null && typeof entry === "object" &&
    "type" in entry && entry.type === "text" && "text" in entry && typeof entry.text === "string");
  const text = content !== undefined && "text" in content && typeof content.text === "string" ? content.text : undefined;
  if (!text) return undefined;
  return (JSON.parse(text) as { error?: { code?: string } }).error?.code;
}

async function createSyntheticOwnerRecovery(catalogDirectory: string) {
  let now = Date.now();
  const authStore = new InMemoryAuthLinkStore(() => now);
  const authProvider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() {
      return { upstream_attempt_id: "synthetic-video-diagnostic", approval_url: "https://syntx.ai/auth" };
    },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-video-diagnostic-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(authProvider, authStore, {
    now: () => now,
    attemptIdGenerator: () => ATTEMPT_ID
  });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT_ID);
  await linkService.checkAttempt(BINDING, ATTEMPT_ID);

  const nativeRequests: Array<{ readonly method: string; readonly path: string }> = [];
  let videoPosts = 0;
  let subscriptionReads = 0;
  let modelAccessReads = 0;
  let inProgressReads = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    nativeRequests.push({ method, path: url.pathname });
    if (url.pathname === "/api/v1/chats" && method === "POST") return jsonResponse({ uuid: "synthetic-video-diagnostic-chat" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      return jsonResponse({ id: "synthetic-video-diagnostic-echo" });
    }
    if (url.pathname === "/api/v1/chats/synthetic-video-diagnostic-chat/inprogress" && method === "GET") {
      inProgressReads += 1;
      return jsonResponse([]);
    }
    if (url.pathname === "/api/v1/chats/synthetic-video-diagnostic-chat/messages" && method === "GET") {
      return jsonResponse({
        messages: [{ id: "synthetic-video-diagnostic-echo", chat_id: 701, author_id: 12345, message_object: [] }],
        pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false }
      });
    }
    if (url.pathname === "/api/v1/chats/synthetic-video-diagnostic-chat/synthetic-video-diagnostic-echo" && method === "GET") {
      return jsonResponse({ id: "synthetic-video-diagnostic-echo", chat_id: 701, author_id: 12345, message_object: [] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };

  const profile = createOwnerHailuoLiveT2vProfile(catalogDirectory);
  const service = new OwnerHailuoLiveT2vGenerationService({
    profile,
    binding: BINDING,
    linkService,
    async resolveSubscription(): Promise<SyntxSubscription> {
      subscriptionReads += 1;
      return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null };
    },
    async resolveModelAccess(): Promise<ModelAccessResult> {
      modelAccessReads += 1;
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
        catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: profile.modelId, ai_name: profile.aiName, model_type: profile.modelType, account_read_live: true,
        parameter_keys: ["resolution", "video_duration"], parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false,
        observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
        return operation("synthetic-video-diagnostic-credential");
      } },
      fetchImpl,
      requestTimeoutMs: 500
    }),
    now: () => now,
    wait: async () => undefined,
    videoTimeoutMs: 5_000
  });
  const error = await service.generate({
    attemptId: ATTEMPT_ID, prompt: "Synthetic owner recovery diagnostic composition.", resolution: "720p", video_duration: 6
  }).catch((caught: unknown) => caught);
  assert.ok(error instanceof OwnerReviewedNoReferenceT2vServiceError);
  assert.equal(error.code, "OUTCOME_UNKNOWN");
  assert.ok(error.recovery_id);

  return {
    service,
    linkService,
    authStore,
    recoveryId: error.recovery_id,
    nativeRequests,
    entitlementReads: () => ({ subscriptionReads, modelAccessReads }),
    videoPosts: () => videoPosts,
    inProgressReads: () => inProgressReads,
    now: () => now
  };
}

test("owner video recovery diagnostics are composed only from enabled reviewed services", async () => {
  let nativeHttpCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    nativeHttpCalls += 1;
    throw new Error("Unexpected network request in diagnostic composition test");
  };
  const catalogDirectory = resolve(process.cwd(), "catalog");

  const defaults = createObservedOwnerRuntime({ catalogDirectory, fetchImpl });
  const defaultServer = createMcpServer(defaults.application, defaults.serverOptions);
  const defaultClient = new Client({ name: "video-diagnostic-default-off", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  try {
    await defaultServer.connect(defaultServerTransport);
    await defaultClient.connect(defaultClientTransport);
    const defaultNames = (await defaultClient.listTools()).tools.map((tool) => tool.name);
    assert.equal(defaultNames.includes(SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME), false);
  } finally {
    await defaultClient.close();
    await defaultServer.close();
    defaults.authStore.close?.();
  }

  const runtime = createObservedOwnerRuntime({ catalogDirectory, fetchImpl });
  const synthetic = await createSyntheticOwnerRecovery(catalogDirectory);
  const server = createMcpServer(runtime.application, {
    ownerHailuoLiveT2v: { generationService: synthetic.service }
  });
  const client = new Client({ name: "video-diagnostic-live-only", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    const ownerTools = tools.filter((tool) =>
      SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES.includes(tool.name as never) ||
      tool.name === SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME);
    assert.deepEqual(ownerTools.map((tool) => tool.name).sort(), [
      ...SYNTX_OWNER_HAILUO_LIVE_T2V_TOOL_NAMES,
      SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME
    ].sort());
    assert.equal(ownerTools.length, 5);
    const diagnosticTool = ownerTools.find((tool) => tool.name === SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME);
    assert.equal(diagnosticTool?.annotations?.readOnlyHint, true);
    assert.equal(diagnosticTool?.annotations?.destructiveHint, false);

    const wrongConfiguredModel = await client.callTool({
      name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
      arguments: { model_id: "hailuo-02", link_attempt_id: ATTEMPT_ID, recovery_id: synthetic.recoveryId }
    });
    assert.equal(wrongConfiguredModel.isError, true);
    assert.equal(errorCode(wrongConfiguredModel), "MODEL_UNAVAILABLE");
    const requestsBeforeConfiguredNegative = synthetic.nativeRequests.length;
    const entitlementReadsBeforeConfiguredNegative = synthetic.entitlementReads();
    assert.equal(synthetic.videoPosts(), 1);
    assert.ok(synthetic.inProgressReads() > 0);

    await synthetic.linkService.revoke(BINDING, ATTEMPT_ID);

    const unauthenticatedRecovery = await client.callTool({
      name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
      arguments: { model_id: "hailuo-01-live", link_attempt_id: ATTEMPT_ID, recovery_id: synthetic.recoveryId }
    });
    assert.equal(unauthenticatedRecovery.isError, true);
    assert.equal(errorCode(unauthenticatedRecovery), "RECOVERY_NOT_FOUND");
    assert.deepEqual(synthetic.entitlementReads(), entitlementReadsBeforeConfiguredNegative);
    assert.equal(synthetic.nativeRequests.length, requestsBeforeConfiguredNegative);
    assert.equal(nativeHttpCalls, 0);
  } finally {
    await synthetic.service.close();
    synthetic.authStore.close?.();
    await client.close();
    await server.close();
    runtime.authStore.close?.();
  }
});

test("family diagnostic closures pin each configured Kling and Veo model ID", async () => {
  const nativeHttpCalls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    nativeHttpCalls.push(String(input));
    throw new Error("Unexpected network request in diagnostic family binding test");
  };
  const catalogDirectory = resolve(process.cwd(), "catalog");
  const runtime = createObservedOwnerRuntime({ catalogDirectory, fetchImpl });
  const klingCalls: unknown[] = [];
  const veoCalls: unknown[] = [];
  const familyService = (calls: unknown[]) => ({
    getParametersSource() { throw new Error("Source tool must not invoke the diagnostic getter fixture"); },
    getReviewedContract() { throw new Error("Contract tool must not invoke the diagnostic getter fixture"); },
    generate() { throw new Error("Generation must not run in this diagnostic-only test"); },
    reconcile() { throw new Error("Reconciliation must not run in this diagnostic-only test"); },
    listRecoveries() { throw new Error("Recovery listing must not run in this diagnostic-only test"); },
    async getRecoveryDiagnostic(input: unknown) {
      calls.push(input);
      return DIAGNOSTIC;
    }
  });
  const options = {
    ownerKlingT2v: { generationService: familyService(klingCalls) as never },
    ownerVeoT2v: { generationService: familyService(veoCalls) as never }
  } satisfies CreateMcpServerOptions;
  const server = createMcpServer(runtime.application, options);
  const client = new Client({ name: "video-diagnostic-family-binding", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.filter((tool) => tool.name === SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME).length, 1);

    for (const modelId of ["kling_text2video", "kling_o1_text2video"] as const) {
      const result = await client.callTool({
        name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
        arguments: { model_id: modelId, link_attempt_id: ATTEMPT_ID, recovery_id: RECOVERY_ID }
      });
      assert.notEqual(result.isError, true);
      assert.equal((result.structuredContent as { model_id: string }).model_id, modelId);
    }
    for (const modelId of ["veo3", "veo3fast", "veo3fast_r"] as const) {
      const result = await client.callTool({
        name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
        arguments: { model_id: modelId, link_attempt_id: ATTEMPT_ID, recovery_id: RECOVERY_ID }
      });
      assert.notEqual(result.isError, true);
      assert.equal((result.structuredContent as { model_id: string }).model_id, modelId);
    }
    assert.deepEqual(klingCalls, [
      { model_id: "kling_text2video", attemptId: ATTEMPT_ID, recovery_id: RECOVERY_ID },
      { model_id: "kling_o1_text2video", attemptId: ATTEMPT_ID, recovery_id: RECOVERY_ID }
    ]);
    assert.deepEqual(veoCalls, [
      { model_id: "veo3", attemptId: ATTEMPT_ID, recovery_id: RECOVERY_ID },
      { model_id: "veo3fast", attemptId: ATTEMPT_ID, recovery_id: RECOVERY_ID },
      { model_id: "veo3fast_r", attemptId: ATTEMPT_ID, recovery_id: RECOVERY_ID }
    ]);
    assert.deepEqual(nativeHttpCalls, []);
  } finally {
    await client.close();
    await server.close();
    runtime.authStore.close?.();
  }
});
