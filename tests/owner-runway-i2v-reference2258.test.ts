import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerRunwayI2vReferenceService, OwnerRunwayI2vReferenceServiceError } from "../src/application/owner-runway-i2v-reference-service.js";

const ATTEMPT = "link_runway_i2v_reference_owner_0123456789";
const OTHER_ATTEMPT = "link_runway_i2v_reference_other_0123456789";
const BINDING = Object.freeze({ tenant_id: "runway-i2v-reference-test", subject: "owner" });
const URL = "https://r2.syntx.ai/runway-i2v/private/frame.png";
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}
function upload(attemptId = ATTEMPT, overrides: Readonly<Record<string, unknown>> = {}) {
  return { attemptId, model_id: "4genfirstframeimage", aspect_ratio: "1:1", filename: "frame.png", mime_type: "image/png", bytes: png384(), ...overrides };
}
function resolve(handle: string, attemptId = ATTEMPT, overrides: Readonly<Record<string, unknown>> = {}) {
  return { attemptId, model_id: "4genfirstframeimage", aspect_ratio: "1:1", reference_handles: [handle], ...overrides };
}
function knownError(code: string) {
  return (error: unknown) => error instanceof OwnerRunwayI2vReferenceServiceError && error.code === code;
}
async function env(fetchHandler?: (init: RequestInit) => Response | Promise<Response>) {
  let now = 1_000, next = 0, posts = 0;
  let observed: Readonly<{ filename: string; mime_type: string; destination: string; check_duplicates: string; model_type: string; bytes: Buffer }> | undefined;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `runway-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-runway-i2v-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => [ATTEMPT, OTHER_ATTEMPT][next++]! });
  for (const id of [ATTEMPT, OTHER_ATTEMPT]) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  const makeClient = () => new SyntxChatHttpClient({ credentialBroker: {
    async useCredential<T>(action: (token: string) => Promise<T>) { return action("synthetic-runway-i2v-client-token"); }
  }, fetchImpl: async (_url, init) => {
    posts++;
    const form = init?.body as FormData; const file = form.get("files");
    if (!(file instanceof File)) throw new Error("synthetic expected uploaded File");
    observed = Object.freeze({ filename: file.name, mime_type: file.type, destination: String(form.get("destination")),
      check_duplicates: String(form.get("check_duplicates")), model_type: String(form.get("model_type")), bytes: Buffer.from(await file.arrayBuffer()) });
    return fetchHandler ? fetchHandler(init ?? {}) : Response.json({ files: [{ id: "runway-i2v-file-1", url: URL, filename: "frame.png", mime_type: "image/png", media_type: "image", type: "image", size: file.size, status: "success" }] });
  } });
  let client = makeClient();
  const service = new OwnerRunwayI2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  return { service, client: () => client, rotate: () => { client = makeClient(); }, posts: () => posts, observed: () => observed,
    advance: (amount: number) => { now += amount; }, cleanup: () => service.close() };
}

test("2258 stores an uploaded image behind an owner-bound opaque handle", async () => {
  const e = await env();
  try {
    const receipt = await e.service.uploadReference(upload());
    assert.deepEqual(e.observed(), { filename: "frame.png", mime_type: "image/png", destination: "hidden",
      check_duplicates: "true", model_type: "4genfirstframeimage", bytes: png384() });
    assert.match(receipt.reference_handle, /^runway_i2v_reference_[0-9a-f-]{36}$/u);
    assert.equal(receipt.media_type, "image"); assert.equal(receipt.model_id, "4genfirstframeimage");
    assert.equal(receipt.aspect_ratio, "1:1"); assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(receipt.provider_acceptance, "UNPROVEN"); assert.equal(receipt.generation_permit, false);
    assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
    const owned = await e.service.resolveReferences(resolve(receipt.reference_handle));
    assert.equal(e.service.isOwnedReferences(owned), true); assert.equal(owned.generation_permit, false);
    assert.equal(e.service.isOwnedReferences({ ...owned }), false);
    e.service.withCapturedReferences(owned, { model_id: "4genfirstframeimage", aspect_ratio: "1:1" }, (client, rows) => {
      assert.equal(client, e.client()); assert.equal(rows.length, 1); assert.equal(rows[0]?.type, "image"); assert.equal(rows[0]?.url, URL);
    });
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle, OTHER_ATTEMPT)), knownError("REFERENCE_UNAVAILABLE"));
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle, ATTEMPT, { aspect_ratio: "16:9" })), knownError("REFERENCE_UNAVAILABLE"));
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle, ATTEMPT, { model_id: "turbo4genfirstframeimage" })), knownError("REFERENCE_UNAVAILABLE"));
    e.rotate(); assert.equal(e.service.isOwnedReferences(owned), false);
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle)), knownError("REFERENCE_UNAVAILABLE"));
    await e.service.invalidateAttempt(ATTEMPT);
    assert.equal(e.service.isOwnedReferences(owned), false);
    assert.equal(e.posts(), 1);
  } finally { await e.cleanup(); }
});

test("2258 unknown upload outcomes are sticky and cannot be replayed", async () => {
  const e = await env(async () => { throw new Error("synthetic lost upload acknowledgement"); });
  const source = upload();
  try {
    await assert.rejects(e.service.uploadReference(source), knownError("UPLOAD_OUTCOME_UNKNOWN"));
    await e.service.invalidateAttempt(ATTEMPT);
    await assert.rejects(e.service.uploadReference(upload()), knownError("UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(e.posts(), 1);
    assert.deepEqual(source.bytes, png384());
  } finally { await e.cleanup(); }
});

test("2258 requires one exact handle and rejects accessors without reading them", async () => {
  const e = await env(); let getterCalls = 0;
  try {
    const handles: string[] = [];
    Object.defineProperty(handles, "0", { enumerable: true, get() { getterCalls++; return "runway_i2v_reference_" + "0".repeat(36); } });
    await assert.rejects(e.service.resolveReferences({ attemptId: ATTEMPT, model_id: "4genfirstframeimage", aspect_ratio: "1:1", reference_handles: handles }), knownError("INVALID_REQUEST"));
    await assert.rejects(e.service.uploadReference(upload(ATTEMPT, { aspect_ratio: "16:9" })), knownError("VALIDATION_REJECTED"));
    assert.equal(getterCalls, 0); assert.equal(e.posts(), 0);
  } finally { await e.cleanup(); }
});

test("2258 expires references and releases expired handles", async () => {
  const e = await env();
  try {
    const receipt = await e.service.uploadReference(upload()); const owned = await e.service.resolveReferences(resolve(receipt.reference_handle));
    e.advance(15 * 60_000);
    assert.equal(e.service.isOwnedReferences(owned), false);
    await assert.rejects(e.service.resolveReferences(resolve(receipt.reference_handle)), knownError("REFERENCE_UNAVAILABLE"));
    assert.equal(e.posts(), 1);
  } finally { await e.cleanup(); }
});
