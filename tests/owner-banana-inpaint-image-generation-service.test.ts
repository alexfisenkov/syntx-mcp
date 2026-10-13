import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
} from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../src/application/owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "../src/application/owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";
import { createOwnerBananaInpaintImageGenerationService } from "../src/application/owner-banana-inpaint-image-generation-service.js";

test("Banana Inpaint generation service publishes its owner-scoped recovery ABI", async () => {
  const module = await import("../src/application/owner-banana-inpaint-image-generation-service.js");
  assert.equal(typeof module.createOwnerBananaInpaintImageGenerationService, "function");
  assert.equal(typeof module.isOwnerBananaInpaintImageGenerationService, "function");
  assert.deepEqual(module.OWNER_BANANA_INPAINT_IMAGE_GENERATION_PHASES, [
    "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
    "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
  ]);
});

const ATTEMPT = "link_inpaint_service_test_0123456789";
const SECOND_ATTEMPT = "link_inpaint_service_other_0123456789";
const BINDING = Object.freeze({ tenant_id: "inpaint-service-tenant", subject: "inpaint-service-subject" });
const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CATALOG = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, join(process.cwd(), "catalog"));

function response(payload: unknown): Response { return Response.json(payload); }
function makeFixture(options: { unknownAck?: boolean; access?: boolean; subscriptionActive?: boolean; globalAccessCatalog?: boolean;
  blockFirstBalance?: boolean; rotatingUrl?: boolean; historyMorePages?: boolean; unknownResultField?: boolean; manyObjects?: boolean;
  resultObjectCount?: number; holdResult?: boolean } = {}) {
  let currentNow = NOW;
  let uploadCount = 0;
  let chatCount = 0;
  let postCount = 0;
  let accountReads = 0;
  let accessReads = 0;
  let resultReads = 0;
  let historyReads = 0;
  let holdResult = options.holdResult ?? false;
  let firstBalanceStarted!: () => void;
  const firstBalanceGate = new Promise<void>((resolve) => { firstBalanceStarted = resolve; });
  const auth: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-inpaint-service-credential");
  } };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      uploadCount += 1;
      return response({ files: [{ id: uploadCount, file_id: String(uploadCount), url: `https://r2.syntx.ai/923/${uploadCount}.png`,
        mime_type: "image/png", size: PNG.byteLength, status: "accepted" }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") { chatCount += 1; return response({ uuid: `inpaint-923-chat-${chatCount}` }); }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      postCount += 1;
      if (options.unknownAck) throw new Error("synthetic server accepted the POST but its ACK was lost");
      return response({ id: `inpaint-923-ack-${postCount}` });
    }
    if (/\/api\/v1\/chats\/[^/]+\/inprogress$/u.test(url.pathname)) return response([]);
    if (/\/api\/v1\/chats\/[^/]+\/messages$/u.test(url.pathname)) {
      historyReads += 1;
      const chat = url.pathname.split("/").at(-2)!;
      const n = Number(chat.split("-").at(-1));
      const resultRow = (suffix = "") => ({ id: `inpaint-923-result-${n}${suffix}`, chat_id: 412, author_id: -1, message_object:
        Array.from({ length: options.resultObjectCount ?? (options.manyObjects ? 40 : 2) }, (_, index) => ({
          id: `inpaint-923-object-${n}${suffix}-${index}`, message_id: `inpaint-923-result-${n}${suffix}`,
          object_type: index % 2 === 0 ? "image" : "image_url", model_type: null
        })) });
      if (options.unknownAck) return response({ messages: [resultRow()], pagination: { page: 1, page_size: 10,
        total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
      if (options.historyMorePages) return response({ messages: [
        { id: `inpaint-923-ack-${n}`, chat_id: 412, author_id: 7, message_object: [] },
        ...Array.from({ length: 9 }, (_, index) => resultRow(`-p${index + 1}`))
      ], pagination: { page: 1, page_size: 10, total_count: 11, total_pages: 2, has_next: true, has_previous: false } });
      return response({ messages: [
        { id: `inpaint-923-ack-${n}`, chat_id: 412, author_id: 7, message_object: [] },
        resultRow(), resultRow("-extra")
      ], pagination: { page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (/\/api\/v1\/chats\/[^/]+\/inpaint-923-result-\d+(?:-extra|-p\d+)?$/u.test(url.pathname)) {
      resultReads += 1;
      const messageId = url.pathname.split("/").at(-1)!;
      return response({ id: messageId, chat_id: 412, author_id: -1, message_object:
        Array.from({ length: options.resultObjectCount ?? (options.manyObjects ? 40 : 2) }, (_, index) => ({
          id: `ready-${messageId}-${index}`, object_type: index % 2 === 0 ? "image" : "image_url",
          ...(holdResult ? {} : { object_url: `https://r2.syntx.ai/923/${messageId}${options.rotatingUrl ? `-r${resultReads}` : ""}-${index}.${index % 2 === 0 ? "png" : "webp"}` }),
          completed: !holdResult, ...(options.unknownResultField && index === 0 ? { future_field: "unrecognized" } : {})
        })) });
    }
    if (url.pathname === "/api/v1/user/balance") {
      accountReads += 1;
      if (options.blockFirstBalance && accountReads === 1) {
        firstBalanceStarted();
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new Error("synthetic balance read aborted"));
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener("abort", abort, { once: true });
          firstBalanceGate.then(() => { signal?.removeEventListener("abort", abort); resolve(); });
        });
      }
      return response({ balance: "1000" });
    }
    if (url.pathname === "/api/v1/user/subscription") { accountReads += 1; return response({ active: options.subscriptionActive ?? true,
      type: "PRO", end_date: "2099-12-31T00:00:00.000Z" }); }
    if (url.pathname === "/api/v2/get_model_info") { accessReads += 1; return response({ access: options.access ?? true, cost: 3, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: null }); }
    throw new Error(`Unexpected synthetic request ${init?.method ?? "GET"} ${url.pathname}`);
  };
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } };
  const chatClient = new SyntxChatHttpClient({ credentialBroker: auth, fetchImpl, requestTimeoutMs: 2_000 });
  const httpClient = new SyntxHttpClient({ credentialBroker: auth, fetchImpl, requestTimeoutMs: 2_000 });
  const originalReferenceService = new OwnerBananaInpaintOriginalReferenceService({ binding: BINDING, linkService,
    catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => chatClient, now: () => currentNow });
  const paintedCompositeReferenceService = new OwnerBananaInpaintPaintedCompositeReferenceService({ originalReferenceService,
    binding: BINDING, linkService, catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory: SETTINGS, settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    resolveClient: () => chatClient, now: () => currentNow });
  const auxiliaryReferenceService = new OwnerBananaInpaintAuxiliaryReferenceService({ binding: BINDING, linkService,
    catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => chatClient, now: () => currentNow });
  const service = createOwnerBananaInpaintImageGenerationService({ binding: BINDING, linkService, originalReferenceService,
    paintedCompositeReferenceService, auxiliaryReferenceService, resolveChatClient: () => chatClient,
    createAccountStatusService: () => new AccountStatusService(httpClient, () => currentNow),
    createModelAccessService: (_attemptId: string, catalog: DiscoveryCatalogRepository) => new ModelAccessService(
      options.globalAccessCatalog ? loadSelectedDiscoveryCatalog().discoveryCatalog : catalog, httpClient, () => currentNow),
    now: () => currentNow, pollDelayMs: 0, maxPollAttempts: 1 });
  return { linkService, chatClient, httpClient, originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService,
    service, setNow(value: number) { currentNow = value; }, waitForFirstBalance: () => firstBalanceGate,
    counts: () => ({ uploadCount, chatCount, postCount, accountReads, accessReads, historyReads, resultReads }),
    setHoldResult(value: boolean) { holdResult = value; } };
}

test("generates all four variants and nine explicit size choices with two fresh c5 preflights", async (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.service.close());
  assert.throws(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana", prompt: "x", image_size: null,
    original_handle: "original-handle", painted_handle: "painted-handle", auxiliary_reference_handle: null, file_url: "https://evil.invalid/" }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  const selections = [
    ["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"], ["banana3_light", "1K"]
  ] as const;
  for (let index = 0; index < selections.length; index += 1) {
    const [variant, image_size] = selections[index]!;
    const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant,
      content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
    const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant,
      original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "painted.png", mime_type: "image/png" });
    const auxiliary = index === selections.length - 1 ? await fixture.auxiliaryReferenceService.upload({ attemptId: ATTEMPT, variant,
      content_base64: PNG.toString("base64"), filename: "extra.png", mime_type: "image/png" }) : null;
    const result = await fixture.service.generate({ attemptId: ATTEMPT, variant, image_size,
      prompt: `synthetic result ${variant} ${image_size ?? "base"}`, original_handle: original.reference_handle,
      painted_handle: painted.painted_handle, auxiliary_reference_handle: auxiliary?.reference_handle ?? null });
    assert.equal(result.status, "result_observed");
    assert.equal(result.variant, variant);
    assert.equal(result.model_type, variant);
    assert.equal(result.ai_name, "banana");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.artifacts.length, 4, "both result messages and every ready image object are surfaced");
    assert.equal(result.artifacts[0]?.url, `https://r2.syntx.ai/923/inpaint-923-result-${index + 1}-0.png`);
    assert.equal(result.artifacts[3]?.url, `https://r2.syntx.ai/923/inpaint-923-result-${index + 1}-extra-1.webp`);
    assert.equal(result.artifacts[0]?.mime_type, null);
    assert.equal(result.artifacts[0]?.width, null);
  }
  assert.deepEqual(fixture.counts(), { uploadCount: 19, chatCount: 9, postCount: 9, accountReads: 36,
    accessReads: 18, historyReads: 9, resultReads: 18 });
});

