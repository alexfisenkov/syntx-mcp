import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerKlingKeyframesReferenceService } from "../src/application/owner-kling-keyframes-reference-service.js";
import { createOwnerKlingKeyframesRequestPreparer } from "../src/application/owner-kling-keyframes-request-preparer.js";

const ATTEMPT = "link_keyframes_oneshot_owner_123456";
const BINDING = Object.freeze({ tenant_id: "keyframes-oneshot-tenant", subject: "keyframes-oneshot-owner" });
const NOW = Date.parse("2026-10-14T00:00:00.000Z");
const PNG = png300();

function png300(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function setup() {
  let now = NOW, uploads = 0, generationPosts = 0;
  const provider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED" as const,
    async createChallenge() { return { upstream_attempt_id: "synthetic", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id: string, receive: (token: { scheme: "Bearer"; value: string }) => Promise<void>) {
      await receive({ scheme: "Bearer", value: "synthetic-link-token" }); return { state: "LINKED" as const };
    } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (value: string) => Promise<T>) {
    return operation("synthetic-oneshot-token"); } }, fetchImpl: async (request, init) => {
      if (String(request).includes("generate")) generationPosts += 1;
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File); uploads += 1;
      return Response.json({ files: [{ id: `private-${uploads}`, url: `https://r2.syntx.ai/hidden/oneshot-${uploads}.png`,
        filename: file.name, mime_type: "image/png", size: PNG.byteLength }] });
    } });
  const references = new OwnerKlingKeyframesReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  const upload = (filename: string) => references.upload({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"), filename, mime_type: "image/png" });
  const first = await upload("first.png"), second = await upload("second.png");
  const handles = [String(first.image_handle), String(second.image_handle)] as const;
  const preparer = createOwnerKlingKeyframesRequestPreparer({ referenceService: references, now: () => now });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: "Keep this exact private prompt.",
    parameters: { model_id: "kling_keyframes", version: "2.1", mode: "hd", video_duration: 5, native_audio: false, aspect_ratio: null },
    controls: { temperature: 0.6 }, image_handles: handles });
  return { links, references, client, preparer, candidate, uploads: () => uploads, generationPosts: () => generationPosts,
    advance(milliseconds: number) { now += milliseconds; } };
}

test("issues a genuine owner-bound permit, revalidates it, and burns it exactly once without generation POST", async () => {
  const api = await import(new URL("../src/application/owner-kling-keyframes-one-shot-policy.js", import.meta.url).href);
  assert.equal(typeof api.createOwnerKlingKeyframesOneShotPermit, "function", "MISSING_OWNER_KEYFRAMES_ONESHOT_ISSUER");
  assert.equal(typeof api.revalidateOwnerKlingKeyframesOneShotPermit, "function", "MISSING_OWNER_KEYFRAMES_ONESHOT_REVALIDATOR");
  assert.equal(typeof api.consumeOwnerKlingKeyframesOneShotPermit, "function", "MISSING_OWNER_KEYFRAMES_ONESHOT_CONSUMER");
  const state = await setup();
  try {
    const binding = state.preparer.inspectCandidate(state.candidate);
    assert.ok(binding);
    const permit = await api.createOwnerKlingKeyframesOneShotPermit({ preparer: state.preparer, candidate: state.candidate,
      principal: binding.principal, attemptId: ATTEMPT });
    assert.equal(permit.dispatch_allowed, false);
    assert.equal(permit.runtime_usable, false);
    assert.equal(permit.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(permit).includes("https://"), false);
    assert.equal(JSON.stringify(permit).includes("Keep this exact private prompt"), false);
    await api.revalidateOwnerKlingKeyframesOneShotPermit({ preparer: state.preparer, candidate: state.candidate,
      principal: binding.principal, attemptId: ATTEMPT, permit });
    const receipt = api.consumeOwnerKlingKeyframesOneShotPermit({ preparer: state.preparer, candidate: state.candidate,
      principal: binding.principal, attemptId: ATTEMPT, permit });
    assert.equal(receipt.status, "consumed");
    assert.equal(receipt.request.prompt, "Keep this exact private prompt.");
    assert.deepEqual(receipt.request.settings.file_urls, [
      { type: "image", url: "https://r2.syntx.ai/hidden/oneshot-1.png" },
      { type: "image", url: "https://r2.syntx.ai/hidden/oneshot-2.png" }
    ]);
    assert.equal(state.uploads(), 2);
    assert.equal(state.generationPosts(), 0);
    assert.throws(() => api.consumeOwnerKlingKeyframesOneShotPermit({ preparer: state.preparer, candidate: state.candidate,
      principal: binding.principal, attemptId: ATTEMPT, permit }));
  } finally { await state.preparer.close(); await state.references.close(); }
});

