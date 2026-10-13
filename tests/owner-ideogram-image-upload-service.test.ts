import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";

const ATTEMPT = "link_ideogram_upload_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "ideogram-upload-tenant", subject: "ideogram-upload-subject" });
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-ideogram-upload-credential");
  } };
}
function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
function responseFor(index: number, bytes = PNG) {
  return Response.json({ files: [{
    id: `private-ideogram-id-${index}`, url: `https://r2.syntx.ai/private/ideogram/${index}.png`,
    mime_type: "image/png", size: bytes.byteLength
  }] });
}
function createService(fetchImpl: typeof fetch, now: () => number = () => NOW,
  getStatus: (attemptId: string) => Promise<unknown> = async (attemptId) => linkedAttempt(attemptId)) {
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl });
  const service = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return getStatus(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client, now });
  return { client, service };
}
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded wait did not reach expected state");
}
function uploadInput(model_id: string, mode: string, attemptId = ATTEMPT) {
  return { attemptId, model_id, mode, content_base64: PNG.toString("base64"), filename: "image.png", mime_type: "image/png" };
}

test("uploads ordinary image references through the actual native method for all eight imageable contexts", async () => {
  const posts: Array<{ model_type: string; bytes: Buffer }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    posts.push({ model_type: String(form.get("model_type")), bytes: Buffer.from(await file.arrayBuffer()) });
    return responseFor(posts.length);
  };
  const { service } = createService(fetchImpl);
  const contexts = [
    ["ideogram", "generate"], ["ideogram", "remix"], ["ideogram", "reframe"],
    ["ideogram", "replace_background"], ["ideogram", "character_reference"],
    ["ideogram_40", "generate"], ["ideogram_45", "generate"], ["ideogram_45", "precise_edit"]
  ] as const;
  try {
    const receipts = [];
    for (const [model_id, mode] of contexts) receipts.push(await service.upload(uploadInput(model_id, mode)));
    assert.deepEqual(posts.map((post) => post.model_type), contexts.map(([model_id]) => model_id));
    assert.ok(posts.every((post) => post.bytes.equals(PNG)));
    assert.deepEqual(receipts.map((receipt) => [receipt.model_id, receipt.mode]), contexts);
    assert.ok(receipts.every((receipt) => receipt.status === "uploaded" && receipt.width === 1 && receipt.height === 1 && receipt.size === PNG.length));
    assert.ok(receipts.every((receipt) => receipt.sha256 === `sha256:${createHash("sha256").update(PNG).digest("hex")}`));
    assert.ok(receipts.every((receipt) => receipt.expires_in_seconds === 900));
    for (const secret of ["https://r2.syntx.ai", "private-ideogram-id", "image.png", BINDING.subject]) {
      assert.equal(JSON.stringify(receipts).includes(secret), false);
    }
    const resolved = await service.resolveImageReference({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
      reference_handle: receipts[7]!.reference_handle });
    assert.equal(resolved.role, "ordinary_image_reference");
    assert.equal(resolved.attempt_id, ATTEMPT);
    assert.equal(resolved.model_id, "ideogram_45");
    assert.equal(resolved.mode, "precise_edit");
    assert.equal(resolved.reference_handle, receipts[7]!.reference_handle);
    assert.equal(resolved.file_url, "https://r2.syntx.ai/private/ideogram/8.png");
    assert.equal(resolved.file_id, "private-ideogram-id-8");
    assert.equal(resolved.sha256, receipts[7]!.sha256);
    assert.equal(resolved.expires_at, NOW + 15 * 60_000);
    assert.equal(resolved.generation_permit, false);
    assert.equal(posts.length, 8);
  } finally { await service.close(); }
});

