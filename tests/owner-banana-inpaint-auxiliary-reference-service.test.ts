import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  OwnerBananaInpaintAuxiliaryImageResolution,
  OwnerBananaInpaintAuxiliaryReferenceService
} from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";

const C5_PUBLIC_VERSION = "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json";
const SETTINGS_62_VERSION = "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json";
const catalog = loadSelectedDiscoveryCatalog(C5_PUBLIC_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
const settings = loadMaplessSettingsInventoryVersion(SETTINGS_62_VERSION, join(process.cwd(), "catalog"));
const ATTEMPT = "link_banana_inpaint_auxiliary_service_0123456789";
const OTHER_ATTEMPT = "link_banana_inpaint_auxiliary_other_1234567890";
const BINDING = Object.freeze({ tenant_id: "banana-inpaint-aux-tenant", subject: "banana-inpaint-aux-subject" });
const variants = ["banana", "banana2", "banana3", "banana3_light"] as const;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-banana-inpaint-auxiliary-credential");
  } };
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function createService(fetchImpl: typeof fetch, now: () => number, getStatus: (attemptId: string) => Promise<unknown> =
  async (attemptId) => linkedAttempt(attemptId)) {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl });
  const service = new OwnerBananaInpaintAuxiliaryReferenceService({
    binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return getStatus(attemptId); } },
    catalog,
    public_catalog_version: C5_PUBLIC_VERSION,
    settings_inventory: settings,
    settings_inventory_version: SETTINGS_62_VERSION,
    resolveClient: () => client,
    now
  });
  return { client, service };
}

test("uploads and resolves one nominal image-only auxiliary reference for each exact variant", async () => {
  const calls: Array<{ model_type: string; destination: string; check_duplicates: string; bytes_match: boolean }> = [];
  let linkReads = 0;
  const { service } = createService(async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    const file = form.get("files");
    assert.ok(file instanceof File);
    const bytes = Buffer.from(await file.arrayBuffer());
    calls.push({ model_type: String(form.get("model_type")), destination: String(form.get("destination")),
      check_duplicates: String(form.get("check_duplicates")), bytes_match: bytes.equals(png) });
    bytes.fill(0);
    const index = calls.length;
    return jsonResponse({ files: [{ id: `aux-${index}`, file_id: `aux-${index}`,
      url: `https://r2.syntx.ai/aux/${index}.png`, mime_type: "image/png", size: png.byteLength, status: "accepted" }] });
  }, () => Date.parse("2026-10-12T00:00:00.000Z"), async (attemptId) => { linkReads += 1; return linkedAttempt(attemptId); });
  try {
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index]!;
      const receipt = await service.upload({ attemptId: ATTEMPT, variant, content_base64: png.toString("base64"),
        filename: "auxiliary.png", mime_type: "image/png" });
      assert.equal(receipt.status, "uploaded");
      assert.equal(receipt.variant, variant);
      assert.equal(receipt.mime_type, "image/png");
      assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(png).digest("hex")}`);
      assert.equal(Object.hasOwn(receipt, "file_url"), false);
      const resolution = await service.resolveReference({ attempt_id: ATTEMPT, variant, reference_handle: receipt.reference_handle });
      assert.ok(resolution instanceof OwnerBananaInpaintAuxiliaryImageResolution);
      assert.equal(resolution.isAuthenticResolution(), true);
      assert.equal(resolution.role, "auxiliary_image");
      assert.equal(resolution.wire_type, "image");
      assert.equal(resolution.variant, variant);
      assert.equal(resolution.attempt_id, ATTEMPT);
      assert.equal(resolution.file_url, `https://r2.syntx.ai/aux/${index + 1}.png`);
      assert.equal(resolution.sha256, receipt.sha256);
      assert.equal(resolution.generation_permit, false);
      assert.equal(resolution.expires_at, Date.parse("2026-10-12T00:00:00.000Z") + 15 * 60_000);
    }
    assert.deepEqual(calls.map((call) => call.model_type), variants);
    assert.ok(calls.every((call) => call.destination === "uploaded" && call.check_duplicates === "true" && call.bytes_match));
    assert.equal(linkReads, variants.length * 4, "upload and resolve must each resolve the linked principal before and after");
  } finally { await service.close(); }
});

