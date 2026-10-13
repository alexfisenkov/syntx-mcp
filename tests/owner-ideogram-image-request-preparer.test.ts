import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import type { OwnerIdeogramImageContext } from "../src/application/owner-ideogram-image-parameters.js";
import {
  createOwnerIdeogramImageAssetBindingIssuer,
  isOwnerIdeogramImagePreparedCandidateForPrincipal,
  observeOwnerIdeogramImageCandidateClock,
  prepareOwnerIdeogramImageRequest
} from "../src/application/owner-ideogram-image-request-preparer.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageMaskUploadService } from "../src/application/owner-ideogram-image-mask-upload-service.js";

const ATTEMPT = "link_ideogram_preparer_test_0123456789";
const BINDING = Object.freeze({ tenant_id: "ideogram-preparer-tenant", subject: "ideogram-preparer-subject" });
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,0x05,0x00,0x00,0x00,0x2f,0x00,0x00,0x00,0x00,0x00]);

interface ContextCase {
  readonly model_id: OwnerIdeogramImageContext["model_id"];
  readonly mode: OwnerIdeogramImageContext["mode"];
  readonly prompt: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly images: readonly Readonly<{ bytes: Buffer; mime_type: string; filename: string }>[];
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-preparer-credential");
  } };
}
function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}
function sha256(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function makeCases(): readonly ContextCase[] {
  return [
    { model_id: "ideogram", mode: "generate", prompt: "base generation", parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024" }, images: [] },
    { model_id: "ideogram", mode: "remix", prompt: "remix", parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024", image_weight: 50 },
      images: [{ bytes: JPEG, mime_type: "image/jpeg", filename: "a.jpg" }] },
    { model_id: "ideogram", mode: "reframe", prompt: null, parameters: {
      rendering_speed: "TURBO", num_images: 2, resolution: "1024x1024" },
      images: [{ bytes: PNG, mime_type: "image/png", filename: "b.png" }] },
    { model_id: "ideogram", mode: "replace_background", prompt: "replace background", parameters: {
      rendering_speed: "TURBO", num_images: 2 }, images: [{ bytes: WEBP, mime_type: "image/webp", filename: "c.webp" }] },
    { model_id: "ideogram", mode: "character_reference", prompt: "character reference", parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024" },
      images: [{ bytes: JPEG, mime_type: "image/jpeg", filename: "d.jpg" }] },
    { model_id: "ideogram_40", mode: "generate", prompt: "V4 reference", parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight: 37.5 },
      images: [{ bytes: PNG, mime_type: "image/png", filename: "e.png" }] },
    { model_id: "ideogram_40", mode: "transparent", prompt: "transparent output", parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "4K" }, images: [] },
    { model_id: "ideogram_45", mode: "generate", prompt: "V4.5 ordered refs", parameters: {
      rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1K" },
      images: [
        { bytes: PNG, mime_type: "image/png", filename: "f1.png" },
        { bytes: JPEG, mime_type: "image/jpeg", filename: "f2.jpg" },
        { bytes: WEBP, mime_type: "image/webp", filename: "f3.webp" },
        { bytes: PNG, mime_type: "image/png", filename: "f4.png" },
        { bytes: JPEG, mime_type: "image/jpeg", filename: "f5.jpg" }
      ] },
    { model_id: "ideogram_45", mode: "precise_edit", prompt: "precise edit", parameters: {
      rendering_speed: "TURBO", num_images: 2 }, images: [
        { bytes: PNG, mime_type: "image/png", filename: "g1.png" },
        { bytes: JPEG, mime_type: "image/jpeg", filename: "g2.jpg" },
        { bytes: WEBP, mime_type: "image/webp", filename: "g3.webp" },
        { bytes: PNG, mime_type: "image/png", filename: "g4.png" },
        { bytes: JPEG, mime_type: "image/jpeg", filename: "g5.jpg" }
      ] }
  ];
}

function createUploadService(reuseUploadUrl = false, statusImpl?: (attemptId: string, call: number) => Promise<unknown>,
  reuseFirstImageUrlForMask = false) {
  let uploadIndex = 0;
  let statusIndex = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    uploadIndex += 1;
    const form = init?.body as FormData;
    const isHidden = form.get("destination") === "hidden";
    const url = reuseUploadUrl ? "https://r2.syntx.ai/preparer/duplicate"
      : reuseFirstImageUrlForMask && isHidden && uploadIndex === 3 ? "https://r2.syntx.ai/preparer/1"
        : `https://r2.syntx.ai/preparer/${uploadIndex}`;
    return Response.json({ files: [{ id: `private-id-${uploadIndex}`, url: reuseUploadUrl
      ? "https://r2.syntx.ai/preparer/duplicate" : url,
      mime_type: file.type, size: file.size }] });
  } });
  const service = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      statusIndex += 1;
      return statusImpl ? statusImpl(attemptId, statusIndex) : linkedAttempt(attemptId);
    } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const maskService = new OwnerIdeogramImageMaskUploadService({ baseUploadService: service, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  return { service, maskService, get uploadCount() { return uploadIndex; }, get statusCount() { return statusIndex; } };
}
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded wait did not reach expected state");
}

