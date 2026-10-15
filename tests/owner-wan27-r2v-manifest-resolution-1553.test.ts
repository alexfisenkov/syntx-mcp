import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { releaseValidatedOwnerWan27R2vImage, validateOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import {
  OwnerWan27R2vReferenceService, OwnerWan27R2vReferenceServiceError
} from "../src/application/owner-wan27-r2v-reference-service.js";

const ATTEMPT = "link_wan27_resolve_owner_0123456789";
const OTHER = "link_wan27_resolve_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "wan27-resolve-tenant", subject: "wan27-resolve-owner" });
const URL = "https://r2.syntx.ai/wan27/resolve.png";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function image() {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return validateOwnerWan27R2vImage({ filename: "resolve.png", mime_type: "image/png", bytes });
}
async function linked(ids: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ids[index++]!
  });
  for (const id of ids) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  return links;
}
function nativeClient() {
  const fetchCount = { value: 0 };
  const broker: SyntxCredentialBroker = { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-owner-token"); } };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (_url, init) => {
    fetchCount.value += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return new Response(JSON.stringify({ files: [{ filename: file.name, url: URL, mime_type: file.type, size: file.size }] }),
      { status: 200, headers: { "content-type": "application/json" } });
  } });
  return { client, fetchCount };
}
async function readyManifest(service: OwnerWan27R2vReferenceService, attemptId: string) {
  const draft = await service.createManifest({ attemptId, video_reference_count: 0 });
  const receipt = image();
  try { await service.addImage({ manifest_handle: draft.manifest_handle, image: receipt }); }
  finally { releaseValidatedOwnerWan27R2vImage(receipt); }
  return service.finalizeManifest({ manifest_handle: draft.manifest_handle });
}
function isServiceError(code: OwnerWan27R2vReferenceServiceError["code"]) {
  return (error: unknown) => error instanceof OwnerWan27R2vReferenceServiceError && error.code === code;
}

test("resolveManifest returns only the exact current frozen ready receipt without fetching", async () => {
  let now = 1_000; const links = await linked([ATTEMPT], () => now); const { client, fetchCount } = nativeClient();
  const service = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  try {
    const manifest = await readyManifest(service, ATTEMPT);
    const uploads = fetchCount.value;
    const resolved = await service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: manifest.manifest_handle });
    assert.strictEqual(resolved, manifest);
    assert.equal(Object.isFrozen(resolved), true);
    assert.equal(service.isOwnedManifest(resolved), true);
    assert.equal(fetchCount.value, uploads);
    await links.revoke(BINDING, ATTEMPT);
    await assert.rejects(service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: manifest.manifest_handle }),
      isServiceError("PRINCIPAL_NOT_LINKED"));
    assert.equal(fetchCount.value, uploads);
  } finally { await service.close(); }
});

test("resolveManifest rejects wrong attempt, foreign handle, malformed handle, and extra input without fetch", async () => {
  let now = 1_000; const links = await linked([ATTEMPT, OTHER], () => now); const { client, fetchCount } = nativeClient();
  const service = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  try {
    const own = await readyManifest(service, ATTEMPT);
    const foreign = await readyManifest(service, OTHER);
    const uploads = fetchCount.value;
    await assert.rejects(service.resolveManifest({ attemptId: OTHER, manifest_handle: own.manifest_handle }), isServiceError("MANIFEST_UNAVAILABLE"));
    await assert.rejects(service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: foreign.manifest_handle }), isServiceError("MANIFEST_UNAVAILABLE"));
    await assert.rejects(service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: "wan27ref_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }), isServiceError("MANIFEST_UNAVAILABLE"));
    await assert.rejects(service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: own.manifest_handle, manifest: own }), isServiceError("INVALID_REQUEST"));
    assert.equal(fetchCount.value, uploads);
  } finally { await service.close(); }
});

test("resolveManifest rejects when attempt revocation races the owner lookup", async () => {
  let now = 1_000; const links = await linked([ATTEMPT], () => now); const { client, fetchCount } = nativeClient();
  const service = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  try {
    const manifest = await readyManifest(service, ATTEMPT);
    const uploads = fetchCount.value;
    const resolving = service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: manifest.manifest_handle });
    const invalidating = service.invalidateAttempt(ATTEMPT);
    await assert.rejects(resolving, isServiceError("REQUEST_ABORTED"));
    await invalidating;
    assert.equal(service.isOwnedManifest(manifest), false);
    assert.equal(fetchCount.value, uploads);
  } finally { await service.close(); }
});

test("resolveManifest rechecks TTL after the async owner lookup", async () => {
  let now = 1_000; const links = await linked([ATTEMPT], () => now); const { client, fetchCount } = nativeClient();
  const service = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  try {
    const manifest = await readyManifest(service, ATTEMPT);
    const uploads = fetchCount.value;
    const resolving = service.resolveManifest({ attemptId: ATTEMPT, manifest_handle: manifest.manifest_handle });
    now += 15 * 60_000;
    await assert.rejects(resolving, isServiceError("MANIFEST_EXPIRED"));
    assert.equal(fetchCount.value, uploads);
  } finally { await service.close(); }
});
