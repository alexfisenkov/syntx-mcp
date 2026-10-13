import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  createOwnerIdeogramImageAssetBindingIssuer,
  prepareOwnerIdeogramImageRequest
} from "../src/application/owner-ideogram-image-request-preparer.js";
import { OwnerIdeogramImageMaskUploadService } from "../src/application/owner-ideogram-image-mask-upload-service.js";
import { createOwnerIdeogramImageOneShotPermit } from "../src/application/owner-ideogram-image-one-shot-policy.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";

const ATTEMPT = "link_ideogram_mask_dispatch_0123456789";
const BINDING = Object.freeze({ tenant_id: "ideogram-mask-dispatch-tenant", subject: "ideogram-mask-dispatch-owner" });
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const BASE_URL = "https://r2.syntx.ai/private/ideogram/base-image";
const SECOND_URL = "https://r2.syntx.ai/private/ideogram/second-image";
const INVERSE_URL = "https://r2.syntx.ai/private/ideogram/inverse-mask";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.byteLength + 8);
  return chunk;
}

function rgbaPng(width: number, height: number, alphas: readonly number[]): Buffer {
  assert.equal(alphas.length, width * height);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = (pixel * 17) & 0xff;
      raw[offset + 1] = (pixel * 29) & 0xff;
      raw[offset + 2] = (pixel * 43) & 0xff;
      raw[offset + 3] = alphas[pixel]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  try {
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))
    ]);
  } finally { raw.fill(0); ihdr.fill(0); }
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-ideogram-mask-dispatch-credential");
  } };
}

function createFixture(options: { readonly duplicateOrdinaryUrls?: boolean } = {}) {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  const realDateNow = Date.now;
  Date.now = () => now;
  const uploads: Array<{ readonly destination: string; readonly filename: string; readonly url: string }> = [];
  const posts: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.pathname, "/api/v1/chats/upload-files");
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    const destination = String(form.get("destination"));
    const filename = file.name;
    const fileUrl = destination === "uploaded"
      ? (options.duplicateOrdinaryUrls ? BASE_URL : filename === "base.png" ? BASE_URL : SECOND_URL)
      : (filename.includes("normal") ? BASE_URL : INVERSE_URL);
    uploads.push(Object.freeze({ destination, filename, url: fileUrl }));
    return Response.json({ files: [{ id: `mask-dispatch-${uploads.length}`, url: fileUrl,
      mime_type: file.type, size: file.size }] });
  } });
  const uploadService = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const, expires_at: null, linked: true };
    } }, catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => uploadClient, now: () => now });
  const maskService = new OwnerIdeogramImageMaskUploadService({ baseUploadService: uploadService,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => uploadClient, now: () => now });
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploadService, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, maskService, now: () => now
  });
  const generationClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    posts.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return Response.json({ id: `ideogram-masked-message-${posts.length}` });
  } });
  async function makeMaskedCandidate() {
    const baseBytes = rgbaPng(1, 1, [255]);
    const secondBytes = rgbaPng(1, 1, [254]);
    const paintedBytes = rgbaPng(1, 1, [1]);
    try {
      const base = await uploadService.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
        content_base64: baseBytes.toString("base64"), filename: "base.png", mime_type: "image/png" });
      const second = await uploadService.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
        content_base64: secondBytes.toString("base64"), filename: "second.png", mime_type: "image/png" });
      const mask = await maskService.upload({ attemptId: ATTEMPT, base_reference_handle: base.reference_handle,
        painted_rgba_png_base64: paintedBytes.toString("base64") });
      const assetSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45",
        mode: "precise_edit", reference_handles: [base.reference_handle, second.reference_handle], mask_handle: mask.mask_handle,
        prompt: "preserve the subject", parameters: { rendering_speed: "TURBO", num_images: 1 } });
      const candidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: assetSet }, {
        catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => now
      });
      const permit = createOwnerIdeogramImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => now });
      return { base, second, mask, candidate, permit };
    } finally { baseBytes.fill(0); secondBytes.fill(0); paintedBytes.fill(0); }
  }
  async function close(): Promise<void> {
    try { await issuer.close(); }
    finally { Date.now = realDateNow; }
  }
  return { uploads, posts, generationClient, uploadService, maskService, issuer, makeMaskedCandidate,
    setNow(value: number) { now = value; }, close };
}

