import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";
import { createOwnerIdeogramImageAssetBindingIssuer, prepareOwnerIdeogramImageRequest } from "../src/application/owner-ideogram-image-request-preparer.js";
import { createOwnerIdeogramImageOneShotPermit } from "../src/application/owner-ideogram-image-one-shot-policy.js";
import type { OwnerIdeogramImageContext } from "../src/application/owner-ideogram-image-parameters.js";

const ATTEMPT = "link_ideogram_native_test_0123456789";
const BINDING = Object.freeze({ tenant_id: "ideogram-native-tenant", subject: "ideogram-native-subject" });
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,0x05,0x00,0x00,0x00,0x2f,0x00,0x00,0x00,0x00,0x00]);

interface ModeCase {
  readonly model_id: OwnerIdeogramImageContext["model_id"];
  readonly mode: OwnerIdeogramImageContext["mode"];
  readonly prompt: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly images: readonly Readonly<{ bytes: Buffer; mime_type: string; filename: string }>[];
}

function modeCases(): readonly ModeCase[] {
  return [
    { model_id: "ideogram", mode: "generate", prompt: "base generation", parameters: {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024",
      color_palette: { kind: "custom", colors: [{ color_hex: "#f6d6ad", color_weight: 62.5 }] }
    }, images: [] },
    { model_id: "ideogram", mode: "remix", prompt: "remix", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024", image_weight: 50 }, images: [{ bytes: JPEG, mime_type: "image/jpeg", filename: "remix.jpg" }] },
    { model_id: "ideogram", mode: "reframe", prompt: null, parameters: { rendering_speed: "TURBO", num_images: 3, resolution: "1024x1024" }, images: [{ bytes: PNG, mime_type: "image/png", filename: "reframe.png" }] },
    { model_id: "ideogram", mode: "replace_background", prompt: "replace", parameters: { rendering_speed: "TURBO", num_images: 4 }, images: [{ bytes: WEBP, mime_type: "image/webp", filename: "replace.webp" }] },
    { model_id: "ideogram", mode: "character_reference", prompt: "character", parameters: { rendering_speed: "TURBO", num_images: 5, aspect_ratio: "1:1", resolution: "1024x1024" }, images: [{ bytes: JPEG, mime_type: "image/jpeg", filename: "character.jpg" }] },
    { model_id: "ideogram_40", mode: "generate", prompt: "V4 image", parameters: { rendering_speed: "TURBO", num_images: 6, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight: 37.5 }, images: [{ bytes: PNG, mime_type: "image/png", filename: "v4.png" }] },
    { model_id: "ideogram_40", mode: "transparent", prompt: "transparent", parameters: { rendering_speed: "TURBO", num_images: 7, aspect_ratio: "1:1", resolution: "4K" }, images: [] },
    { model_id: "ideogram_45", mode: "generate", prompt: "V4.5 refs", parameters: { rendering_speed: "TURBO", num_images: 8, aspect_ratio: "1:1", resolution: "1K" }, images: [{ bytes: PNG, mime_type: "image/png", filename: "v45-a.png" }, { bytes: JPEG, mime_type: "image/jpeg", filename: "v45-b.jpg" }] },
    { model_id: "ideogram_45", mode: "precise_edit", prompt: "precise edit", parameters: { rendering_speed: "TURBO", num_images: 5 }, images: [{ bytes: PNG, mime_type: "image/png", filename: "edit-a.png" }, { bytes: JPEG, mime_type: "image/jpeg", filename: "edit-b.jpg" }] }
  ];
}

function makeFixture(fetchGeneration: typeof fetch) {
  let uploadIndex = 0;
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
    uploadIndex += 1;
    return Response.json({ files: [{ id: `private-${uploadIndex}`, url: `https://r2.syntx.ai/ideogram/${uploadIndex}`,
      mime_type: file.type, size: file.size }] });
  } });
  const uploadService = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const, expires_at: null, linked: true };
    } }, catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => uploadClient, now: () => Date.now() });
  const issuer = createOwnerIdeogramImageAssetBindingIssuer(uploadService, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => Date.now()
  });
  const generationClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: fetchGeneration });
  return { issuer, uploadService, generationClient };
}

async function makeCandidate(issuer: ReturnType<typeof createOwnerIdeogramImageAssetBindingIssuer>,
  uploadService: OwnerIdeogramImageUploadService, item: ModeCase) {
  const handles: string[] = [];
  for (const image of item.images) {
    const receipt = await uploadService.upload({ attemptId: ATTEMPT, model_id: item.model_id, mode: item.mode,
      content_base64: image.bytes.toString("base64"), filename: image.filename, mime_type: image.mime_type });
    handles.push(receipt.reference_handle);
  }
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id: item.model_id, mode: item.mode,
    reference_handles: handles, prompt: item.prompt, parameters: item.parameters });
  const candidate = await prepareOwnerIdeogramImageRequest({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set: set }, {
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => Date.now()
  });
  const permit = createOwnerIdeogramImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => Date.now() });
  return { candidate, permit };
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-ideogram-generation-credential");
  } };
}

