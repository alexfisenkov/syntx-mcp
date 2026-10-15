import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { type OwnerWan25I2vImageUploadContext, readOwnerWan25I2vUploadReferenceForClient } from "../src/adapter/syntx/wan25-i2v-upload-context.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  createOwnerWan25I2vReferenceService,
  OwnerWan25I2vReferenceServiceError,
} from "../src/application/owner-wan25-i2v-reference-service.js";
import {
  createOwnerWan25I2vRequestPreparer,
  OwnerWan25I2vRequestPreparerError,
} from "../src/application/owner-wan25-i2v-request-preparer.js";
import {
  createOwnerWan25I2vOneShotPermit,
  consumeOwnerWan25I2vOneShotPermit,
  revalidateOwnerWan25I2vOneShotPermit,
  OwnerWan25I2vOneShotPolicyError,
  type OwnerWan25I2vOneShotPermitContext,
} from "../src/application/owner-wan25-i2v-one-shot-policy.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const ATTEMPT = "link_wan25_reference_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan25-reference-test", subject: "owner" });
let now = 1_000;
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (token: string) => Promise<T>) { return fn("synthetic-owner-token"); } }; }
function uploaded(file: File, id: number): Response {
  return Response.json({ files: [{ id, url: `https://r2.syntx.ai/wan25/${id}-${file.name}`, filename: file.name,
    mime_type: file.type, content_type: file.type, media_type: "image", type: "image", size: file.size, status: "uploaded" }] });
}
function makeClient() {
  let uploads = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000,
    fetchImpl: async (url, init) => {
      assert.match(String(url), /\/chats\/upload-files$/u);
      const form = init?.body as FormData;
      const file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), MODEL_ID);
      uploads += 1;
      return uploaded(file, uploads);
    } });
  return { client, uploads: () => uploads };
}
async function linked(): Promise<PerUserLinkService> {
  now = 1_000;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "wan25-reference", approval_url: "https://example.invalid" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  return links;
}
function uploadInput(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return { attemptId: ATTEMPT, model_id: MODEL_ID, filename: "frame.png", mime_type: "image/png",
    content_base64: Buffer.from(bytes).toString("base64"), ...overrides };
}
function setup(client: SyntxChatHttpClient, links: PerUserLinkService, nowFn = () => now) {
  const referenceService = createOwnerWan25I2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: nowFn });
  const preparer = createOwnerWan25I2vRequestPreparer({ referenceService, now: nowFn });
  return { referenceService, preparer };
}
function explicitParameters(overrides: Record<string, unknown> = {}) {
  return { resolution: "720P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: null, ...overrides };
}
function invalidReference(code: string) {
  return (error: unknown) => error instanceof OwnerWan25I2vReferenceServiceError && error.code === code;
}
function invalidPreparer(code: string) {
  return (error: unknown) => error instanceof OwnerWan25I2vRequestPreparerError && error.code === code;
}
function invalidPermit(code: string) {
  return (error: unknown) => error instanceof OwnerWan25I2vOneShotPolicyError && error.code === code;
}

test("WAN25 reference service captures only its genuine image context and exposes a redacted one-image resolution", async () => {
  const links = await linked(), { client, uploads } = makeClient(), { referenceService, preparer } = setup(client, links), bytes = png384();
  try {
    const receipt = await referenceService.uploadImage(uploadInput(bytes));
    assert.equal(receipt.model_id, MODEL_ID); assert.equal(receipt.generation_permit, false);
    assert.equal("url" in receipt, false); assert.equal(JSON.stringify(receipt).includes("https://"), false);
    assert.equal(uploads(), 1);
    const resolveInput = { attempt_id: ATTEMPT, model_id: MODEL_ID, image_handle: receipt.image_handle, audio_handle: null };
    const resolution = await referenceService.resolveReferences(resolveInput);
    assert.equal(referenceService.isOwnedReferenceResolution(resolution, resolveInput), true);
    assert.equal(resolution.image.model_id, MODEL_ID); assert.equal(resolution.audio, null);
    assert.equal(resolution.audio_integration_status, "NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE");
    assert.equal(JSON.stringify(resolution).includes("https://"), false);
    let captured: OwnerWan25I2vImageUploadContext | undefined;
    const urls = await referenceService.withCapturedNativeReferences(resolution, resolveInput, (boundClient, contexts) => {
      assert.equal(boundClient, client); assert.equal(Object.isFrozen(contexts), true); assert.equal(contexts.length, 1);
      captured = contexts[0]; return readOwnerWan25I2vUploadReferenceForClient(boundClient, contexts[0]);
    });
    assert.deepEqual(urls, { url: "https://r2.syntx.ai/wan25/1-frame.png" });
    assert.ok(captured);
    const otherClient = makeClient().client;
    assert.equal(readOwnerWan25I2vUploadReferenceForClient(otherClient, captured), null);
    assert.equal(readOwnerWan25I2vUploadReferenceForClient(client, Object.freeze({ ...captured })), null,
      "a structural clone is not a native branded upload context");
    await assert.rejects(referenceService.resolveReferences({ ...resolveInput, audio_handle: "wan25preview_audio_fake" }),
      invalidReference("AUDIO_REFERENCE_NOT_READY"));
    await assert.rejects(preparer.prepare({ attempt_id: ATTEMPT, model_id: MODEL_ID, image_handle: receipt.image_handle,
      audio_handle: "wan25preview_audio_fake", prompt: "x", parameters: explicitParameters() }), invalidPreparer("AUDIO_REFERENCE_NOT_READY"));
  } finally { await preparer.close(); await referenceService.close(); bytes.fill(0); }
});

test("WAN25 preparer builds a local image-only candidate from explicit preview settings and the genuine context URL", async () => {
  const links = await linked(), { client, uploads } = makeClient(), { referenceService, preparer } = setup(client, links), bytes = png384();
  try {
    const receipt = await referenceService.uploadImage(uploadInput(bytes));
    const candidate = await preparer.prepare({ attempt_id: ATTEMPT, model_id: MODEL_ID, image_handle: receipt.image_handle,
      audio_handle: null, prompt: "literal https://example.invalid stays prompt text", parameters: explicitParameters({ resolution: "480P", aspect_ratio: "1:1", video_duration: 10 }) });
    assert.equal(candidate.model_id, MODEL_ID);
    assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.runtime_usable, false);
    assert.equal(candidate.audio_reference_count, 0); assert.equal(candidate.native_audio_status, "UNPROVEN_NOT_ENABLED");
    assert.equal(candidate.audio_gap, "OPTIONAL_AUDIO_UI_NOT_JOINED_TO_NATIVE_CONTEXT");
    assert.equal(candidate.image_reference_count, 1); assert.equal(candidate.input_references.length, 1);
    assert.equal(JSON.stringify(candidate).includes("https://"), false);
    const request = preparer.getPrivateRequest(candidate);
    assert.equal(request.prompt, "literal https://example.invalid stays prompt text");
    assert.deepEqual(request.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/wan25/1-frame.png" }]);
    assert.equal(request.settings.model_type, MODEL_ID); assert.equal(request.settings.resolution, "480P");
    assert.equal(request.settings.aspect_ratio, "1:1"); assert.equal(request.settings.video_duration, 10);
    assert.equal(request.settings.prompt_extend, true); assert.equal(request.settings.seed, null);
    assert.equal(request.settings.native_audio, false); assert.equal(request.settings.shot_type, "single");
    assert.equal(request.settings.audio_setting, "auto"); assert.equal("duration" in request.settings, false);
    assert.equal(uploads(), 1);
    const binding = preparer.inspectCandidate(candidate);
    assert.ok(binding); assert.equal(binding!.model_id, MODEL_ID); assert.equal(binding!.audio_reference_count, 0);
    assert.equal(binding!.runtime_usable, false); assert.equal(binding!.dispatch_allowed, false);
    assert.ok(Number.isFinite(candidate.expires_at));
  } finally { await preparer.close(); await referenceService.close(); bytes.fill(0); }
});

test("WAN25 one-shot gate is separate from native dispatch and consumes only the bound prepared request", async () => {
  const links = await linked(), { client } = makeClient(), { referenceService, preparer } = setup(client, links), bytes = png384();
  try {
    const receipt = await referenceService.uploadImage(uploadInput(bytes));
    const candidate = await preparer.prepare({ attempt_id: ATTEMPT, model_id: MODEL_ID, image_handle: receipt.image_handle,
      audio_handle: null, prompt: "explicit prompt", parameters: explicitParameters() });
    const binding = preparer.inspectCandidate(candidate); assert.ok(binding);
    const input = { preparer, candidate, principal: binding!.principal, attemptId: ATTEMPT };
    const permit = await createOwnerWan25I2vOneShotPermit(input);
    assert.equal(permit.model_id, MODEL_ID); assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.runtime_usable, false); assert.equal(permit.backend_acceptance, "UNPROVEN");
    const context: OwnerWan25I2vOneShotPermitContext = Object.freeze({ ...input, permit });
    assert.throws(() => consumeOwnerWan25I2vOneShotPermit(context), invalidPermit("PERMIT_NOT_REVALIDATED"));
    await revalidateOwnerWan25I2vOneShotPermit(context);
    const consumed = consumeOwnerWan25I2vOneShotPermit(context);
    assert.equal(consumed.dispatch_allowed, false); assert.equal(consumed.request.settings.model_type, MODEL_ID);
    assert.equal(consumed.request.settings.file_urls.length, 1);
    await assert.rejects(revalidateOwnerWan25I2vOneShotPermit(context), invalidPermit("PERMIT_ALREADY_CONSUMED"));
    await assert.rejects(createOwnerWan25I2vOneShotPermit(input), invalidPermit("CANDIDATE_ALREADY_ISSUED"));
  } finally { await preparer.close(); await referenceService.close(); bytes.fill(0); }
});