test("issuer binds actual 683 upload handles in caller order across all nine model/mode contexts", async () => {
  const uploader = createUploadService();
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  try {
    for (const item of makeCases()) {
      const handles = [];
      const expectedUrls: string[] = [];
      for (const image of item.images) {
        const receipt = await uploader.service.upload({ attemptId: ATTEMPT, model_id: item.model_id, mode: item.mode,
          content_base64: image.bytes.toString("base64"), filename: image.filename, mime_type: image.mime_type });
        handles.push(receipt.reference_handle);
        expectedUrls.push(`https://r2.syntx.ai/preparer/${uploader.uploadCount}`);
      }
      const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: item.model_id,
        mode: item.mode, reference_handles: handles, prompt: item.prompt, parameters: item.parameters });
      assert.equal(set.model_id, item.model_id); assert.equal(set.mode, item.mode);
      assert.equal(set.reference_count, item.images.length); assert.equal(set.mask_present, false);
      assert.equal(set.expires_at, NOW + 15 * 60_000);
      assert.equal(set.generation_permit, false);
      assert.deepEqual(set.references.map((reference: { readonly sha256: string }) => reference.sha256), item.images.map((image) => sha256(image.bytes)));
      const candidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: set }, {
        catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
      });
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.equal(Object.hasOwn(candidate.request.settings, "n"), false);
      assert.deepEqual(candidate.request.settings.file_urls, expectedUrls.map((url) => ({ type: "image", url })));
      assert.equal(candidate.prompt, item.prompt);
      assert.equal(candidate.request.prompt, item.prompt ?? "");
      assert.equal(candidate.native_wire_status, item.mode === "reframe"
        ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_MAPPED");
      assert.deepEqual(candidate.source_wire_binding, {
        custom_settings_sender_sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae",
        ordered_file_url_canonicalizer_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706",
        confidence: "STATIC_SOURCE_HELPER_JOIN_NOT_PROVIDER_ACCEPTANCE"
      });
      assert.equal(candidate.request_prompt_confidence, item.mode === "reframe"
        ? "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" : "SOURCE_REQUIRED_PROMPT");
      assert.equal(candidate.request.settings.model_type, item.model_id);
      assert.equal(candidate.request.settings.num_images, 2);
      if (item.mode === "reframe") assert.equal(candidate.request.settings.reframe_mode, true);
      if (item.mode === "replace_background") assert.equal(candidate.request.settings.replace_background_mode, true);
      if (item.mode === "character_reference") assert.equal(candidate.request.settings.character_reference_mode, true);
      if (item.mode === "transparent") assert.equal(candidate.request.settings.mode, "transparent");
      if (item.mode === "precise_edit") assert.equal(candidate.request.settings.mode, "precise_edit");
      if (item.model_id === "ideogram_40" && item.mode === "generate") {
        assert.equal(candidate.request.settings.image_weight, 37.5);
        assert.equal(Object.hasOwn(candidate.request.settings, "magic_prompt"), false);
        assert.equal(Object.hasOwn(candidate.request.settings, "seed"), false);
      }
      if (item.model_id === "ideogram" && item.mode === "generate") {
        assert.deepEqual(candidate.cost_inputs, { rendering_speed: "TURBO", batch_size: 2 });
      }
      if (item.model_id === "ideogram_45" && item.mode === "precise_edit") {
        assert.deepEqual(candidate.cost_inputs, { rendering_speed: "TURBO", ref_count: 5, batch_size: 2 });
      }
      assert.equal(JSON.stringify(candidate).includes("https://r2.syntx.ai"), false);
      for (const secret of ["https://r2.syntx.ai", "private-id-", "f1.png", BINDING.subject]) {
        assert.equal(JSON.stringify(set).includes(secret), false);
      }
    }
    assert.equal(uploader.uploadCount, 15);
  } finally { await issuer.close(); }
});