test("rejects 4.0 Transparent before resolving principal or calling the native client", async () => {
  let posts = 0;
  let linkChecks = 0;
  let clientResolutions = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async () => {
    posts += 1; return responseFor(posts);
  } });
  const service = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { linkChecks += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => { clientResolutions += 1; return client; }, now: () => NOW });
  try {
    await assert.rejects(service.upload(uploadInput("ideogram_40", "transparent")),
      (error: unknown) => hasErrorCode(error, "MODE_HAS_NO_IMAGE_REFERENCES"));
    await assert.rejects(service.upload({ ...uploadInput("ideogram_40", "generate"), file_url: "https://evil.invalid/x.png" }),
      (error: unknown) => hasErrorCode(error, "INVALID_REQUEST"));
    await assert.rejects(service.upload({ ...uploadInput("ideogram_40", "generate"), mime_type: "image/avif" }),
      (error: unknown) => hasErrorCode(error, "INVALID_IMAGE_INPUT"));
    let getterReads = 0;
    const getterInput = Object.defineProperties({}, {
      attemptId: { enumerable: true, get() { getterReads += 1; return ATTEMPT; } },
      model_id: { enumerable: true, value: "ideogram" }, mode: { enumerable: true, value: "generate" },
      content_base64: { enumerable: true, value: PNG.toString("base64") }, filename: { enumerable: true, value: "image.png" },
      mime_type: { enumerable: true, value: "image/png" }
    });
    let proxyReads = 0;
    const proxyInput = new Proxy(uploadInput("ideogram", "generate"), {
      get() { proxyReads += 1; throw new Error("must not invoke request proxy traps"); }
    });
    await assert.rejects(service.upload(getterInput), (error: unknown) => hasErrorCode(error, "INVALID_REQUEST"));
    await assert.rejects(service.upload(proxyInput), (error: unknown) => hasErrorCode(error, "INVALID_REQUEST"));
    assert.equal(posts, 0);
    assert.equal(linkChecks, 0);
    assert.equal(clientResolutions, 0);
    assert.equal(getterReads, 0);
    assert.equal(proxyReads, 0);
  } finally { await service.close(); }
});

test("resolves only the matching live attempt/model/mode handle and never renews its original TTL", async () => {
  let now = NOW;
  let posts = 0;
  const { service } = createService(async () => responseFor(++posts), () => now);
  try {
    const receipt = await service.upload(uploadInput("ideogram_40", "generate"));
    const expiry = NOW + 15 * 60_000;
    assert.equal((await service.resolveImageReference({ attemptId: ATTEMPT, model_id: "ideogram_40", mode: "generate",
      reference_handle: receipt.reference_handle })).expires_at, expiry);
    for (const wrong of [
      { attemptId: "link_ideogram_other_attempt_0123456789", model_id: "ideogram_40", mode: "generate" },
      { attemptId: ATTEMPT, model_id: "ideogram_45", mode: "generate" },
      { attemptId: ATTEMPT, model_id: "ideogram_40", mode: "transparent" }
    ]) {
      await assert.rejects(service.resolveImageReference({ ...wrong, reference_handle: receipt.reference_handle }),
        (error: unknown) => hasErrorCode(error, "REFERENCE_UNAVAILABLE"));
    }
    now = expiry - 1;
    assert.equal((await service.resolveImageReference({ attemptId: ATTEMPT, model_id: "ideogram_40", mode: "generate",
      reference_handle: receipt.reference_handle })).expires_at, expiry);
    now = expiry;
    await assert.rejects(service.resolveImageReference({ attemptId: ATTEMPT, model_id: "ideogram_40", mode: "generate",
      reference_handle: receipt.reference_handle }),
      (error: unknown) => hasErrorCode(error, "REFERENCE_EXPIRED"));
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("relink between preflight reads yields unknown outcome and never mints an image handle", async () => {
  let statusReads = 0;
  let posts = 0;
  const { service } = createService(async () => { posts += 1; return responseFor(posts); }, () => NOW,
    async (attemptId) => {
      statusReads += 1;
      return statusReads === 1 ? linkedAttempt(attemptId) : { ...linkedAttempt(attemptId), status: "REVOKED", linked: false };
    });
  try {
    await assert.rejects(service.upload(uploadInput("ideogram", "generate")),
      (error: unknown) => hasErrorCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1);
    assert.equal(statusReads, 2);
    await assert.rejects(service.resolveImageReference({ attemptId: ATTEMPT, model_id: "ideogram", mode: "generate",
      reference_handle: "ideogram_image_00000000-0000-4000-8000-000000000000" }),
      (error: unknown) => hasErrorCode(error, "PRINCIPAL_NOT_LINKED"));
  } finally { await service.close(); }
});

test("invalidation aborts and drains a pending upload before a late receipt can be retained", async () => {
  let posts = 0;
  let release!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  const gate = new Promise<Response>((resolve) => { release = resolve; });
  const { service } = createService(async (_input, init) => {
    posts += 1; signal = init?.signal as AbortSignal | undefined; return gate;
  });
  try {
    const pending = service.upload(uploadInput("ideogram", "generate"));
    await waitUntil(() => posts === 1);
    let invalidationDone = false;
    const invalidation = service.invalidateAttempt(ATTEMPT).then(() => { invalidationDone = true; });
    await waitUntil(() => signal?.aborted === true);
    assert.equal(invalidationDone, false);
    release(responseFor(posts));
    await assert.rejects(pending, (error: unknown) => hasErrorCode(error, "REQUEST_ABORTED") || hasErrorCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    await invalidation;
    assert.equal(invalidationDone, true);
    await assert.rejects(service.resolveImageReference({ attemptId: ATTEMPT, model_id: "ideogram", mode: "generate",
      reference_handle: "ideogram_image_00000000-0000-4000-8000-000000000000" }),
      (error: unknown) => hasErrorCode(error, "REFERENCE_UNAVAILABLE"));
  } finally { release(responseFor(posts)); await service.close(); }
});

test("enforces 128 private records before another native POST", async () => {
  let posts = 0;
  const { service } = createService(async () => responseFor(++posts));
  try {
    for (let index = 0; index < 128; index += 1) {
      await service.upload(uploadInput("ideogram", "generate", `link_ideogram_cap_attempt_${index.toString().padStart(3, "0")}`));
    }
    await assert.rejects(service.upload(uploadInput("ideogram", "generate", "link_ideogram_cap_attempt_128")),
      (error: unknown) => hasErrorCode(error, "CAPACITY_EXCEEDED"));
    assert.equal(posts, 128);
  } finally { await service.close(); }
});

test("bounds retained attempt scopes at 128 before another principal lookup", async () => {
  let statusReads = 0;
  const service = new OwnerIdeogramImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { statusReads += 1; return linkedAttempt(attemptId); } },
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => ({}), now: () => NOW });
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(service.upload(uploadInput("ideogram", "generate", `link_ideogram_scope_attempt_${index.toString().padStart(3, "0")}`)),
        (error: unknown) => hasErrorCode(error, "MODEL_BINDING_MISMATCH"));
    }
    await assert.rejects(service.upload(uploadInput("ideogram", "generate", "link_ideogram_scope_attempt_128")),
      (error: unknown) => hasErrorCode(error, "CAPACITY_EXCEEDED"));
    assert.equal(statusReads, 128);
  } finally { await service.close(); }
});