test("returns a stable 64-item first page and an owned 16-item second page for 80 ready artifacts", async (t) => {
  const fixture = makeFixture({ manyObjects: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana3", content_base64: PNG.toString("base64"),
    filename: "page-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana3",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "page-mask.png", mime_type: "image/png" });
  const generated = await fixture.service.generate({ attemptId: ATTEMPT, variant: "banana3", prompt: "eighty observed images",
    image_size: "2K", original_handle: original.reference_handle, painted_handle: painted.painted_handle,
    auxiliary_reference_handle: null });
  const result = generated as typeof generated & { result_id: string; observed_total: number; next_offset: number | null; has_more: boolean };
  assert.equal(result.status, "result_observed");
  assert.equal(result.artifacts.length, 64);
  assert.equal(result.observed_total, 80);
  assert.equal(result.next_offset, 64);
  assert.equal(result.has_more, true);
  assert.match(result.result_id, /^banana_inpaint_result_[0-9a-f-]{36}$/u);
  const beforePageRead = fixture.counts();
  const service = fixture.service as unknown as { getResultPage(input: { attemptId: string; result_id: string; offset: number; limit: number }): Promise<{
    result_id: string; offset: number; limit: number; observed_total: number; next_offset: number | null; has_more: boolean;
    artifacts: readonly { message_id: string; object_index: number }[];
  }> };
  const secondPage = await service.getResultPage({ attemptId: ATTEMPT, result_id: result.result_id, offset: 64, limit: 64 });
  assert.deepEqual({ result_id: secondPage.result_id, offset: secondPage.offset, limit: secondPage.limit,
    observed_total: secondPage.observed_total, next_offset: secondPage.next_offset, has_more: secondPage.has_more },
  { result_id: result.result_id, offset: 64, limit: 64, observed_total: 80, next_offset: null, has_more: false });
  assert.equal(secondPage.artifacts.length, 16);
  assert.equal(secondPage.artifacts[0]?.message_id, "inpaint-923-result-1-extra");
  assert.equal(secondPage.artifacts[0]?.object_index, 24);
  assert.equal(secondPage.artifacts.at(-1)?.object_index, 39);
  const terminalPage = await service.getResultPage({ attemptId: ATTEMPT, result_id: result.result_id, offset: 80, limit: 64 });
  assert.deepEqual(terminalPage.artifacts, [], "offset equal to the observed total is a valid empty terminal page");
  await assert.rejects(() => service.getResultPage({ attemptId: ATTEMPT, result_id: result.result_id, offset: 81, limit: 64 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_PAGE_INVALID");
  await assert.rejects(() => service.getResultPage({ attemptId: SECOND_ATTEMPT, result_id: result.result_id, offset: 0, limit: 64 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_NOT_FOUND");
  fixture.setNow(NOW + 16 * 60_000);
  await assert.rejects(() => service.getResultPage({ attemptId: ATTEMPT, result_id: result.result_id, offset: 0, limit: 64 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_NOT_FOUND",
    "an expired owned pair cannot continue to authorize cached result URLs");
  assert.equal(fixture.counts().postCount, beforePageRead.postCount);
  assert.equal(fixture.counts().resultReads, beforePageRead.resultReads, "cached page reads perform no provider GET");
});

test("does not turn a zero-observation unknown outcome into an empty completed result page", async (t) => {
  const fixture = makeFixture({ unknownAck: true, resultObjectCount: 0 });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana3",
    content_base64: PNG.toString("base64"), filename: "zero-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana3",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "zero-mask.png", mime_type: "image/png" });
  let recoveryId = "";
  await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana3", prompt: "no observed output yet",
    image_size: "1K", original_handle: original.reference_handle, painted_handle: painted.painted_handle,
    auxiliary_reference_handle: null }), (error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
        !("recovery_id" in error) || typeof error.recovery_id !== "string") return false;
    recoveryId = error.recovery_id;
    return true;
  });
  assert.equal(fixture.counts().postCount, 1);
  await assert.rejects(() => fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
  await assert.rejects(() => fixture.service.getResultPage({ attemptId: ATTEMPT,
    result_id: "banana_inpaint_result_00000000-0000-4000-8000-000000000000", offset: 0, limit: 64 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_NOT_FOUND");
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 1,
    "zero observed artifacts preserve the unresolved recovery hold");
  assert.equal(fixture.counts().postCount, 1, "empty observations do not authorize another POST");
});

test("retains a lost-ACK hold for same-client GET-only recovery after pair TTL", async (t) => {
  const fixture = makeFixture({ unknownAck: true, rotatingUrl: true });
  t.after(() => fixture.service.close());
  const uploadPair = async (attemptId: string) => {
    const original = await fixture.originalReferenceService.upload({ attemptId, variant: "banana3", content_base64: PNG.toString("base64"),
      filename: "same-original.png", mime_type: "image/png" });
    const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId, variant: "banana3",
      original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "same-mask.png", mime_type: "image/png" });
    return { original, painted };
  };
  const first = await uploadPair(ATTEMPT);
  let recoveryId = "";
  await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana3", prompt: "same paid intent",
    image_size: "2K", original_handle: first.original.reference_handle, painted_handle: first.painted.painted_handle,
    auxiliary_reference_handle: null }), (error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
        !("recovery_id" in error) || typeof error.recovery_id !== "string") return false;
    recoveryId = error.recovery_id;
    return true;
  });
  assert.equal(fixture.counts().postCount, 1);
  const beforeReconcile = fixture.counts();
  fixture.setNow(NOW + 16 * 60_000);
  const recovered = await fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "partial_results", "private native chat ownership permits reads without fabricating an ACK");
  assert.equal(recovered.artifacts.length, 2);
  assert.equal(recovered.recovery_id, recoveryId);
  const recoveredPage = await fixture.service.getResultPage({ attemptId: ATTEMPT,
    result_id: (recovered as typeof recovered & { result_id: string }).result_id, offset: 0, limit: 1 });
  assert.equal(recoveredPage.artifacts.length, 1);
  const afterReconcile = fixture.counts();
  assert.ok(afterReconcile.historyReads > beforeReconcile.historyReads, "same native client reads its own private chat history");
  assert.ok(afterReconcile.resultReads > beforeReconcile.resultReads, "same native client reads its owned result context");
  assert.equal(afterReconcile.postCount, 1, "result recovery issues no generation replay");
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 1,
    "partial observation preserves the independent unknown-outcome hold");
  const rotated = await fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(rotated.status, "partial_results");
  assert.equal(rotated.artifacts[0]?.url, "https://r2.syntx.ai/923/inpaint-923-result-1-r2-0.png",
    "recovery refreshes only the same-client-owned output URL");
  assert.equal(fixture.counts().postCount, 1);
  await fixture.service.invalidateAttempt(SECOND_ATTEMPT);
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 1,
    "foreign attempt invalidation cannot revoke the owning recovery");
  await fixture.service.invalidateAttempt(ATTEMPT);
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 0,
    "revoked-epoch recoveries are not presented to the owner");
  await assert.rejects(() => fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "RECOVERY_NOT_FOUND");

  const second = await uploadPair(SECOND_ATTEMPT);
  await assert.rejects(() => fixture.service.generate({ attemptId: SECOND_ATTEMPT, variant: "banana3", prompt: "same paid intent",
    image_size: "2K", original_handle: second.original.reference_handle, painted_handle: second.painted.painted_handle,
    auxiliary_reference_handle: null }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INTENT_ALREADY_CLAIMED");
  assert.equal(fixture.counts().postCount, 1, "same ordered role bytes cannot be replayed using a new attempt or opaque handles");
  assert.equal(fixture.counts().chatCount, 1, "semantic hold is checked before opening a fresh chat");
});