test("a fresh process imports ChatHttpClient before the Ideogram uploader without an ESM cycle", () => {
  const clientUrl = new URL("../src/adapter/syntx/chat-http-client.js", import.meta.url).href;
  const uploaderUrl = new URL("../src/application/owner-ideogram-image-upload-service.js", import.meta.url).href;
  const script = `await import(${JSON.stringify(clientUrl)}); await import(${JSON.stringify(uploaderUrl)});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 5_000
  });
  assert.equal(result.error, undefined, "fresh Node process starts and imports the source modules");
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

test("forged candidate and caller-shaped permit reject before any generation POST", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return Response.json({ id: "unexpected-ack" });
  } });
  await assert.rejects(client.startIdeogramImageWithOwnedCandidate({
    candidate: {}, permit: {}, principal: { tenant_id: "t", subject_id: "s", connection_id: "link_ideogram_native_test_0123456789" },
    attemptId: "link_ideogram_native_test_0123456789", chat_uuid: "chat-ideogram-native-test-0123456789"
  }), (error: unknown) => error instanceof Error);
  assert.equal(calls, 0, "no malformed or caller-shaped capability reaches the POST route");
});

test("actual nominal candidates emit the exact full-mode custom settings body once for all nine contexts", async () => {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fixture = makeFixture(async (input, init) => {
    posts.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    return Response.json({ id: `ideogram-message-${posts.length}` });
  });
  try {
    const cases = modeCases();
    for (let index = 0; index < cases.length; index += 1) {
      const item = cases[index]!;
      const { candidate, permit } = await makeCandidate(fixture.issuer, fixture.uploadService, item);
      const chat_uuid = `ideogram-native-chat-${index}-0123456789`;
      const receipt = await fixture.generationClient.startIdeogramImageWithOwnedCandidate({
        candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid
      });
      const posted = posts[index]!;
      assert.equal(posted.url, "https://api.syntx.ai/api/v1/design/generate?ai_name=ideogram");
      assert.deepEqual(Object.keys(posted.body).sort(), ["chat_uuid", "prompt", "settings"]);
      assert.equal(posted.body.chat_uuid, chat_uuid);
      assert.equal(posted.body.prompt, candidate.request.prompt);
      assert.deepEqual(posted.body.settings, candidate.request.settings);
      const settings = posted.body.settings as Record<string, unknown>;
      assert.equal(settings.model_type, item.model_id);
      assert.equal(settings.num_images, item.parameters.num_images);
      assert.equal(Object.hasOwn(settings, "n"), false);
      assert.deepEqual(settings.file_urls, candidate.request.settings.file_urls);
      assert.ok(Array.isArray(settings.file_urls));
      assert.ok((settings.file_urls as Array<Record<string, unknown>>).every((file) => file.type === "image" && typeof file.url === "string"));
      assert.equal(candidate.mask_present, false);
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.deepEqual(receipt, { chat_uuid, message_id: `ideogram-message-${index + 1}` });
      await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({
        candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid
      }), (error: unknown) => error instanceof Error);
      assert.equal(posts.length, index + 1, "consumed permit cannot replay the paid POST");
    }
    assert.equal(posts.length, 9);
  } finally { await fixture.issuer.close(); }
});

test("wrong principal, forged permit, and pre-aborted call do not consume the real permit or post", async () => {
  let calls = 0;
  const fixture = makeFixture(async () => { calls += 1; return Response.json({ id: "replayed-after-preabort" }); });
  try {
    const { candidate, permit } = await makeCandidate(fixture.issuer, fixture.uploadService, modeCases()[0]!);
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({
      candidate, permit, principal: { ...PRINCIPAL, subject_id: "different-owner" }, attemptId: ATTEMPT,
      chat_uuid: "ideogram-preabort-chat-0123456789"
    }), (error: unknown) => error instanceof Error);
    assert.equal(calls, 0);
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({
      candidate, permit: { ...permit }, principal: PRINCIPAL, attemptId: ATTEMPT,
      chat_uuid: "ideogram-preabort-chat-0123456789"
    }), (error: unknown) => error instanceof Error);
    assert.equal(calls, 0);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({
      candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-preabort-chat-0123456789"
    }, controller.signal), (error: unknown) => error instanceof Error);
    assert.equal(calls, 0);
    const receipt = await fixture.generationClient.startIdeogramImageWithOwnedCandidate({
      candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-preabort-chat-0123456789"
    });
    assert.deepEqual(receipt, { chat_uuid: "ideogram-preabort-chat-0123456789", message_id: "replayed-after-preabort" });
    assert.equal(calls, 1);
  } finally { await fixture.issuer.close(); }
});

test("copied or attempt-revoked candidate fails before permit consumption and never posts", async () => {
  let calls = 0;
  const fixture = makeFixture(async () => { calls += 1; return Response.json({ id: "must-not-post" }); });
  try {
    const { candidate, permit } = await makeCandidate(fixture.issuer, fixture.uploadService, modeCases()[0]!);
    const input = { candidate: JSON.parse(JSON.stringify(candidate)) as unknown, permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-copy-chat-0123456789" };
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate(input),
      (error: unknown) => error instanceof Error);
    assert.equal(calls, 0);
    await fixture.issuer.invalidateAttempt(ATTEMPT);
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate({ ...input, candidate }),
      (error: unknown) => error instanceof Error);
    assert.equal(calls, 0);
  } finally { await fixture.issuer.close(); }
});

test("unknown POST outcome is not retried and consumes the one-shot permit", async () => {
  let calls = 0;
  const fixture = makeFixture(async () => {
    calls += 1;
    throw new Error("synthetic transport failure sentinel");
  });
  try {
    const { candidate, permit } = await makeCandidate(fixture.issuer, fixture.uploadService, modeCases()[0]!);
    const input = { candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "ideogram-unknown-chat-0123456789" };
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate(input),
      (error: unknown) => error instanceof Error && !error.message.includes("sentinel"));
    assert.equal(calls, 1);
    await assert.rejects(fixture.generationClient.startIdeogramImageWithOwnedCandidate(input), (error: unknown) => error instanceof Error);
    assert.equal(calls, 1, "unknown outcome stays consumed and cannot be replayed");
  } finally { await fixture.issuer.close(); }
});