test("masked Precise Edit binds the real mask service to the first ordered base image and appends one private mask-role URL", async () => {
  const uploader = createUploadService(false, undefined, true);
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW, maskService: uploader.maskService
  });
  const handles: string[] = [];
  try {
    for (const [index, image] of [PNG, JPEG].entries()) {
      const receipt = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
        content_base64: image.toString("base64"), filename: `mask-base-${index}.${index === 0 ? "png" : "jpg"}`,
        mime_type: index === 0 ? "image/png" : "image/jpeg" });
      handles.push(receipt.reference_handle);
    }
    const mask = await uploader.maskService.upload({ attemptId: ATTEMPT, base_reference_handle: handles[0]!,
      painted_rgba_png_base64: PNG.toString("base64") });
    const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: handles, mask_handle: mask.mask_handle, prompt: "masked precise edit", parameters: {
        rendering_speed: "TURBO", num_images: 2
      } });
    const resolution = await uploader.maskService.resolveMask({ attemptId: ATTEMPT, mask_handle: mask.mask_handle,
      base_reference_handle: handles[0] });
    assert.equal(set.mask_present, true);
    assert.equal(set.reference_count, 2, "reference_count contains ordinary images only");
    assert.equal(set.mask_binding?.mask_handle, mask.mask_handle);
    assert.equal(set.mask_binding?.base_reference_handle, handles[0]);
    assert.equal(set.mask_binding?.base_sha256, resolution.base_sha256);
    assert.equal(set.mask_binding?.pair_sha256, resolution.pair_sha256);
    assert.equal(set.expires_at, Math.min(NOW + 15 * 60_000, resolution.expires_at));
    assert.equal(JSON.stringify(set).includes(resolution.normal_url), false);
    assert.equal(JSON.stringify(set).includes(resolution.inverse_url), false);
    const candidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: set }, {
      catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
    });
    const files = candidate.request.settings.file_urls as readonly Readonly<{ type: string; url: string }>[];
    assert.equal(candidate.mask_present, true);
    assert.equal(candidate.reference_count, 2);
    assert.equal(candidate.mask_binding?.pair_sha256, resolution.pair_sha256);
    assert.equal(candidate.references.length, 2);
    assert.deepEqual(files, [
      { type: "image", url: "https://r2.syntx.ai/preparer/1" },
      { type: "image", url: "https://r2.syntx.ai/preparer/2" },
      { type: "mask", url: resolution.normal_url }
    ]);
    assert.equal(files[2]?.url, files[0]?.url, "same URL is allowed across distinct image and mask roles");
    assert.equal(candidate.cost_inputs.ref_count, 2, "mask is not an ordinary image cost reference");
    assert.equal(Object.hasOwn(candidate.request.settings, "n"), false);
    assert.equal(JSON.stringify(candidate).includes(resolution.normal_url), false);
    assert.equal(JSON.stringify(candidate).includes(resolution.inverse_url), false);

    const extraHandles: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const image = index % 2 === 0 ? PNG : JPEG;
      const receipt = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
        content_base64: image.toString("base64"), filename: `mask-extra-${index}.${index % 2 === 0 ? "png" : "jpg"}`,
        mime_type: index % 2 === 0 ? "image/png" : "image/jpeg" });
      extraHandles.push(receipt.reference_handle);
    }
    const fourMasked = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: [...handles, ...extraHandles.slice(0, 2)], mask_handle: mask.mask_handle,
      prompt: "four ordinary plus mask", parameters: { rendering_speed: "TURBO", num_images: 1 } });
    assert.equal(fourMasked.reference_count, 4);
    assert.equal(fourMasked.mask_present, true);
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: [...handles, ...extraHandles], mask_handle: mask.mask_handle, prompt: "five ordinary plus mask",
      parameters: { rendering_speed: "TURBO", num_images: 1 } }), (error: unknown) => hasCode(error, "PARAMETERS_INVALID"));
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: [], mask_handle: mask.mask_handle, prompt: "mask without base", parameters: {
        rendering_speed: "TURBO", num_images: 1
      } }), (error: unknown) => hasCode(error, "PARAMETERS_INVALID"));

    const ordinaryOnly = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: handles, prompt: "same base, no mask", parameters: { rendering_speed: "TURBO", num_images: 2 } });
    const ordinaryCandidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: ordinaryOnly }, {
      catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
    });
    assert.equal(ordinaryOnly.mask_present, false);
    assert.equal(ordinaryCandidate.mask_present, false);
    const ordinaryFiles = ordinaryCandidate.request.settings.file_urls as readonly Readonly<{ type: string; url: string }>[];
    assert.equal(ordinaryFiles.length, 2);
    assert.notEqual(candidate.request_fingerprint, ordinaryCandidate.request_fingerprint);
  } finally { await issuer.close(); }
});