test("history beyond the first page remains partial while presenting every ready object observed in that page", async (t) => {
  const fixture = makeFixture({ historyMorePages: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana2", content_base64: PNG.toString("base64"),
    filename: "history-cap-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana2",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "history-cap-mask.png", mime_type: "image/png" });
  const result = await fixture.service.generate({ attemptId: ATTEMPT, variant: "banana2", prompt: "capped history", image_size: "1K",
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null });
  assert.equal(result.status, "partial_results");
  assert.equal(result.artifacts.length, 18);
  assert.ok(result.diagnostics.includes("HISTORY_HAS_MORE_PAGES"));
  assert.ok(result.recovery_id);
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 1);
  assert.equal(fixture.counts().postCount, 1);
});

test("unknown result fields prevent terminal status while still surfacing checked ready objects", async (t) => {
  const fixture = makeFixture({ unknownResultField: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana3_light",
    content_base64: PNG.toString("base64"), filename: "unknown-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana3_light",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "unknown-mask.png", mime_type: "image/png" });
  const result = await fixture.service.generate({ attemptId: ATTEMPT, variant: "banana3_light", prompt: "future result fields", image_size: "1K",
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null });
  assert.equal(result.status, "partial_results");
  assert.equal(result.artifacts.length, 4);
  assert.ok(result.diagnostics.includes("UNRECOGNIZED_OBJECT_FIELDS"));
  assert.ok(result.recovery_id);
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 1);
});