test("rejects cloned or mismatched authority, concurrent duplicate issue, expiry, and owner revocation", async () => {
  const api = await import(new URL("../src/application/owner-kling-keyframes-one-shot-policy.js", import.meta.url).href);
  const state = await setup();
  try {
    const binding = state.preparer.inspectCandidate(state.candidate);
    assert.ok(binding);
    const create = (candidate: unknown = state.candidate, principal: unknown = binding.principal, attemptId = ATTEMPT, preparer: unknown = state.preparer) =>
      api.createOwnerKlingKeyframesOneShotPermit({ preparer, candidate, principal, attemptId });
    await assert.rejects(create({ ...state.candidate }), coded("CANDIDATE_UNBOUND"));
    await assert.rejects(create(state.candidate, { ...binding.principal, subject_id: "different-owner" }), coded("PRINCIPAL_MISMATCH"));
    await assert.rejects(create(state.candidate, binding.principal, "link_keyframes_other_owner_123456"), coded("PRINCIPAL_MISMATCH"));
    await assert.rejects(create(state.candidate, binding.principal, ATTEMPT, Object.create(Object.getPrototypeOf(state.preparer))), coded("PREPARER_UNTRUSTED"));

    const firstIssue = create();
    await assert.rejects(create(), coded("CANDIDATE_ALREADY_ISSUED"));
    const permit = await firstIssue;
    const context = { preparer: state.preparer, candidate: state.candidate, principal: binding.principal, attemptId: ATTEMPT, permit };
    const firstCheck = api.revalidateOwnerKlingKeyframesOneShotPermit(context);
    const secondCheck = api.revalidateOwnerKlingKeyframesOneShotPermit(context);
    await Promise.all([firstCheck, secondCheck]);
    const consumed = api.consumeOwnerKlingKeyframesOneShotPermit(context);
    assert.equal(consumed.status, "consumed");
    await assert.rejects(api.revalidateOwnerKlingKeyframesOneShotPermit(context), coded("PERMIT_ALREADY_CONSUMED"));
  } finally { await state.preparer.close(); await state.references.close(); }

  for (const scenario of ["expiry", "revocation"] as const) {
    const fresh = await setup();
    try {
      const binding = fresh.preparer.inspectCandidate(fresh.candidate);
      assert.ok(binding);
      const permit = await api.createOwnerKlingKeyframesOneShotPermit({ preparer: fresh.preparer, candidate: fresh.candidate,
        principal: binding.principal, attemptId: ATTEMPT });
      const context = { preparer: fresh.preparer, candidate: fresh.candidate, principal: binding.principal, attemptId: ATTEMPT, permit };
      if (scenario === "expiry") fresh.advance(15 * 60_000 + 1);
      else await fresh.links.revoke(BINDING, ATTEMPT);
      await assert.rejects(api.revalidateOwnerKlingKeyframesOneShotPermit(context));
      assert.throws(() => api.consumeOwnerKlingKeyframesOneShotPermit(context));
    } finally { await fresh.preparer.close(); await fresh.references.close(); }
  }
});

function coded(code: string) {
  return (error: unknown) => error instanceof Error && "code" in error && error.code === code;
}