test("attempt invalidation aborts and drains the actual private mask resolver with the caller signal", async () => {
  let blockCall = -1; let release!: () => void; let resolverStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { resolverStarted = resolve; });
  const uploader = createUploadService(false, async (attemptId, call) => {
    if (call === blockCall) { resolverStarted(); await gate; }
    return linkedAttempt(attemptId);
  });
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW, maskService: uploader.maskService
  });
  try {
    const base = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      content_base64: PNG.toString("base64"), filename: "mask-signal-base.png", mime_type: "image/png" });
    const mask = await uploader.maskService.upload({ attemptId: ATTEMPT, base_reference_handle: base.reference_handle,
      painted_rgba_png_base64: PNG.toString("base64") });
    blockCall = uploader.statusCount + 3;
    const pending = issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: [base.reference_handle], mask_handle: mask.mask_handle, prompt: "in-flight mask resolver", parameters: {
        rendering_speed: "TURBO", num_images: 1
      } });
    await waitUntil(() => uploader.statusCount >= blockCall);
    await started;
    let drained = false;
    const invalidation = issuer.invalidateAttempt(ATTEMPT).then(() => { drained = true; });
    await assert.rejects(pending, (error: unknown) => hasCode(error, "REQUEST_ABORTED"));
    await invalidation;
    assert.equal(drained, true);
  } finally {
    release();
    await issuer.close();
  }
});

test("invalid count, caller mask assertion, foreign handle, or cloned set cannot mint an asset binding", async () => {
  const uploader = createUploadService();
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  try {
    const valid = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram", mode: "remix",
      content_base64: PNG.toString("base64"), filename: "valid.png", mime_type: "image/png" });
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram", mode: "generate",
      reference_handles: [valid.reference_handle], prompt: "reject exact one", parameters: {
        rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" } }),
      (error: unknown) => hasCode(error, "PARAMETERS_INVALID"));
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: [valid.reference_handle], mask_present: true, prompt: "unverified mask role", parameters: {
        rendering_speed: "TURBO", num_images: 1 } } as never),
      (error: unknown) => hasCode(error, "INVALID_REQUEST"));
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handles: [valid.reference_handle], mask_handle: valid.reference_handle, prompt: "ordinary handle is not a mask",
      parameters: { rendering_speed: "TURBO", num_images: 1 } }),
      (error: unknown) => hasCode(error, "INVALID_REQUEST"));
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram", mode: "character_reference",
      reference_handles: [valid.reference_handle], prompt: "wrong mode owner", parameters: {
        rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" } }),
      (error: unknown) => hasCode(error, "REFERENCE_UNAVAILABLE"));
    const emptySet = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram", mode: "generate",
      reference_handles: [], prompt: "explicit no-reference candidate", parameters: {
        rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024" } });
    const candidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: emptySet }, {
      catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
    });
    assert.equal(isOwnerIdeogramImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT, NOW), true);
    await assert.rejects(prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT,
      asset_set: { ...emptySet } }, { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
      (error: unknown) => hasCode(error, "CANDIDATE_INVALID"));
    await issuer.invalidateAttempt(ATTEMPT);
    assert.equal(isOwnerIdeogramImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT, NOW), false);
    await assert.rejects(prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: emptySet },
      { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW }),
      (error: unknown) => hasCode(error, "CANDIDATE_INVALID"));
    assert.equal(uploader.uploadCount, 1, "invalid request bindings do not trigger extra uploads");
  } finally { await issuer.close(); }
});