test("denied account, access, or wrong global catalog fail before chat/POST and create no paid hold", async (t) => {
  const cases = [
    { name: "inactive subscription", options: { subscriptionActive: false } },
    { name: "denied model access", options: { access: false } },
    { name: "global E551 substituted for c5", options: { globalAccessCatalog: true } }
  ] as const;
  for (const entry of cases) {
    const fixture = makeFixture(entry.options);
    t.after(() => fixture.service.close());
    const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana2",
      content_base64: PNG.toString("base64"), filename: "preflight-original.png", mime_type: "image/png" });
    const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana2",
      original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "preflight-mask.png", mime_type: "image/png" });
    await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana2", prompt: entry.name,
      image_size: "2K", original_handle: original.reference_handle, painted_handle: painted.painted_handle,
      auxiliary_reference_handle: null }), (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_FAILED");
    assert.equal(fixture.counts().chatCount, 0, entry.name);
    assert.equal(fixture.counts().postCount, 0, entry.name);
    assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 0, entry.name);
  }
});

test("attempt invalidation aborts and drains preflight before invalidating owned reference services", async (t) => {
  const fixture = makeFixture({ blockFirstBalance: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: PNG.toString("base64"),
    filename: "barrier-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "barrier-mask.png", mime_type: "image/png" });
  const run = fixture.service.generate({ attemptId: ATTEMPT, variant: "banana", prompt: "barrier test", image_size: null,
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null });
  await fixture.waitForFirstBalance();
  await fixture.service.invalidateAttempt(ATTEMPT);
  await assert.rejects(() => run, (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_FAILED");
  assert.equal(fixture.counts().chatCount, 0);
  assert.equal(fixture.counts().postCount, 0);
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 0);
});

test("close erects the barrier before aborting and draining owner operations", async (t) => {
  const fixture = makeFixture({ blockFirstBalance: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: PNG.toString("base64"),
    filename: "close-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "close-mask.png", mime_type: "image/png" });
  const run = fixture.service.generate({ attemptId: ATTEMPT, variant: "banana", prompt: "close barrier", image_size: null,
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null });
  await fixture.waitForFirstBalance();
  await fixture.service.close();
  await assert.rejects(() => run, (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_FAILED");
  assert.equal(fixture.counts().chatCount, 0);
  assert.equal(fixture.counts().postCount, 0);
  await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana", prompt: "closed", image_size: null,
    original_handle: original.reference_handle, painted_handle: painted.painted_handle, auxiliary_reference_handle: null }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_CLOSED");
});

test("lost-ACK recovery uses the same native-owned GET after original pair expiry", async (t) => {
  const fixture = makeFixture({ unknownAck: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana3", content_base64: PNG.toString("base64"),
    filename: "expiry-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana3",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "expiry-mask.png", mime_type: "image/png" });
  let recoveryId = "";
  await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana3", prompt: "expiry recovery",
    image_size: "1K", original_handle: original.reference_handle, painted_handle: painted.painted_handle,
    auxiliary_reference_handle: null }), (error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
        !("recovery_id" in error) || typeof error.recovery_id !== "string") return false;
    recoveryId = error.recovery_id;
    return true;
  });
  const before = fixture.counts();
  assert.equal(before.postCount, 1);
  fixture.setNow(NOW + 60 * 60_000);
  assert.equal((await fixture.service.listRecoveries({ attemptId: ATTEMPT })).length, 1);
  const recovered = await fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  assert.equal(recovered.status, "partial_results", "the native private reservation, not a fabricated ACK, scopes recovery");
  assert.equal(recovered.recovery_id, recoveryId);
  const after = fixture.counts();
  assert.equal(after.postCount, 1, "recovery never replaces or repeats the generation POST");
  assert.ok(after.historyReads > before.historyReads, "same native operation authorizes its scoped history GET");
  assert.ok(after.resultReads > before.resultReads, "history-minted native context authorizes its result GET");
});

test("known-ACK Banana Inpaint recovery remains GET-only after the original pair TTL", async (t) => {
  const fixture = makeFixture({ holdResult: true });
  t.after(() => fixture.service.close());
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant: "banana3",
    content_base64: PNG.toString("base64"), filename: "ttl-original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant: "banana3",
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "ttl-mask.png", mime_type: "image/png" });
  let recoveryId = "";
  await assert.rejects(() => fixture.service.generate({ attemptId: ATTEMPT, variant: "banana3", prompt: "pending at pair TTL",
    image_size: "1K", original_handle: original.reference_handle, painted_handle: painted.painted_handle,
    auxiliary_reference_handle: null }), (error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
        !("recovery_id" in error) || typeof error.recovery_id !== "string") return false;
    recoveryId = error.recovery_id;
    return true;
  });
  const before = fixture.counts();
  assert.equal(before.postCount, 1);
  assert.ok(before.historyReads >= 1);
  assert.ok(before.resultReads >= 1);
  fixture.setNow(NOW + 16 * 60_000);
  fixture.setHoldResult(false);
  const recovered = await fixture.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
  const after = fixture.counts();
  assert.equal(recovered.status, "result_observed");
  assert.equal(after.uploadCount, before.uploadCount, "expired references are not re-uploaded");
  assert.equal(after.chatCount, before.chatCount, "recovery does not create another chat");
  assert.equal(after.postCount, 1, "recovery never repeats the generation POST");
  assert.ok(after.historyReads > before.historyReads, "recovery uses the same owned history GET");
  assert.ok(after.resultReads > before.resultReads, "recovery uses the same owned result GET");
});