test("WAN25 reference TTL pruning frees bounded record capacity without clearing no-replay claims", async () => {
  const links = await linked(), { client, uploads } = makeClient(), { referenceService, preparer } = setup(client, links), bytes = png384();
  try {
    const receipts = [];
    for (let index = 0; index < 128; index += 1) {
      receipts.push(await referenceService.uploadImage(uploadInput(bytes, { filename: `frame-${index}.png` })));
    }
    for (let index = 0; index < receipts.length; index += 1) {
      const receipt = receipts[index]!;
      await preparer.prepare({ attempt_id: ATTEMPT, model_id: MODEL_ID, image_handle: receipt.image_handle, audio_handle: null,
        prompt: `capacity candidate ${index}`, parameters: explicitParameters() });
    }
    await assert.rejects(referenceService.uploadImage(uploadInput(bytes, { filename: "frame-over-capacity.png" })),
      invalidReference("CAPACITY_EXCEEDED"));
    now += 15 * 60_000 + 1;
    const reclaimed = await referenceService.uploadImage(uploadInput(bytes, { filename: "frame-after-expiry.png" }));
    assert.equal(reclaimed.model_id, MODEL_ID); assert.equal(uploads(), 129);
    const candidate = await preparer.prepare({ attempt_id: ATTEMPT, model_id: MODEL_ID, image_handle: reclaimed.image_handle,
      audio_handle: null, prompt: "candidate after expiry pruning", parameters: explicitParameters() });
    assert.equal(candidate.model_id, MODEL_ID); assert.equal(candidate.dispatch_allowed, false);
  } finally { await preparer.close(); await referenceService.close(); bytes.fill(0); }
});
