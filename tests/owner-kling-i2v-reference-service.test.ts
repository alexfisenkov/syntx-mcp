import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SERVICE_MODULE_URL = new URL("../src/application/owner-kling-i2v-reference-service.js", import.meta.url).href;
const serviceModule = await import(SERVICE_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_kling_i2v_owner_0123456789";
const FOREIGN_ATTEMPT = "link_kling_i2v_foreign_0123456789";
const BINDING = Object.freeze({ tenant_id: "kling-reference-tenant", subject: "kling-reference-owner" });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const UPLOAD_URL = "https://r2.syntx.ai/hidden/kling-frame.jpg";
const NOW = Date.parse("2026-10-14T00:00:00.000Z");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-kling-test-token"); } };
}

async function linkService(attemptIds: readonly string[] = [ATTEMPT], now = () => NOW) {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-link-token" }); return { state: "LINKED" }; }
  };
  const store = new InMemoryAuthLinkStore(now);
  const service = new PerUserLinkService(provider, store, { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attemptIds[next++]! });
  for (const attemptId of attemptIds) {
    await service.createAttempt(BINDING);
    await service.issueHandoff(BINDING, attemptId);
    await service.checkAttempt(BINDING, attemptId);
  }
  return service;
}

function makeService(options: { readonly linkService: unknown; readonly client: SyntxChatHttpClient; readonly now?: () => number }) {
  const Service = serviceModule?.OwnerKlingI2VImageReferenceService as (new (input: unknown) => {
    upload(input: unknown): Promise<Record<string, unknown>>;
    resolve(input: unknown): Promise<Record<string, unknown>>;
    isOwnedResolution(value: unknown, input: unknown): boolean;
    readUploadReference(value: unknown, input: unknown): Promise<Readonly<{ url: string }>>;
    invalidateAttempt(attemptId: unknown): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_OWNER_KLING_I2V_IMAGE_REFERENCE_SERVICE");
  return new Service!({ binding: BINDING, linkService: options.linkService, resolveClient: () => options.client,
    destination: "hidden", now: options.now ?? (() => NOW) });
}

function uploadInput(attemptId = ATTEMPT) {
  return { attemptId, content_base64: JPEG.toString("base64"), filename: "kling-frame.jpg", mime_type: "image/jpeg" };
}

test("uploads one validated Kling image for a currently linked owner and returns only an opaque receipt", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_request, init) => {
    posts += 1;
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("model_type"), "kling_image2video");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "kling-frame.jpg");
    assert.equal(file.type, "image/jpeg");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), JPEG);
    return Response.json({ files: [{ id: "synthetic-private-file-id", url: UPLOAD_URL }] });
  } });
  const service = makeService({ linkService: await linkService(), client });
  try {
    const receipt = await service.upload(uploadInput());
    assert.equal(posts, 1);
    assert.equal(receipt.status, "uploaded");
    assert.match(String(receipt.image_handle), /^kling_i2v_image_[0-9a-f-]{36}$/u);
    assert.equal(receipt.model_id, "kling_image2video");
    assert.equal(receipt.mime_type, "image/jpeg");
    assert.equal(receipt.size, JPEG.byteLength);
    assert.equal(receipt.width, 300);
    assert.equal(receipt.height, 300);
    assert.equal(receipt.sha256, `sha256:${createHash("sha256").update(JPEG).digest("hex")}`);
    assert.equal(receipt.expires_in_seconds, 900);
    for (const value of [UPLOAD_URL, "synthetic-private-file-id", "kling-frame.jpg", ATTEMPT, "synthetic-link-token"])
      assert.equal(JSON.stringify(receipt).includes(value), false);
    const duplicate = await service.upload(uploadInput());
    assert.equal(duplicate.image_handle, receipt.image_handle, "the same owner/attempt/image intent reuses its sealed handle");
    assert.equal(posts, 1, "a duplicate semantic upload does not issue another POST");
  } finally { await service.close(); }
});

test("resolves only the current owner's nominal handle through its captured native client", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; return Response.json({ files: [{ url: UPLOAD_URL }] });
  } });
  const service = makeService({ linkService: await linkService([ATTEMPT, FOREIGN_ATTEMPT]), client });
  try {
    const receipt = await service.upload(uploadInput());
    const request = { attempt_id: ATTEMPT, image_handle: receipt.image_handle };
    const resolution = await service.resolve(request);
    assert.equal(service.isOwnedResolution(resolution, request), true);
    assert.deepEqual(await service.readUploadReference(resolution, request), { url: UPLOAD_URL });
    await assert.rejects(() => service.resolve({ attempt_id: FOREIGN_ATTEMPT, image_handle: receipt.image_handle }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(posts, 1, "resolution and foreign-handle denial cannot upload again");
    await service.invalidateAttempt(ATTEMPT);
    assert.equal(service.isOwnedResolution(resolution, request), false);
  } finally { await service.close(); }
});

test("does not replay an UNKNOWN semantic upload after an acknowledgement is lost", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; throw new Error("synthetic lost upload acknowledgement");
  } });
  const service = makeService({ linkService: await linkService([ATTEMPT, FOREIGN_ATTEMPT]), client });
  try {
    for (const attemptId of [ATTEMPT, FOREIGN_ATTEMPT]) {
      await assert.rejects(() => service.upload(uploadInput(attemptId)),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    }
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("validates malformed image input before owner lookup or upload", async () => {
  let ownerReads = 0, posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; return Response.json({ files: [{ url: UPLOAD_URL }] });
  } });
  const linked = await linkService();
  const getStatus = linked.getStatus.bind(linked);
  linked.getStatus = async (...args: Parameters<typeof linked.getStatus>) => { ownerReads += 1; return getStatus(...args); };
  const service = makeService({ linkService: linked, client });
  try {
    await assert.rejects(() => service.upload({ ...uploadInput(), content_base64: "not base64" }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.equal(ownerReads, 0);
    assert.equal(posts, 0);
  } finally { await service.close(); }
});