test("dispatches a genuine 45 precise-edit image+mask role once, preserving role order even when URLs deduplicate", async () => {
  const fixture = createFixture();
  try {
    const { candidate, permit } = await fixture.makeMaskedCandidate();
    assert.equal(candidate.mask_present, true);
    assert.equal(candidate.model_id, "ideogram_45");
    assert.equal(candidate.mode, "precise_edit");
    assert.equal(candidate.reference_count, 2);
    assert.deepEqual(candidate.request.settings.file_urls, [
      { type: "image", url: BASE_URL }, { type: "image", url: SECOND_URL }, { type: "mask", url: BASE_URL }
    ]);
    assert.deepEqual(permit.mask_present, true);
    assert.equal(JSON.stringify(permit).includes(BASE_URL), false);
    assert.equal(JSON.stringify(permit).includes(candidate.mask_binding?.mask_handle ?? "unavailable"), false);

    const chatUuid = "ideogram-masked-chat-0123456789";
    const receipt = await fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate, permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chatUuid });
    assert.deepEqual(receipt, { chat_uuid: chatUuid, message_id: "ideogram-masked-message-1" });
    assert.equal(fixture.posts.length, 1);
    assert.equal(fixture.posts[0]?.url, "https://api.syntx.ai/api/v1/design/generate?ai_name=ideogram");
    assert.deepEqual(Object.keys(fixture.posts[0]!.body).sort(), ["chat_uuid", "prompt", "settings"]);
    assert.equal(fixture.posts[0]!.body.chat_uuid, chatUuid);
    assert.equal(fixture.posts[0]!.body.prompt, "preserve the subject");
    assert.deepEqual((fixture.posts[0]!.body.settings as Record<string, unknown>).file_urls, [
      { type: "image", url: BASE_URL }, { type: "image", url: SECOND_URL }, { type: "mask", url: BASE_URL }
    ]);
    assert.equal(Object.hasOwn(fixture.posts[0]!.body.settings as object, "mask"), false);
    assert.equal(Object.hasOwn(fixture.posts[0]!.body.settings as object, "image_url"), false);
    assert.equal(Object.hasOwn(fixture.posts[0]!.body.settings as object, "n"), false);

    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate, permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chatUuid }));
    assert.equal(fixture.posts.length, 1, "the consumed genuine permit cannot issue a second POST");
  } finally { await fixture.close(); }
});

test("rejects caller mask URLs, forged candidate/permit, wrong principal, and revoked or expired mask before POST", async () => {
  const fixture = createFixture();
  try {
    const first = await fixture.makeMaskedCandidate();
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: first.candidate,
      permit: first.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-mask-invalid-0123456789",
      mask_url: "https://r2.syntx.ai/private/caller-forged" }));
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: first.candidate,
      permit: first.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-mask-invalid-0123456789",
      mask_present: true }));
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: { ...first.candidate },
      permit: first.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-mask-invalid-0123456789" }));
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: first.candidate,
      permit: { ...first.permit }, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-mask-invalid-0123456789" }));
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: first.candidate,
      permit: first.permit, principal: { ...PRINCIPAL, subject_id: "foreign-owner" }, attemptId: ATTEMPT,
      chat_uuid: "ideogram-mask-invalid-0123456789" }));
    assert.equal(fixture.posts.length, 0);

    await fixture.maskService.invalidateAttempt(ATTEMPT);
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: first.candidate,
      permit: first.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-mask-invalid-0123456789" }));
    assert.equal(fixture.posts.length, 0, "independent mask revocation must be re-resolved before one-shot consumption");

    const expiring = await fixture.makeMaskedCandidate();
    fixture.setNow(Date.parse("2026-10-11T00:15:00.000Z"));
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ candidate: expiring.candidate,
      permit: expiring.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-mask-expired-0123456789" }));
    assert.equal(fixture.posts.length, 0, "the original 15-minute private mask TTL blocks late dispatch");
  } finally { await fixture.close(); }
});

test("keeps mask eligibility to precise edit and still rejects duplicate ordinary-image URLs", async () => {
  const duplicateFixture = createFixture({ duplicateOrdinaryUrls: true });
  try {
    await assert.rejects(duplicateFixture.makeMaskedCandidate());
    assert.equal(duplicateFixture.posts.length, 0);
  } finally { await duplicateFixture.close(); }

  const fixture = createFixture();
  try {
    const authentic = await fixture.makeMaskedCandidate();
    await assert.rejects(fixture.issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45",
      mode: "generate", reference_handles: [authentic.base.reference_handle, authentic.second.reference_handle],
      mask_handle: authentic.mask.mask_handle, prompt: "not an edit", parameters: { rendering_speed: "TURBO", num_images: 1 } }));
    assert.equal(fixture.posts.length, 0);
  } finally { await fixture.close(); }
});