test("asset issuer rejects a clock rollback while resolving an ordered reference set", async () => {
  const uploader = createUploadService();
  const handles = [];
  for (const [index, bytes] of [PNG, JPEG].entries()) {
    const receipt = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "generate",
      content_base64: bytes.toString("base64"), filename: `clock-${index}.${index === 0 ? "png" : "jpg"}`,
      mime_type: index === 0 ? "image/png" : "image/jpeg" });
    handles.push(receipt.reference_handle);
  }
  const values = [NOW, NOW + 1, NOW + 2, NOW + 1]; let clockCalls = 0;
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    now: () => values[clockCalls++] ?? NOW + 1
  });
  try {
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "generate",
      reference_handles: handles, prompt: "clock check", parameters: {
        rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1K" } }),
      (error: unknown) => hasCode(error, "CLOCK_INVALID"));
  } finally { await issuer.close(); }
});

test("asset issuer rejects distinct handles that canonicalize to a duplicate ordered image URL", async () => {
  const uploader = createUploadService(true);
  const handles = [];
  for (const [index, bytes] of [PNG, JPEG].entries()) {
    const receipt = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "generate",
      content_base64: bytes.toString("base64"), filename: `duplicate-${index}.${index === 0 ? "png" : "jpg"}`,
      mime_type: index === 0 ? "image/png" : "image/jpeg" });
    handles.push(receipt.reference_handle);
  }
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  try {
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "generate",
      reference_handles: handles, prompt: "duplicate URL prevention", parameters: {
        rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1K" } }),
      (error: unknown) => hasCode(error, "REFERENCE_UNAVAILABLE"));
  } finally { await issuer.close(); }
});

test("attempt invalidation aborts and drains resolver work before the issuer returns", async () => {
  let releaseStatus!: () => void;
  const statusGate = new Promise<void>((resolve) => { releaseStatus = resolve; });
  const uploader = createUploadService(false, async (attemptId, call) => {
    if (call === 3) await statusGate;
    return linkedAttempt(attemptId);
  });
  const receipt = await uploader.service.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "generate",
    content_base64: PNG.toString("base64"), filename: "drain.png", mime_type: "image/png" });
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  try {
    const pending = issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram_45", mode: "generate",
      reference_handles: [receipt.reference_handle], prompt: "invalidation drain", parameters: {
        rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1K" } });
    await waitUntil(() => uploader.statusCount === 3);
    let drained = false;
    const invalidation = issuer.invalidateAttempt(ATTEMPT).then(() => { drained = true; });
    await assert.rejects(pending, (error: unknown) => hasCode(error, "REQUEST_ABORTED"));
    await invalidation;
    assert.equal(drained, true);
  } finally {
    releaseStatus();
    await issuer.close();
  }
});

test("candidate clock rollback permanently invalidates its nominal binding", async () => {
  const uploader = createUploadService();
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploader.service, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
  });
  try {
    const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: "ideogram", mode: "generate",
      reference_handles: [], prompt: "monotonic candidate", parameters: {
        rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" } });
    const candidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: set }, {
      catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW
    });
    assert.equal(observeOwnerIdeogramImageCandidateClock(candidate, NOW - 1), false);
    assert.equal(isOwnerIdeogramImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, ATTEMPT, NOW), false);
  } finally { await issuer.close(); }
});