test("rejects a fifth pending upload and close waits for aborted native requests to drain", async () => {
  let posts = 0;
  const signals: AbortSignal[] = [];
  const releases: Array<(response: Response) => void> = [];
  const { service } = createService(async (_input, init) => {
    posts += 1;
    signals.push(init?.signal as AbortSignal);
    return new Promise<Response>((resolve) => { releases.push(resolve); });
  });
  try {
    const pending = Array.from({ length: 4 }, (_, index) => service.upload(
      uploadInput("ideogram", "generate", `link_ideogram_pending_attempt_${index.toString().padStart(2, "0")}`)));
    await waitUntil(() => posts === 4);
    await assert.rejects(service.upload(uploadInput("ideogram", "generate", "link_ideogram_pending_attempt_04")),
      (error: unknown) => hasErrorCode(error, "SERVICE_BUSY"));
    assert.equal(posts, 4);
    let closeDone = false;
    const closing = service.close().then(() => { closeDone = true; });
    await waitUntil(() => signals.every((signal) => signal.aborted));
    assert.equal(closeDone, false);
    for (let index = 0; index < releases.length; index += 1) releases[index]!(responseFor(index + 1));
    const settled = await Promise.allSettled(pending);
    assert.ok(settled.every((result) => result.status === "rejected"));
    await closing;
    assert.equal(closeDone, true);
  } finally {
    for (let index = 0; index < releases.length; index += 1) releases[index]!(responseFor(index + 1));
    await service.close();
  }
});

test("returns no retryable upload claim on unknown native outcome and rejects calls after close", async () => {
  let posts = 0;
  const { service } = createService(async () => { posts += 1; throw new Error("network outcome unknown"); });
  const input = uploadInput("ideogram", "generate");
  try {
    await assert.rejects(service.upload(input),
      (error: unknown) => hasErrorCode(error, "UPLOAD_OUTCOME_UNKNOWN"));
    assert.equal(posts, 1);
    await service.close();
    await assert.rejects(service.upload(input),
      (error: unknown) => hasErrorCode(error, "SERVICE_CLOSED"));
  } finally { await service.close(); }
});
