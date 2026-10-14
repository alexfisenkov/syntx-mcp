import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerHailuo02I2vImageReferenceService } from "../src/application/owner-hailuo02-i2v-image-reference-service.js";

const ATTEMPT = "link_h02_image_owner_0123456789";
const OTHER = "link_h02_image_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "h02-image-tenant", subject: "h02-image-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const URL = "https://r2.syntx.ai/hailuo/input.png";
function response(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-h02-credential"); } }; }
async function linked(ids: readonly string[], now = () => 1_000): Promise<PerUserLinkService> {
  let index = 0; const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  return links;
}
function client(onFetch: (init: RequestInit | undefined) => Promise<Response>) {
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => onFetch(init) });
}
function service(links: PerUserLinkService, resolveClient: (id: string) => unknown, now = () => 1_000) {
  return new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: links, resolveClient, now });
}
const input = (attemptId = ATTEMPT, bytes: Uint8Array = PNG) => ({ attemptId, filename: "кадр.png", mime_type: "image/png", bytes });

test("owner-bound image upload returns opaque handle and nominal resolution captures actual native client", async () => {
  const links = await linked([ATTEMPT]); let posts = 0; let clientRef!: SyntxChatHttpClient;
  clientRef = client(async (init) => { posts++; const form = init?.body as FormData; assert.equal(form.get("model_type"), "hailuo-02");
    const file = form.get("files"); assert.ok(file instanceof File); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return response({ files: [{ filename: "кадр.png", url: URL, mime_type: "image/png", size: PNG.length, status: "success" }] }); });
  const svc = service(links, () => clientRef); const callerBytes = new Uint8Array(PNG);
  try {
    const receipt = await svc.uploadImage(input(ATTEMPT, callerBytes));
    assert.deepEqual(Buffer.from(callerBytes), PNG); assert.equal(posts, 1);
    assert.match(receipt.image_handle, /^h02img_[A-Za-z0-9_-]{20,120}$/u);
    assert.equal(receipt.sha256, createHash("sha256").update(PNG).digest("hex"));
    assert.deepEqual({ mime_type: receipt.mime_type, size: receipt.size, width: receipt.width, height: receipt.height, expires_in_seconds: receipt.expires_in_seconds },
      { mime_type: "image/png", size: PNG.length, width: 1, height: 1, expires_in_seconds: 900 });
    assert.equal(JSON.stringify(receipt).includes(URL), false);
    const resolveInput = { attempt_id: ATTEMPT, image_handle: receipt.image_handle };
    const resolved = await svc.resolveReference(resolveInput);
    assert.equal(svc.isOwnedResolution(resolved, resolveInput), true);
    assert.equal(svc.isOwnedResolution({ ...resolved }, resolveInput), false);
    assert.equal(svc.withCapturedNativeImage(resolved, resolveInput, (captured, context) => captured === clientRef && context.model_id === "hailuo-02"), true);
    const context = svc.withCapturedNativeImage(resolved, resolveInput, (_captured, native) => native);
    assert.equal(context.model_id, "hailuo-02");
    await svc.invalidateAttempt(ATTEMPT); assert.equal(svc.isOwnedResolution(resolved, resolveInput), false);
  } finally { await svc.close(); }
});

test("cross-owner handles, forged clients and expired handles cannot resolve", async () => {
  let now = 10_000; const links = await linked([ATTEMPT, OTHER], () => now); let posts = 0;
  const actual = client(async () => { posts++; return response({ files: [{ filename: "кадр.png", url: URL, mime_type: "image/png", size: PNG.length }] }); });
  const svc = service(links, () => actual, () => now);
  try {
    const receipt = await svc.uploadImage(input()); const handle = receipt.image_handle;
    await assert.rejects(() => svc.resolveReference({ attempt_id: OTHER, image_handle: handle }), (e: unknown) => (e as { code?: string }).code === "REFERENCE_UNAVAILABLE");
    const foreign = client(async () => { throw new Error("should not post"); });
    const bad = service(links, () => foreign, () => now);
    try { await assert.rejects(() => bad.resolveReference({ attempt_id: ATTEMPT, image_handle: handle }), (e: unknown) => (e as { code?: string }).code === "REFERENCE_UNAVAILABLE"); }
    finally { await bad.close(); }
    now += 15 * 60_000;
    await assert.rejects(() => svc.resolveReference({ attempt_id: ATTEMPT, image_handle: handle }), (e: unknown) => (e as { code?: string }).code === "REFERENCE_EXPIRED");
    assert.equal(posts, 1);
  } finally { await svc.close(); }
});

test("unknown native upload outcome suppresses duplicate bytes across owner attempts", async () => {
  const links = await linked([ATTEMPT, OTHER]); let posts = 0;
  const native = client(async () => { posts++; throw new Error("synthetic disconnect"); });
  const svc = service(links, () => native);
  try {
    await assert.rejects(() => svc.uploadImage(input()), (e: unknown) => (e as { code?: string }).code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(() => svc.uploadImage(input(OTHER)), (e: unknown) => (e as { code?: string }).code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await svc.close(); }
});

test("close drains and revokes service handles without closing the borrowed native client", async () => {
  const links = await linked([ATTEMPT]); const native = client(async () => response({ files: [{ filename: "кадр.png", url: URL, mime_type: "image/png", size: PNG.length }] }));
  const svc = service(links, () => native); const receipt = await svc.uploadImage(input());
  const resolveInput = { attempt_id: ATTEMPT, image_handle: receipt.image_handle }; const resolved = await svc.resolveReference(resolveInput);
  const retained = svc.withCapturedNativeImage(resolved, resolveInput, (_client, context) => context);
  await svc.close(); assert.equal(svc.isOwnedResolution(resolved, resolveInput), false);
  assert.equal(retained.model_id, "hailuo-02");
});
