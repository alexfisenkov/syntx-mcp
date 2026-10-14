import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerHailuo02I2vImageReferenceService } from "../src/application/owner-hailuo02-i2v-image-reference-service.js";
import { createOwnerHailuo02I2vRequestPreparer } from "../src/application/owner-hailuo02-i2v-request-preparer.js";
import { createOwnerHailuo02I2vOneShotPermit, consumeOwnerHailuo02I2vOneShotPermit, revalidateOwnerHailuo02I2vOneShotPermit } from "../src/application/owner-hailuo02-i2v-one-shot-policy.js";

const ATTEMPT = "link_h02_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "h02-owner-tenant", subject: "h02-owner-subject" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const URL = "https://r2.syntx.ai/hailuo/input.png";
const PAIRS = [{ resolution: "512p", video_duration: 6 }, { resolution: "512p", video_duration: 10 },
  { resolution: "768p", video_duration: 6 }, { resolution: "768p", video_duration: 10 }, { resolution: "1080p", video_duration: 6 }] as const;
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-h02-credential"); } }; }
async function links(ids: readonly string[]) {
  let index = 0; const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const service = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => 1_000), { now: () => 1_000, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await service.createAttempt(BINDING); await service.issueHandoff(BINDING, id); await service.checkAttempt(BINDING, id); }
  return service;
}
function client() { return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => response({ files: [{ filename: "frame.png", url: URL,
  mime_type: "image/png", size: PNG.length, status: "success" }] }) }); }

test("preparer emits only source-pinned Hailuo I2V fields and keeps owner URL private", async () => {
  const auth = await links([ATTEMPT]); const native = client(); let uploads = 0;
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { uploads++; return response({ files: [{ filename: "frame.png",
    url: URL, mime_type: "image/png", size: PNG.length, status: "success" }] }); } });
  const images = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => uploadClient, now: () => 1_000 });
  const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => 1_000 });
  try {
    const uploaded = await images.uploadImage({ attemptId: ATTEMPT, filename: "frame.png", mime_type: "image/png", bytes: PNG });
    assert.equal(uploads, 1); assert.equal(native instanceof SyntxChatHttpClient, true);
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt: "A paper lantern drifting over a calm lake.",
      resolution: "512p", video_duration: 6, image_handle: uploaded.image_handle });
    const request = preparer.getPrivateRequest(candidate);
    assert.deepEqual(Object.keys(request.settings).sort(), ["file_urls", "model_type", "resolution", "video_duration"]);
    assert.deepEqual(request, { prompt: "A paper lantern drifting over a calm lake.", settings: { model_type: "hailuo-02", resolution: "512p",
      video_duration: 6, file_urls: [{ type: "image", url: URL }] } });
    assert.equal(Object.isFrozen(candidate), true); assert.equal(Object.isFrozen(request.settings.file_urls[0]), true);
    assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.runtime_usable, false); assert.equal(candidate.backend_acceptance, "UNPROVEN");
    assert.equal(candidate.source_binding.sender_projection, "PINNED_VIDEO_SENDER_SHALLOW_COPIES_SETTINGS_NO_N_INSERTION");
    assert.equal(JSON.stringify(candidate).includes(URL), false);
    await assert.rejects(() => preparer.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt: "x", resolution: "1080p",
      video_duration: 10, image_handle: uploaded.image_handle }), /could not be prepared safely/u);
  } finally { await preparer.close(); await images.close(); }
});

test("source-reviewed pairs prepare and the nominal permit is reserved, revalidated and consumed once", async () => {
  const auth = await links([ATTEMPT]); let now = 1_000;
  const native = client(); const images = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => native, now: () => now });
  const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => now });
  try {
    const uploaded = await images.uploadImage({ attemptId: ATTEMPT, filename: "frame.png", mime_type: "image/png", bytes: PNG });
    for (const pair of PAIRS) {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt: "Keep the subject recognizable.", ...pair,
        image_handle: uploaded.image_handle });
      assert.equal(candidate.dispatch_allowed, false); assert.equal(preparer.inspectCandidate(candidate)?.intent.resolution, pair.resolution);
    }
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt: "Keep the subject recognizable.",
      ...PAIRS[0]!, image_handle: uploaded.image_handle });
    const principal = preparer.inspectCandidate(candidate)!.principal;
    const context = { preparer, candidate, principal, attemptId: ATTEMPT };
    const permit = await createOwnerHailuo02I2vOneShotPermit(context);
    await assert.rejects(() => createOwnerHailuo02I2vOneShotPermit(context), (e: unknown) => (e as { code?: string }).code === "CANDIDATE_ALREADY_ISSUED");
    assert.throws(() => consumeOwnerHailuo02I2vOneShotPermit({ ...context, permit }),
      (e: unknown) => (e as { code?: string }).code === "PERMIT_NOT_REVALIDATED");
    await revalidateOwnerHailuo02I2vOneShotPermit({ ...context, permit });
    const receipt = consumeOwnerHailuo02I2vOneShotPermit({ ...context, permit });
    assert.equal(receipt.dispatch_allowed, false); assert.equal(receipt.backend_acceptance, "UNPROVEN");
    assert.equal(receipt.request.settings.file_urls[0]?.url, URL);
    assert.throws(() => consumeOwnerHailuo02I2vOneShotPermit({ ...context, permit }), (e: unknown) => (e as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
    now += 15 * 60_000; assert.equal(preparer.inspectCandidate(candidate), undefined);
  } finally { await preparer.close(); await images.close(); }
});

test("candidate state is isolated to its creating preparer", async () => {
  const auth = await links([ATTEMPT]); const native = client();
  const images = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => native, now: () => 1_000 });
  const owner = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => 1_000 });
  const foreign = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => 1_000 });
  try {
    const uploaded = await images.uploadImage({ attemptId: ATTEMPT, filename: "frame.png", mime_type: "image/png", bytes: PNG });
    const candidate = await owner.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt: "A short motion.",
      resolution: "512p", video_duration: 6, image_handle: uploaded.image_handle });
    assert.equal(owner.inspectCandidate(candidate)?.attempt_id, ATTEMPT);
    assert.equal(foreign.inspectCandidate(candidate), undefined);
    assert.throws(() => foreign.getPrivateRequest(candidate), (e: unknown) => (e as { code?: string }).code === "CANDIDATE_EXPIRED");
    assert.equal(owner.getPrivateRequest(candidate).settings.file_urls[0]?.url, URL);
  } finally { await foreign.close(); await owner.close(); await images.close(); }
});

test("preparer revalidation keeps its epoch separate from the image service epoch", async () => {
  const auth = await links([ATTEMPT]); const native = client();
  const images = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => native, now: () => 1_000 });
  const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: images, now: () => 1_000 });
  try {
    await images.uploadImage({ attemptId: ATTEMPT, filename: "frame.png", mime_type: "image/png", bytes: PNG });
    await preparer.invalidateAttempt(ATTEMPT);
    const uploaded = await images.uploadImage({ attemptId: ATTEMPT, filename: "frame.png", mime_type: "image/png", bytes: PNG });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt: "Continue the image motion.",
      resolution: "512p", video_duration: 6, image_handle: uploaded.image_handle });
    assert.equal(preparer.inspectCandidate(candidate)?.image_epoch, 0);
    assert.equal((await preparer.revalidateCandidate(candidate)).image_epoch, 0);
  } finally { await preparer.close(); await images.close(); }
});
