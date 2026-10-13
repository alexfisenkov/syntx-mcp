import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerUniImageUploadService } from "../src/application/owner-uni-image-upload-service.js";
import { OwnerUniImageRequestPreparer } from "../src/application/owner-uni-image-request-preparer.js";
import {
  createOwnerUniImageOneShotPermit,
  OwnerUniImageOneShotPolicyError
} from "../src/application/owner-uni-image-one-shot-policy.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const BINDING = Object.freeze({ tenant_id: "uni-native-tenant", subject: "uni-native-subject" });
const ATTEMPT = "link_uni_native_00000000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

function jpegWithWidth(width: number): Buffer {
  const bytes = Buffer.from(JPEG);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createRig(options: { drift?: () => boolean; failGeneration?: () => boolean; malformedGeneration?: () => boolean;
  stallGeneration?: () => boolean; requestTimeoutMs?: number } = {}) {
  const state = { credentialCalls: 0, uploadCalls: 0, postCalls: [] as Array<{ url: string; body: unknown }> };
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    state.credentialCalls += 1;
    return operation("synthetic-owner-uni-native-credential");
  } };
  const catalog = options.drift ? {
    getModel(modelId: string) {
      const record = CATALOG.getModel(modelId);
      return options.drift?.() ? { ...record, description: "synthetic source drift after candidate issuance" } : record;
    },
    catalog_kind: CATALOG.catalog_kind, runtime_usable: CATALOG.runtime_usable,
    fetched_at: CATALOG.fetched_at, source_hashes: CATALOG.source_hashes, catalog_metadata: CATALOG.catalog_metadata
  } : CATALOG;
  const client = new SyntxChatHttpClient({ credentialBroker,
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files") {
      state.uploadCalls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      const model = String((init?.body as FormData).get("model_type"));
      return Response.json({ files: [{ id: `owned-file-${state.uploadCalls}`, url: `https://r2.syntx.ai/owner/uni-${state.uploadCalls}.jpg`,
        mime_type: file.type, size: file.size, model_type: model }] });
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    state.postCalls.push({ url: url.href, body });
    if (options.failGeneration?.()) throw new Error("synthetic upstream transport failure");
    if (options.malformedGeneration?.()) return Response.json({ no_message_id: true });
    if (options.stallGeneration?.()) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) { reject(new Error("missing request signal")); return; }
        const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    return Response.json({ id: `uni-owner-message-${state.postCalls.length}` });
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog, catalog_version: CATALOG_VERSION, now: () => NOW });
  return { state, client, catalog, uploadService, preparer,
    async upload(model_id: "uni-1" | "uni-1.1-modify-image" | "uni-1.1-remove-background", width: number) {
      return uploadService.upload({ attemptId: ATTEMPT, model_id, content_base64: jpegWithWidth(width).toString("base64"),
        filename: `input-${width}.jpg`, mime_type: "image/jpeg" });
    },
    async prepare(input: { variant: "uni-1" | "uni-1.1-modify-image" | "uni-1.1-remove-background"; prompt: string;
      parameters: Record<string, unknown>; image_reference_handles: readonly string[]; main_image_reference_handle: string | null }) {
      const assetSet = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, ...input });
      const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet });
      const permit = createOwnerUniImageOneShotPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog, catalog_version: CATALOG_VERSION, now: () => NOW });
      return { assetSet, candidate, permit };
    },
    async close() { await preparer.close(); await uploadService.close(); }
  };
}

async function startUniImage(client: SyntxChatHttpClient, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const method = (client as unknown as { startUniImageWithOwnedCandidate?:
    (request: unknown, signal?: AbortSignal) => Promise<unknown> }).startUniImageWithOwnedCandidate;
  assert.equal(typeof method, "function", "MISSING_UNI_NATIVE_CANDIDATE_CONSUMER");
  return Reflect.apply(method!, client, [input, signal]) as Promise<unknown>;
}

