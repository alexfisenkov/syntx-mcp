import assert from "node:assert/strict";
import test from "node:test";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  OwnerWan30OmniGenerationService,
  OwnerWan30OmniGenerationServiceError,
  isOwnerWan30OmniGenerationService
} from "../src/application/owner-wan30-omni-generation-service.js";
import type { OwnerWan30OmniGenerationIntent } from "../src/application/owner-wan30-omni-generation-parameters.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG = new DiscoveryCatalogRepository(loadPublicCatalogVersion(CATALOG_VERSION));
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan30-omni-tenant", subject: "wan30-omni-subject" });
const ATTEMPT = "link_wan30_omni_test_000000000001";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const INTENT: OwnerWan30OmniGenerationIntent = Object.freeze({
  model_id: "wan_30_omni",
  prompt: "A new synthetic scene with a paper lantern over calm water.",
  parameters: Object.freeze({ aspect_ratio: "16:9", resolution: "480P", video_duration: 2, prompt_extend: true,
    shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" })
});

interface FixtureOptions {
  readonly ackText?: string;
  readonly ackImageUrl?: string;
  readonly ackObjects?: readonly { type: string; model: string | null }[];
  readonly historyAckObjects?: readonly { type: string; model: string | null }[];
  readonly failSecondAccess?: boolean;
  readonly losePostAck?: boolean;
  readonly unlinkAfterUpload?: boolean;
  readonly unlinkDuringSecondAccess?: boolean;
  readonly unlinkAfterResult?: boolean;
  readonly additionalOtherAuthor?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  let now = Date.parse("2026-10-16T08:00:00.000Z"), accessCalls = 0, uploadCalls = 0, postCalls = 0, unlinked = false;
  const events: Array<{ method: string; path: string; query: Readonly<Record<string, string>>; body: unknown }> = [];
  const jobs = new Map<string, { ack: string; prompt: string; imageUrl: string; video: string }>();
  const counts = { accountReads: 0, accessReads: 0, uploads: 0, chats: 0, generationPosts: 0,
    ownerAckGets: 0, historyGets: 0, resultGets: 0 };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-omni-credential"); }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    if (init?.body instanceof FormData) body = Object.freeze({ destination: init.body.get("destination"),
      check_duplicates: init.body.get("check_duplicates"), model_type: init.body.get("model_type") });
    events.push({ method, path: url.pathname, query: Object.freeze(Object.fromEntries(url.searchParams.entries())), body });
    if (url.pathname === "/api/v1/user/balance") { counts.accountReads += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.accountReads += 1; return Response.json({ active: true, type: "PRO", end_date: "2026-10-17T08:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.accessReads += 1; accessCalls += 1;
      if (options.unlinkDuringSecondAccess && accessCalls === 2) unlinked = true;
      return Response.json({ access: !(options.failSecondAccess && accessCalls === 2), cost: 2, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadCalls += 1; counts.uploads += 1; if (options.unlinkAfterUpload) unlinked = true;
      return Response.json({ files: [{ id: `omni-image-${uploadCalls}`, url: `https://r2.syntx.ai/omni-image-${uploadCalls}.png` }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chats += 1; return Response.json({ uuid: `omni-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      postCalls += 1; counts.generationPosts += 1;
      const request = body as { chat_id: string; prompt: string; settings: { file_urls: readonly { url: string }[] } };
      const job = { ack: String(83000 + postCalls), prompt: request.prompt, imageUrl: request.settings.file_urls[0]!.url,
        video: `https://r2.syntx.ai/omni-output-${postCalls}.mp4` };
      jobs.set(request.chat_id, job);
      if (options.losePostAck) throw new Error("synthetic POST ACK unknown");
      return Response.json({ id: Number(job.ack) });
    }
    const ackMatch = /^\/api\/v1\/chats\/(omni-chat-\d+)\/(\d{1,16})$/u.exec(url.pathname);
    if (ackMatch) {
      counts.ownerAckGets += 1; const job = jobs.get(ackMatch[1]!); assert.ok(job);
      const ackObjects = (options.ackObjects ?? [{ type: "text", model: "wan_30_omni" }, { type: "image", model: "wan_30_omni" }])
        .map((item, index) => ({ id: 84000 + index, message_id: Number(ackMatch[2]), object_type: item.type, model_type: item.model,
          object_text: item.type === "text" ? options.ackText ?? job.prompt : null,
          object_url: item.type === "image" ? options.ackImageUrl ?? job.imageUrl : null,
          completed: null, task_id: null }));
      return Response.json({ id: Number(ackMatch[2]), chat_id: 5812, author_id: 4123, message_object: ackObjects });
    }
    const historyMatch = /^\/api\/v1\/chats\/(omni-chat-\d+)\/messages$/u.exec(url.pathname);
    if (historyMatch) {
      counts.historyGets += 1; const job = jobs.get(historyMatch[1]!); assert.ok(job);
      const ownerObjects = (options.historyAckObjects ?? options.ackObjects ?? [{ type: "text", model: "wan_30_omni" }, { type: "image", model: "wan_30_omni" }])
        .map((item, index) => ({ id: `omni-owner-object-${index}`, message_id: job.ack, object_type: item.type, model_type: item.model }));
      const messages: Array<Record<string, unknown>> = [{ id: job.ack, chat_id: 5812, author_id: 4123, message_object: ownerObjects }];
      if (options.additionalOtherAuthor) messages.push({ id: "omni-unrelated-nonbot", chat_id: 5812, author_id: 9988, message_object: [] });
      messages.push({ id: `omni-bot-${historyMatch[1]}`, chat_id: 5812, author_id: -1, message_object: [{
        id: `omni-video-object-${historyMatch[1]}`, message_id: `omni-bot-${historyMatch[1]}`,
        object_type: "video", model_type: "wan_30_omni" }] });
      const page = Number(url.searchParams.get("page"));
      return Response.json({ messages, pagination: { page, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/(omni-chat-\d+)\/(omni-bot-omni-chat-\d+)$/u.exec(url.pathname);
    if (resultMatch) {
      counts.resultGets += 1; const job = jobs.get(resultMatch[1]!); assert.ok(job);
      const response = Response.json({ id: resultMatch[2], chat_id: 5812, author_id: -1, message_object: [{
        id: `omni-video-object-${resultMatch[1]}`, message_id: resultMatch[2], object_type: "video", model_type: "wan_30_omni",
        completed: true, object_url: job.video }] });
      if (options.unlinkAfterResult) unlinked = true;
      return response;
    }
    if (/\/inprogress$/u.test(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  };
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: unlinked ? "UNLINKED" as const : "LINKED" as const, expires_at: null, linked: !unlinked };
  } } as never);
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl, maxResponseBytes: 1024 * 1024 });
  const createAccountStatusService = () => new AccountStatusService(new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  const createModelAccessService = (_attemptId: string, catalog: DiscoveryCatalogRepository) =>
    new ModelAccessService(catalog, new SyntxHttpClient({ credentialBroker, fetchImpl }), () => now);
  return { binding: BINDING, linkService, chatClient, events, counts, createAccountStatusService, createModelAccessService,
    get now() { return now; }, advance(ms: number) { now += ms; }, setUnlinked() { unlinked = true; } };
}

function service(f: ReturnType<typeof fixture>, resolveClient: (attemptId: string) => unknown = () => f.chatClient) {
  return new OwnerWan30OmniGenerationService({ binding: f.binding, linkService: f.linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient, createAccountStatusService: f.createAccountStatusService,
    createModelAccessService: f.createModelAccessService, now: () => f.now, timeoutMs: 5_000 });
}
async function upload(target: OwnerWan30OmniGenerationService) {
  return target.uploadOmniImage({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"), filename: "omni.png", mime_type: "image/png" });
}

test("one Omni image upload and generation bind exact wire ACK, quote tuple, and same-model video", async () => {
  const f = fixture(), target = service(f);
  try {
    assert.equal(isOwnerWan30OmniGenerationService(target), true);
    const image = await upload(target);
    assert.equal(image.model_id, "wan_30_omni"); assert.equal(Object.hasOwn(image, "url"), false);
    assert.equal((await upload(target)).image_handle, image.image_handle);
    const result = await target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle });
    assert.equal(result.status, "completed"); assert.equal(result.model_id, "wan_30_omni");
    assert.equal(result.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(result.backend_acceptance, "UNPROVEN"); assert.equal(result.provider_terminal_status, "UNPROVEN");
    assert.equal(result.cost_input_confidence, "UI_QUOTE_CALLER_OBSERVED_SINGLE_TUPLE_NOT_BILLING");
    assert.equal(f.counts.uploads, 1); assert.equal(f.counts.chats, 1); assert.equal(f.counts.generationPosts, 1);
    assert.equal(f.counts.ownerAckGets, 1); assert.equal(f.counts.resultGets, 1);
    const quotes = f.events.filter((event) => event.path === "/api/v2/get_model_info");
    assert.deepEqual(quotes.map((event) => event.query), [
      { ai_name: "wan_video", model_type: "wan_30_omni", resolution: "480P", video_duration: "2", duration: "0", rendering_speed: "basic" },
      { ai_name: "wan_video", model_type: "wan_30_omni", resolution: "480P", video_duration: "2", duration: "0", rendering_speed: "basic" }
    ]);
    const post = f.events.find((event) => event.path === "/api/v1/video/generate"); assert.ok(post);
    const wire = post.body as { prompt: string; settings: Record<string, unknown> };
    assert.match(wire.prompt, /^<<<https:\/\/r2\.syntx\.ai\/omni-image-\d+\.png>>> A new synthetic scene/u);
    assert.deepEqual(wire.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/omni-image-1.png" }]);
    assert.equal(wire.settings.model_type, "wan_30_omni");
    const duplicate = await target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle });
    assert.equal(duplicate.recovery_id, result.recovery_id); assert.equal(f.counts.generationPosts, 1);
  } finally { await target.close(); }
});

test("owner ACK prompt mismatch remains unknown and cannot replay", async () => {
  const f = fixture({ ackText: "A new synthetic scene with a paper lantern over calm water." }), target = service(f);
  try {
    const image = await upload(target);
    await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
      (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && !!error.recovery_id);
    const recoveryId = (await target.listRecoveries({ attemptId: ATTEMPT })).recoveries[0]!.recovery_id;
    await assert.rejects(target.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.generationPosts, 1); assert.equal(f.counts.resultGets, 0);
  } finally { await target.close(); }
});

test("ACK must be exactly text plus same-model image", async (t) => {
  const cases = [
    [{ type: "text", model: "wan_30_omni" }],
    [{ type: "text", model: "wan_30_omni" }, { type: "text", model: "wan_30_omni" }],
    [{ type: "text", model: "wan_30_reference" }, { type: "image", model: "wan_30_omni" }]
  ] as const;
  for (const ackObjects of cases) await t.test(JSON.stringify(ackObjects), async () => {
    const f = fixture({ ackObjects }), target = service(f);
    try {
      const image = await upload(target);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
      assert.equal(f.counts.resultGets, 0); assert.equal(f.counts.generationPosts, 1);
    } finally { await target.close(); }
  });
  await t.test("exact text with an independent wrong image URL remains unverified", async () => {
    const f = fixture({ ackImageUrl: "https://r2.syntx.ai/unmatched-omni-image.png" }), target = service(f);
    try {
      const image = await upload(target);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
      assert.equal(f.counts.ownerAckGets, 1); assert.equal(f.counts.resultGets, 0); assert.equal(f.counts.generationPosts, 1);
    } finally { await target.close(); }
  });
});

test("owner ACK and history accept text/image object order independently", async (t) => {
  const forward = [{ type: "text", model: "wan_30_omni" }, { type: "image", model: "wan_30_omni" }] as const;
  const reverse = [...forward].reverse();
  for (const [name, options] of [
    ["reverse exact-message ACK with forward history", { ackObjects: reverse, historyAckObjects: forward }],
    ["forward exact-message ACK with reverse history", { ackObjects: forward, historyAckObjects: reverse }]
  ] as const) await t.test(name, async () => {
    const f = fixture(options), target = service(f);
    try {
      const image = await upload(target);
      const result = await target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle });
      assert.equal(result.status, "completed"); assert.equal(f.counts.ownerAckGets, 1); assert.equal(f.counts.resultGets, 1);
    } finally { await target.close(); }
  });
});

test("second preflight failure or principal change blocks the only generation POST", async (t) => {
  await t.test("finite quote failure leaves the one-shot claim", async () => {
    const f = fixture({ failSecondAccess: true }), target = service(f);
    try {
      const image = await upload(target);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "PREFLIGHT_FAILED");
      assert.equal(f.counts.chats, 1); assert.equal(f.counts.generationPosts, 0);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "INTENT_ALREADY_CLAIMED");
    } finally { await target.close(); }
  });
  await t.test("unlink during second preflight is caught before dispatch", async () => {
    const f = fixture({ unlinkDuringSecondAccess: true }), target = service(f);
    try {
      const image = await upload(target);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "PRINCIPAL_NOT_LINKED");
      assert.equal(f.counts.chats, 1); assert.equal(f.counts.generationPosts, 0);
    } finally { await target.close(); }
  });
});

test("lost POST ACK survives handle expiry and recovers by the same GET only", async (t) => {
  const f = fixture({ losePostAck: true }), target = service(f);
  try {
    const image = await upload(target);
    await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
      (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && !!error.recovery_id);
    const recoveryId = (await target.listRecoveries({ attemptId: ATTEMPT })).recoveries[0]!.recovery_id;
    f.advance(16 * 60_000);
    const result = await target.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "completed"); assert.equal(f.counts.generationPosts, 1);
    assert.equal(f.counts.historyGets, 1); assert.equal(f.counts.ownerAckGets, 1); assert.equal(f.counts.resultGets, 1);
  } finally { await target.close(); }
  await t.test("any second non-bot history row keeps lost ACK ambiguous", async () => {
    const f = fixture({ losePostAck: true, additionalOtherAuthor: true }), target = service(f);
    try {
      const image = await upload(target);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
      const recoveryId = (await target.listRecoveries({ attemptId: ATTEMPT })).recoveries[0]!.recovery_id;
      await assert.rejects(target.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
      assert.equal(f.counts.generationPosts, 1); assert.equal(f.counts.ownerAckGets, 0); assert.equal(f.counts.resultGets, 0);
    } finally { await target.close(); }
  });
  await t.test("a unique reverse-order history candidate recovers through the exact owner GET", async () => {
    const f = fixture({ losePostAck: true, historyAckObjects: [{ type: "image", model: "wan_30_omni" }, { type: "text", model: "wan_30_omni" }] }), target = service(f);
    try {
      const image = await upload(target);
      await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
        (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
      const recoveryId = (await target.listRecoveries({ attemptId: ATTEMPT })).recoveries[0]!.recovery_id;
      const result = await target.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
      assert.equal(result.status, "completed"); assert.equal(f.counts.generationPosts, 1); assert.equal(f.counts.resultGets, 1);
    } finally { await target.close(); }
  });
});

test("revocation during result GET prevents artifact publication", async () => {
  const f = fixture({ unlinkAfterResult: true }), target = service(f);
  try {
    const image = await upload(target);
    await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
      (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(f.counts.generationPosts, 1); assert.equal(f.counts.resultGets, 1);
  } finally { await target.close(); }
});

test("unconsumed image handle expires before chat creation", async () => {
  const f = fixture(), target = service(f);
  try {
    const image = await upload(target); f.advance(16 * 60_000);
    await assert.rejects(target.generate({ attemptId: ATTEMPT, input: INTENT, image_handle: image.image_handle }),
      (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "REFERENCE_EXPIRED");
    assert.equal(f.counts.chats, 0); assert.equal(f.counts.generationPosts, 0);
  } finally { await target.close(); }
});

test("close drains state and refuses later operations", async () => {
  const f = fixture(), target = service(f); await upload(target); await target.close();
  await assert.rejects(target.listRecoveries({ attemptId: ATTEMPT }),
    (error: unknown) => error instanceof OwnerWan30OmniGenerationServiceError && error.code === "SERVICE_CLOSED");
});
