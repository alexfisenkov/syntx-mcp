import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import {
  OwnerHailuoLiveT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import type { OwnerReviewedVideoRecoveryDiagnostic } from "../src/application/owner-reviewed-video-recovery-diagnostic.js";
import { createOwnerHailuoLiveT2vProfile } from "../src/application/owner-hailuo-live-t2v-profile.js";
import {
  SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
  registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools
} from "../src/mcp/owner-reviewed-video-recovery-diagnostic-tools.js";

const ATTEMPT = "link_owner_video_diagnostic_tools_0001";
const FOREIGN_ATTEMPT = "link_owner_video_diagnostic_tools_0002";
const RECOVERY_ID = "recovery_4b69ca95-a263-427d-9b08-973167b2a198";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "video-diagnostic-tenant", subject: "video-diagnostic-owner" });

async function withClient(server: McpServer, run: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ name: "owned-video-diagnostic-tools-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); }
  finally { await Promise.all([client.close(), server.close()]); }
}

async function liveServiceFixture() {
  const now = () => Date.parse("2026-10-14T02:00:00.000Z");
  const store = new InMemoryAuthLinkStore(now);
  const authProvider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-diagnostic-auth", approval_url: "https://example.invalid/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-diagnostic-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(authProvider, store, { now, attemptIdGenerator: () => ATTEMPT });
  await linkService.createAttempt(BINDING);
  await linkService.issueHandoff(BINDING, ATTEMPT);
  await linkService.checkAttempt(BINDING, ATTEMPT);

  const requests: Array<{ method: string; path: string }> = [];
  let videoPosts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname });
    if (method === "POST" && url.pathname === "/api/v1/chats") return Response.json({ uuid: "diagnostic-private-chat" });
    if (method === "POST" && url.pathname === "/api/v1/video/generate") {
      videoPosts += 1;
      throw new Error("synthetic private transport detail");
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerHailuoLiveT2vProfile();
  let subscriptionReads = 0;
  let accessReads = 0;
  const service = new OwnerHailuoLiveT2vGenerationService({
    profile,
    binding: BINDING,
    linkService,
    async resolveSubscription(): Promise<SyntxSubscription> {
      subscriptionReads += 1;
      return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null };
    },
    async resolveModelAccess(): Promise<ModelAccessResult> {
      accessReads += 1;
      return {
        catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
        model_id: profile.modelId, ai_name: profile.aiName, model_type: profile.modelType, account_read_live: true,
        parameter_keys: ["resolution", "video_duration"], parameters_redacted: true, access: true, cost: null,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now()).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-diagnostic-credential"); } },
      fetchImpl, requestTimeoutMs: 500
    }),
    now,
    wait: async () => undefined,
    videoTimeoutMs: 5_000
  });

  return {
    service, linkService, store, requests,
    get videoPosts() { return videoPosts; },
    get entitlementReads() { return { subscriptionReads, accessReads }; },
    async generateUnknown(): Promise<string> {
      const error = await service.generate({ attemptId: ATTEMPT, prompt: "private diagnostic fixture prompt", resolution: "720p", video_duration: 6 })
        .catch((caught: unknown) => caught);
      assert.ok(error instanceof OwnerReviewedNoReferenceT2vServiceError);
      assert.equal(error.code, "OUTCOME_UNKNOWN");
      assert.ok(error.recovery_id);
      return error.recovery_id;
    },
    async close(): Promise<void> { await service.close(); store.close(); }
  };
}

function diagnosticFixture(): OwnerReviewedVideoRecoveryDiagnostic {
  return Object.freeze({
    phase: "POST_CALL_STARTED", post_disposition: "MAY_HAVE_BEEN_SENT", ack_observation: "NOT_OBSERVED",
    history_observation: "NOT_READ", result_binding_observation: "NOT_READ", last_safe_error_code: null,
    no_artifact_reason: "NOT_CAPTURED",
    poll_usage: Object.freeze({ history_get_calls: Object.freeze({ count: 256, capped: true }),
      in_progress_get_calls: Object.freeze({ count: 0, capped: false }), result_get_calls: Object.freeze({ count: 0, capped: false }) })
  });
}