test("exposes the Uni owned-candidate native generation boundary", () => {
  const client = SyntxChatHttpClient.prototype as unknown as { startUniImageWithOwnedCandidate?: unknown };
  assert.equal(typeof client.startUniImageWithOwnedCandidate, "function", "MISSING_UNI_NATIVE_CANDIDATE_CONSUMER");
});

test("posts exact source-shaped Q for all three Uni variants with owned ordered file URLs and no injected fields", async () => {
  const rig = createRig();
  try {
    const empty = await rig.prepare({ variant: "uni-1", prompt: "explicit empty-reference Uni request",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    await startUniImage(rig.client, { preparer: rig.preparer, candidate: empty.candidate, permit: empty.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-uni-1" });

    const first = await rig.upload("uni-1.1-modify-image", 2);
    const main = await rig.upload("uni-1.1-modify-image", 3);
    const modify = await rig.prepare({ variant: "uni-1.1-modify-image", prompt: "preserve the selected main first",
      parameters: { seed: 0, mode: "manga" }, image_reference_handles: [first.reference_handle, main.reference_handle],
      main_image_reference_handle: main.reference_handle });
    await startUniImage(rig.client, { preparer: rig.preparer, candidate: modify.candidate, permit: modify.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-uni-modify" });

    const background = await rig.upload("uni-1.1-remove-background", 4);
    const removeBackground = await rig.prepare({ variant: "uni-1.1-remove-background", prompt: "",
      parameters: { invert_mask: false }, image_reference_handles: [background.reference_handle], main_image_reference_handle: null });
    await startUniImage(rig.client, { preparer: rig.preparer, candidate: removeBackground.candidate, permit: removeBackground.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-uni-background" });

    assert.deepEqual(rig.state.postCalls, [
      { url: "https://api.syntx.ai/api/v1/design/generate?ai_name=luma_image",
        body: { chat_uuid: "chat-uni-1", prompt: "explicit empty-reference Uni request",
          settings: { model_type: "uni-1", aspect_ratio: "16:9", seed: null, mode: "auto", file_urls: [] } } },
      { url: "https://api.syntx.ai/api/v1/design/generate?ai_name=luma_image",
        body: { chat_uuid: "chat-uni-modify", prompt: "preserve the selected main first",
          settings: { model_type: "uni-1.1-modify-image", seed: 0, mode: "manga", file_urls: [
            { type: "image", url: "https://r2.syntx.ai/owner/uni-2.jpg" },
            { type: "image", url: "https://r2.syntx.ai/owner/uni-1.jpg" }
          ] } } },
      { url: "https://api.syntx.ai/api/v1/design/generate?ai_name=luma_image",
        body: { chat_uuid: "chat-uni-background", prompt: "",
          settings: { model_type: "uni-1.1-remove-background", invert_mask: false,
            file_urls: [{ type: "image", url: "https://r2.syntx.ai/owner/uni-3.jpg" }] } } }
    ]);
    for (const post of rig.state.postCalls) {
      const settings = (post.body as { settings: Record<string, unknown> }).settings;
      assert.equal(Object.hasOwn(settings, "n"), false);
      assert.equal(Object.hasOwn(settings, "batch_size"), false);
    }
  } finally { await rig.close(); }
});

test("posts all 15 explicit Uni-1 ratio/mode pairs and preserves null, zero, and maximum seeds", async () => {
  const rig = createRig();
  const pairs = [
    { aspect_ratio: "3:1", mode: "auto", seed: null },
    { aspect_ratio: "2:1", mode: "auto", seed: 0 },
    { aspect_ratio: "16:9", mode: "auto", seed: 2_147_483_647 },
    { aspect_ratio: "3:2", mode: "auto", seed: 13 },
    { aspect_ratio: "1:1", mode: "auto", seed: 13 },
    { aspect_ratio: "4:3", mode: "auto", seed: 13 },
    { aspect_ratio: "2:3", mode: "auto", seed: 13 },
    { aspect_ratio: "3:4", mode: "auto", seed: 13 },
    { aspect_ratio: "9:16", mode: "auto", seed: 13 },
    { aspect_ratio: "1:2", mode: "auto", seed: 13 },
    { aspect_ratio: "1:3", mode: "auto", seed: 13 },
    { aspect_ratio: "9:16", mode: "manga", seed: null },
    { aspect_ratio: "2:3", mode: "manga", seed: 0 },
    { aspect_ratio: "1:2", mode: "manga", seed: 2_147_483_647 },
    { aspect_ratio: "1:3", mode: "manga", seed: 19 }
  ] as const;
  try {
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index]!;
      const prompt = `ratio-mode fixture ${index}`;
      const prepared = await rig.prepare({ variant: "uni-1", prompt,
        parameters: { aspect_ratio: pair.aspect_ratio, mode: pair.mode, seed: pair.seed },
        image_reference_handles: [], main_image_reference_handle: null });
      await startUniImage(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
        principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: `chat-uni-ratio-${index}` });
      assert.deepEqual(rig.state.postCalls[index], {
        url: "https://api.syntx.ai/api/v1/design/generate?ai_name=luma_image",
        body: { chat_uuid: `chat-uni-ratio-${index}`, prompt,
          settings: { model_type: "uni-1", aspect_ratio: pair.aspect_ratio, seed: pair.seed, mode: pair.mode, file_urls: [] } }
      });
    }
    assert.equal(rig.state.postCalls.length, 15);
  } finally { await rig.close(); }
});

test("aborted native input spends no credential, performs no POST, and leaves the actual permit usable", async () => {
  const rig = createRig();
  try {
    const prepared = await rig.prepare({ variant: "uni-1", prompt: "explicit request", parameters: { aspect_ratio: "1:1", seed: null, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null });
    const beforeCredentials = rig.state.credentialCalls;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(startUniImage(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-aborted" }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
    assert.equal(rig.state.credentialCalls, beforeCredentials);
    assert.equal(rig.state.postCalls.length, 0);
    const receipt = await startUniImage(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-after-abort" }) as { chat_uuid: string; message_id: string };
    assert.deepEqual(receipt, { chat_uuid: "chat-after-abort", message_id: "uni-owner-message-1" });
    assert.equal(rig.state.postCalls.length, 1);
  } finally { await rig.close(); }
});

test("rejects candidate clones, proxies, and foreign principals before dispatch", async () => {
  const rig = createRig();
  try {
    const prepared = await rig.prepare({ variant: "uni-1", prompt: "bound request", parameters: { aspect_ratio: "1:1", seed: 1, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null });
    const input = { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-bound" };
    await assert.rejects(startUniImage(rig.client, { ...input, candidate: { ...prepared.candidate } }));
    await assert.rejects(startUniImage(rig.client, { ...input, candidate: new Proxy(prepared.candidate, {}) }));
    await assert.rejects(startUniImage(rig.client, { ...input, permit: { ...prepared.permit } }));
    await assert.rejects(startUniImage(rig.client, { ...input, principal: { ...PRINCIPAL, subject_id: "foreign-subject" } }));
    assert.equal(rig.state.postCalls.length, 0);
    const receipt = await startUniImage(rig.client, input) as { message_id: string };
    assert.equal(receipt.message_id, "uni-owner-message-1");
    assert.equal(rig.state.postCalls.length, 1);
  } finally { await rig.close(); }
});

test("consumes the actual permit once and never retries a POST with the same permit after transport failure", async () => {
  let failGeneration = false;
  const rig = createRig({ failGeneration: () => failGeneration });
  try {
    const prepared = await rig.prepare({ variant: "uni-1", prompt: "one-shot request", parameters: { aspect_ratio: "1:1", seed: 0, mode: "auto" },
      image_reference_handles: [], main_image_reference_handle: null });
    const input = { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-one-shot" };
    const receipt = await startUniImage(rig.client, input) as { message_id: string };
    assert.equal(receipt.message_id, "uni-owner-message-1");
    await assert.rejects(startUniImage(rig.client, input), (error: unknown) =>
      error instanceof OwnerUniImageOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.equal(rig.state.postCalls.length, 1);
    failGeneration = true;
    const retryCandidate = await rig.prepare({ variant: "uni-1", prompt: "transport error burns the one-shot permit",
      parameters: { aspect_ratio: "2:1", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    const retryInput = { preparer: rig.preparer, candidate: retryCandidate.candidate, permit: retryCandidate.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-transport-error" };
    await assert.rejects(startUniImage(rig.client, retryInput), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE");
    await assert.rejects(startUniImage(rig.client, retryInput), (error: unknown) =>
      error instanceof OwnerUniImageOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.equal(rig.state.postCalls.length, 2);
  } finally { await rig.close(); }
});

test("malformed response, deadline, and in-flight abort consume one permit and never repeat the POST", async () => {
  const scenarios = [
    { name: "malformed response", code: "UPSTREAM_PROTOCOL_ERROR", rig: { malformedGeneration: () => true } },
    { name: "deadline", code: "UPSTREAM_TIMEOUT", rig: { stallGeneration: () => true, requestTimeoutMs: 20 } },
    { name: "caller abort", code: "UPSTREAM_REQUEST_ABORTED", rig: { stallGeneration: () => true, requestTimeoutMs: 1_000 }, abort: true }
  ] as const;
  for (const scenario of scenarios) {
    const rig = createRig(scenario.rig);
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const prepared = await rig.prepare({ variant: "uni-1", prompt: `explicit ${scenario.name}`,
        parameters: { aspect_ratio: "3:2", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
      const input = { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
        principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: `chat-${scenario.name.replaceAll(" ", "-")}` };
      const controller = "abort" in scenario && scenario.abort ? new AbortController() : undefined;
      const first = startUniImage(rig.client, input, controller?.signal);
      if (controller) abortTimer = setTimeout(() => controller.abort(), 10);
      await assert.rejects(first, (error: unknown) => error instanceof SyntxHttpError && error.code === scenario.code);
      await assert.rejects(startUniImage(rig.client, input), (error: unknown) =>
        error instanceof OwnerUniImageOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
      assert.equal(rig.state.postCalls.length, 1, `${scenario.name} must not cause a retry`);
    } finally {
      if (abortTimer) clearTimeout(abortTimer);
      await rig.close();
    }
  }
});

test("rejects revoked references and current-profile drift without POST", async () => {
  let drift = false;
  const rig = createRig({ drift: () => drift });
  try {
    const upload = await rig.upload("uni-1.1-modify-image", 7);
    const revoked = await rig.prepare({ variant: "uni-1.1-modify-image", prompt: "revoked reference",
      parameters: { seed: null, mode: "auto" }, image_reference_handles: [upload.reference_handle], main_image_reference_handle: upload.reference_handle });
    await rig.preparer.invalidateAttempt(ATTEMPT);
    await assert.rejects(startUniImage(rig.client, { preparer: rig.preparer, candidate: revoked.candidate, permit: revoked.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-revoked" }));
    assert.equal(rig.state.postCalls.length, 0);
  } finally { await rig.close(); }

  const driftRig = createRig({ drift: () => drift });
  try {
    drift = false;
    const candidate = await driftRig.prepare({ variant: "uni-1", prompt: "current profile binding",
      parameters: { aspect_ratio: "3:1", seed: 2, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    drift = true;
    await assert.rejects(startUniImage(driftRig.client, { preparer: driftRig.preparer, candidate: candidate.candidate, permit: candidate.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "chat-profile-drift" }));
    assert.equal(driftRig.state.postCalls.length, 0);
  } finally { await driftRig.close(); }
});
