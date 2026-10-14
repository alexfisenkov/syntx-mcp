import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxSubscription } from "../src/adapter/syntx/account-decoder.js";
import type { ModelAccessResult } from "../src/application/model-access.js";
import {
  OwnerHailuoLiveT2vGenerationService,
  OwnerReviewedNoReferenceT2vServiceError
} from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuoLiveT2vProfile } from "../src/application/owner-hailuo-live-t2v-profile.js";

const ATTEMPT = "link_owned_video_diagnostic_owner_0001";
const OTHER_ATTEMPT = "link_owned_video_diagnostic_owner_0002";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "owned-diagnostic-tenant", subject: "owned-diagnostic-owner" });

type Scenario = "empty" | "lost_ack" | "unsafe_result" | "unknown_bot";
interface RequestRecord { readonly method: string; readonly path: string }

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

async function setup(scenario: Scenario) {
  let now = Date.now();
  const ids = [ATTEMPT, OTHER_ATTEMPT];
  let attemptIndex = 0;
  const authStore = new InMemoryAuthLinkStore(() => now);
  const authProvider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic-diagnostic", approval_url: "https://syntx.ai/auth" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-owned-credential" });
      return { state: "LINKED" };
    }
  };
  const linkService = new PerUserLinkService(authProvider, authStore, {
    now: () => now,
    attemptIdGenerator: () => ids[attemptIndex++]!
  });
  for (const attemptId of ids) {
    await linkService.createAttempt(BINDING);
    await linkService.issueHandoff(BINDING, attemptId);
    await linkService.checkAttempt(BINDING, attemptId);
  }

  const requests: RequestRecord[] = [];
  let videoPosts = 0;
  let inProgressReads = 0;
  let subscriptionReads = 0;
  let modelAccessReads = 0;
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({ method, path: url.pathname });
    if (url.pathname === "/api/v1/chats" && method === "POST") return response({ uuid: "diagnostic-chat-1" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      videoPosts += 1;
      if (scenario === "lost_ack") throw new Error("synthetic transport timeout");
      return response({ id: "diagnostic-echo-1" });
    }
    if (url.pathname === "/api/v1/chats/diagnostic-chat-1/inprogress" && method === "GET") {
      inProgressReads += 1;
      if (scenario === "empty") return response([]);
      if (scenario === "unknown_bot" || scenario === "unsafe_result") {
        return response(inProgressReads === 1 ? [{ message_id: "diagnostic-bot-1", message_object_id: "diagnostic-object-1",
          object_type: "video", model_type: scenario === "unknown_bot" ? "other-model" : "hailuo-01-live" }] : []);
      }
    }
    if (url.pathname === "/api/v1/chats/diagnostic-chat-1/messages" && method === "GET") {
      return response({ messages: [{ id: "diagnostic-echo-1", chat_id: 701, author_id: 12345, message_object: [] }],
        pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
    }
    const message = url.pathname.match(/^\/api\/v1\/chats\/diagnostic-chat-1\/([^/]+)$/u);
    if (message && method === "GET") {
      const messageId = message[1]!;
      if (messageId === "diagnostic-echo-1") return response({ id: messageId, chat_id: 701, author_id: 12345, message_object: [] });
      return response({ id: messageId, chat_id: 701, author_id: -1, message_object: [{ id: "diagnostic-object-1",
        message_id: messageId, object_type: "video", model_type: "hailuo-01-live", completed: true,
        object_url: "https://example.invalid/not-a-ready-video.mp4" }] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  };
  const profile = createOwnerHailuoLiveT2vProfile();
  const service = new OwnerHailuoLiveT2vGenerationService({
    profile,
    binding: BINDING,
    linkService,
    resolveSubscription: async (): Promise<SyntxSubscription> => {
      subscriptionReads += 1;
      return { active: true, plan_type: "PAID", end_date: null, end_date_kind: null };
    },
    async resolveModelAccess(): Promise<ModelAccessResult> {
      modelAccessReads += 1;
      return {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${profile.catalog.fetched_at}.${profile.catalog.source_hashes.models.slice(7, 19)}`,
      model_id: profile.modelId, ai_name: profile.aiName, model_type: profile.modelType, account_read_live: true,
      parameter_keys: ["resolution", "video_duration"], parameters_redacted: true, access: true, cost: null,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(now).toISOString()
      };
    },
    resolveChatClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-owned-credential"); } },
      fetchImpl, requestTimeoutMs: 500
    }),
    now: () => now,
    wait: async () => undefined,
    videoTimeoutMs: 5_000
  });
  return {
    service, linkService, requests,
    get videoPosts() { return videoPosts; },
    get entitlementReads() { return { subscriptionReads, modelAccessReads }; },
    async generateUnknown() {
      const error = await service.generate({ attemptId: ATTEMPT, prompt: "diagnostic-private-prompt", resolution: "720p", video_duration: 6 })
        .catch((caught: unknown) => caught);
      assert.ok(error instanceof OwnerReviewedNoReferenceT2vServiceError);
      assert.equal(error.code, "OUTCOME_UNKNOWN");
      assert.ok(error.recovery_id);
      return error.recovery_id;
    },
    advance(milliseconds: number) { now += milliseconds; }
  };
}

test("diagnostic reflects real owned calls, is redacted, and reconciles with GETs only", async () => {
  const state = await setup("empty");
  try {
    const recoveryId = await state.generateUnknown();
    const beforeRead = state.requests.length;
    const entitlementReads = state.entitlementReads;
    const diagnostic = await state.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(state.requests.length, beforeRead, "diagnostic lookup performs no native HTTP calls");
    assert.deepEqual(state.entitlementReads, entitlementReads, "diagnostic lookup performs no account or cost reads");
    assert.deepEqual(diagnostic, {
      phase: "IN_PROGRESS_GET", post_disposition: "VALID_ECHO_OBSERVED", ack_observation: "VALID_ECHO_OBSERVED",
      history_observation: "READ_NO_UNIQUE_BINDING", result_binding_observation: "READ_NO_VERIFIED_ARTIFACT",
      last_safe_error_code: "OUTCOME_UNKNOWN", no_artifact_reason: "NO_IN_PROGRESS_BOT_MATCH",
      poll_usage: { history_get_calls: { count: 1, capped: false }, in_progress_get_calls: { count: 20, capped: false }, result_get_calls: { count: 1, capped: false } }
    });
    assert.equal(Object.isFrozen(diagnostic), true);
    assert.equal(Object.isFrozen(diagnostic.poll_usage), true);
    const serialized = JSON.stringify(diagnostic);
    for (const privateValue of [ATTEMPT, recoveryId, "diagnostic-chat-1", "diagnostic-private-prompt", "diagnostic-echo-1", "https://"]) {
      assert.equal(serialized.includes(privateValue), false);
    }

    const readsBeforeReconcile = state.requests.filter((request) => request.method === "GET").length;
    await assert.rejects(state.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(state.videoPosts, 1, "reconcile never replays the generation POST");
    assert.ok(state.requests.filter((request) => request.method === "GET").length > readsBeforeReconcile);
    assert.equal(state.requests.filter((request) => request.method === "POST" && request.path === "/api/v1/video/generate").length, 1);
  } finally { await state.service.close(); }
});

test("lost POST acknowledgement remains MAY_HAVE_BEEN_SENT and never becomes accepted", async () => {
  const state = await setup("lost_ack");
  try {
    const recoveryId = await state.generateUnknown();
    const beforeRead = state.requests.length;
    const diagnostic = await state.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(state.requests.length, beforeRead);
    assert.equal(diagnostic.post_disposition, "MAY_HAVE_BEEN_SENT");
    assert.equal(diagnostic.ack_observation, "NOT_OBSERVED");
    assert.equal(diagnostic.phase, "POST_CALL_STARTED");
    assert.equal(diagnostic.poll_usage.result_get_calls.count, 0);
    assert.equal("provider_accepted" in diagnostic, false);
  } finally { await state.service.close(); }
});

test("unknown bot rows and unverified result URLs produce their observed branches only", async () => {
  const unknownBot = await setup("unknown_bot");
  try {
    const recoveryId = await unknownBot.generateUnknown();
    const diagnostic = await unknownBot.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(diagnostic.no_artifact_reason, "NO_IN_PROGRESS_BOT_MATCH");
    assert.equal(diagnostic.poll_usage.in_progress_get_calls.count, 20);
    assert.equal(diagnostic.poll_usage.result_get_calls.count, 1);
  } finally { await unknownBot.service.close(); }

  const unsafeResult = await setup("unsafe_result");
  try {
    const recoveryId = await unsafeResult.generateUnknown();
    const diagnostic = await unsafeResult.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(diagnostic.result_binding_observation, "READ_NO_VERIFIED_ARTIFACT");
    assert.ok(diagnostic.poll_usage.result_get_calls.count >= 1);
    assert.equal(diagnostic.no_artifact_reason, "NOT_CAPTURED");
  } finally { await unsafeResult.service.close(); }
});

test("foreign, expired or revoked owner handles are denied without native reads", async () => {
  const state = await setup("empty");
  try {
    const recoveryId = await state.generateUnknown();
    const beforeForeign = state.requests.length;
    await assert.rejects(state.service.getRecoveryDiagnostic({ attemptId: OTHER_ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    assert.equal(state.requests.length, beforeForeign);

    assert.throws(() => state.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: "recovery_malformed" }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "INVALID_REQUEST");
    assert.equal(state.requests.length, beforeForeign);

    await state.linkService.revoke(BINDING, ATTEMPT);
    const beforeRevoked = state.requests.length;
    await assert.rejects(state.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    assert.equal(state.requests.length, beforeRevoked);
  } finally { await state.service.close(); }

  const expired = await setup("empty");
  try {
    const recoveryId = await expired.generateUnknown();
    expired.advance(Number.MAX_SAFE_INTEGER * 2);
    const beforeExpired = expired.requests.length;
    await assert.rejects(expired.service.getRecoveryDiagnostic({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerReviewedNoReferenceT2vServiceError && error.code === "RECOVERY_NOT_FOUND");
    assert.equal(expired.requests.length, beforeExpired);
  } finally { await expired.service.close(); }
});