test("Stock MCP SDK reads a genuine Live recovery without more native HTTP and hides foreign or revoked handles", async () => {
  const fixture = await liveServiceFixture();
  try {
    const recoveryId = await fixture.generateUnknown();
    assert.equal(fixture.videoPosts, 1);
    const directDiagnostic = await fixture.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(directDiagnostic.last_safe_error_code, "OUTCOME_UNKNOWN");
    const diagnostics = new Map([["hailuo-01-live", ({ attemptId, recovery_id }: { attemptId: string; recovery_id: string }) =>
      fixture.service.getRecoveryDiagnostic({ attemptId, recovery_id })]]);
    const server = new McpServer({ name: "video-recovery-diagnostic-tools", version: "1.0.0" });
    registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools(server, { diagnostics });
    await withClient(server, async (client) => {
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map(({ name }) => name), [SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME]);
      assert.equal(listed.tools[0]?.annotations?.readOnlyHint, true);
      const beforeDiagnostic = fixture.requests.length;
      const beforeEntitlement = fixture.entitlementReads;
      const result = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME, arguments: {
        model_id: "hailuo-01-live", link_attempt_id: ATTEMPT, recovery_id: recoveryId
      } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal(fixture.requests.length, beforeDiagnostic);
      assert.deepEqual(fixture.entitlementReads, beforeEntitlement);
      assert.equal(fixture.videoPosts, 1);
      const output = result.structuredContent as { model_id: string; diagnostic: OwnerReviewedVideoRecoveryDiagnostic };
      assert.equal(output.model_id, "hailuo-01-live");
      assert.equal(output.diagnostic.post_disposition, "MAY_HAVE_BEEN_SENT");
      assert.equal(output.diagnostic.last_safe_error_code, "OUTCOME_UNKNOWN");
      assert.equal("provider_accepted" in output.diagnostic, false);
      const serialized = JSON.stringify(result);
      for (const privateValue of [ATTEMPT, recoveryId, "diagnostic-private-chat", "private diagnostic fixture prompt", "synthetic private transport detail"]) {
        assert.equal(serialized.includes(privateValue), false);
      }

      const beforeForeign = fixture.requests.length;
      const foreign = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME, arguments: {
        model_id: "hailuo-01-live", link_attempt_id: FOREIGN_ATTEMPT, recovery_id: recoveryId
      } });
      assert.equal(foreign.isError, true);
      assert.equal(JSON.stringify(foreign).includes(recoveryId), false);
      assert.equal(fixture.requests.length, beforeForeign);

      await fixture.linkService.revoke(BINDING, ATTEMPT);
      const revoked = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME, arguments: {
        model_id: "hailuo-01-live", link_attempt_id: ATTEMPT, recovery_id: recoveryId
      } });
      assert.equal(revoked.isError, true);
      assert.equal(JSON.stringify(revoked).includes(recoveryId), false);
      assert.equal(fixture.requests.length, beforeForeign);
      assert.equal(fixture.videoPosts, 1);
    });
  } finally { await fixture.close(); }
});

test("strict MCP input rejects caller observations and does not resolve unsupported models", async () => {
  let getterCalls = 0;
  const diagnostics = new Map([["hailuo-01-live", async () => { getterCalls += 1; return diagnosticFixture(); }]]);
  const server = new McpServer({ name: "video-recovery-diagnostic-input-test", version: "1.0.0" });
  registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools(server, { diagnostics });
  await withClient(server, async (client) => {
    const valid = { model_id: "hailuo-01-live", link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID };
    const validResult = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME, arguments: valid });
    assert.equal(validResult.isError, undefined);
    assert.deepEqual((validResult.structuredContent as { diagnostic: OwnerReviewedVideoRecoveryDiagnostic }).diagnostic.poll_usage.history_get_calls,
      { count: 256, capped: true });
    assert.equal(getterCalls, 1);

    const withObservations = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
      arguments: { ...valid, observations: { post_disposition: "VALID_ECHO_OBSERVED" } } });
    assert.equal(withObservations.isError, true);
    assert.equal(getterCalls, 1);

    const unconfigured = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
      arguments: { ...valid, model_id: "veo3fast" } });
    assert.equal(unconfigured.isError, true);
    assert.equal(getterCalls, 1);

    const unsupported = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME,
      arguments: { ...valid, model_id: "hailuo-unreviewed" } });
    assert.equal(unsupported.isError, true);
    assert.equal(getterCalls, 1);
  });
});

test("unavailable diagnostics return only a fixed redacted error", async () => {
  const diagnostics = new Map([["hailuo-01-live", async () => {
    throw new Error(`private recovery ${RECOVERY_ID} at https://r2.syntx.ai/private`);
  }]]);
  const server = new McpServer({ name: "video-recovery-diagnostic-redaction-test", version: "1.0.0" });
  registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools(server, { diagnostics });
  await withClient(server, async (client) => {
    const result = await client.callTool({ name: SYNTX_OWNER_GET_VIDEO_RECOVERY_DIAGNOSTIC_TOOL_NAME, arguments: {
      model_id: "hailuo-01-live", link_attempt_id: ATTEMPT, recovery_id: RECOVERY_ID
    } });
    assert.equal(result.isError, true);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RECOVERY_ID), false);
    assert.equal(serialized.includes("https://"), false);
    assert.equal(serialized.includes("private recovery"), false);
  });
});