test("foreign attempt or variant cannot consume or delete a valid owner's auxiliary handle", async () => {
  let id = 0;
  const { service } = createService(async () => jsonResponse({ files: [{ id: ++id, file_id: String(id),
    url: `https://r2.syntx.ai/aux/${id}.png`, mime_type: "image/png", size: png.byteLength, status: "accepted" }] }),
  () => Date.parse("2026-10-12T00:00:00.000Z"));
  try {
    const receipt = await service.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: png.toString("base64"),
      filename: "auxiliary.png", mime_type: "image/png" });
    await assert.rejects(() => service.resolveReference({ attempt_id: OTHER_ATTEMPT, variant: "banana",
      reference_handle: receipt.reference_handle }), (error: unknown) => hasCode(error, "REFERENCE_UNAVAILABLE"));
    await assert.rejects(() => service.resolveReference({ attempt_id: ATTEMPT, variant: "banana2",
      reference_handle: receipt.reference_handle }), (error: unknown) => hasCode(error, "REFERENCE_UNAVAILABLE"));
    for (const extra of [{ principal: { tenant_id: "foreign", subject_id: "foreign", connection_id: ATTEMPT } },
      { file_url: "https://r2.syntx.ai/forged.png" }, { profile_schema_hash: "sha256:" + "0".repeat(64) }]) {
      await assert.rejects(() => service.resolveReference({ attempt_id: ATTEMPT, variant: "banana",
        reference_handle: receipt.reference_handle, ...extra }), (error: unknown) => hasCode(error, "INVALID_REQUEST"));
    }
    const valid = await service.resolveReference({ attempt_id: ATTEMPT, variant: "banana", reference_handle: receipt.reference_handle });
    assert.equal(valid.file_url, "https://r2.syntx.ai/aux/1.png");
  } finally { await service.close(); }
});

test("prunes a known expired handle and allows a fresh upload while preserving a monotonic clock", async () => {
  let now = Date.parse("2026-10-12T00:00:00.000Z");
  let posts = 0;
  const { service } = createService(async () => jsonResponse({ files: [{ id: ++posts, file_id: String(posts),
    url: `https://r2.syntx.ai/aux/${posts}.png`, mime_type: "image/png", size: png.byteLength, status: "accepted" }] }),
  () => now);
  try {
    const input = { attemptId: ATTEMPT, variant: "banana2", content_base64: png.toString("base64"), filename: "reference.png", mime_type: "image/png" };
    const receipt = await service.upload(input);
    now += 15 * 60_000;
    await assert.rejects(() => service.resolveReference({ attempt_id: ATTEMPT, variant: "banana2",
      reference_handle: receipt.reference_handle }), (error: unknown) => hasCode(error, "REFERENCE_EXPIRED"));
    const fresh = await service.upload(input);
    assert.notEqual(fresh.reference_handle, receipt.reference_handle);
    assert.equal(posts, 2);
  } finally { await service.close(); }
});

test("unknown post-start upload outcomes create non-evicting content holds across attempts", async () => {
  let posts = 0;
  const { service } = createService(async () => { posts += 1; throw new Error("synthetic connection dropped after dispatch"); },
    () => Date.parse("2026-10-12T00:00:00.000Z"));
  try {
    const input = { variant: "banana3", content_base64: png.toString("base64"), filename: "reference.png", mime_type: "image/png" };
    await assert.rejects(() => service.upload({ attemptId: ATTEMPT, ...input }), (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(() => service.upload({ attemptId: OTHER_ATTEMPT, ...input }), (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1, "an unknown semantic upload is never replayed on another attempt");
  } finally { await service.close(); }
});

test("invalidation installs its barrier, drains an aborted upload, and retains the unknown semantic hold", async () => {
  let posts = 0;
  let signal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const { service } = createService(async (_input, init) => {
    posts += 1;
    const requestSignal = init?.signal as AbortSignal | undefined;
    if (!requestSignal) throw new Error("synthetic request signal missing");
    signal = requestSignal; markStarted();
    return await new Promise<Response>((_resolve, reject) => {
      if (requestSignal.aborted) reject(new Error("aborted"));
      else requestSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }, () => Date.parse("2026-10-12T00:00:00.000Z"));
  try {
    const input = { attemptId: ATTEMPT, variant: "banana3_light", content_base64: png.toString("base64"),
      filename: "reference.png", mime_type: "image/png" };
    const pending = service.upload(input);
    await started;
    const invalidation = service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => service.upload(input), (error: unknown) => hasCode(error, "REQUEST_ABORTED"));
    await invalidation;
    await assert.rejects(() => pending, (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await assert.rejects(() => service.upload({ ...input, attemptId: OTHER_ATTEMPT }),
      (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(signal?.aborted, true);
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("close aborts and drains a pending native upload before resolving", async () => {
  let posts = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const { service } = createService(async (_input, init) => {
    posts += 1;
    const requestSignal = init?.signal as AbortSignal | undefined;
    if (!requestSignal) throw new Error("synthetic request signal missing");
    markStarted();
    return await new Promise<Response>((_resolve, reject) => {
      if (requestSignal.aborted) reject(new Error("aborted"));
      else requestSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }, () => Date.parse("2026-10-12T00:00:00.000Z"));
  const input = { attemptId: ATTEMPT, variant: "banana", content_base64: png.toString("base64"),
    filename: "reference.png", mime_type: "image/png" };
  const pending = service.upload(input);
  await started;
  const closing = service.close();
  await assert.rejects(() => service.upload(input), (error: unknown) => hasCode(error, "SERVICE_CLOSED"));
  await closing;
  await assert.rejects(() => pending, (error: unknown) => hasCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
  assert.equal(posts, 1);
});
